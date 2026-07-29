#!/usr/bin/env node
// Tests for install-launcher.mjs.
//
// The point of the launcher is that a plugin update must not break the
// statusline, so the load-bearing test installs two cache versions and asserts
// the launcher follows the newest one without the settings path changing.
//
// Usage: node install-launcher.test.mjs

import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  copyFileSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { install, launcherPath, configDir, LAUNCHER_SOURCE, LAUNCHER_NAME } from './install-launcher.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'install-launcher.mjs');

let pass = 0;
let fail = 0;
const temps = [];

function step(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('step callback must be synchronous');
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

function cfgDir() {
  const d = mkdtempSync(join(tmpdir(), 'claude-tools-launch-'));
  temps.push(d);
  return join(d, '.claude');
}

/**
 * Put a fake plugin version in the cache whose statusline prints `marker`.
 *
 * The stub carries the same entry-point guard and `export { main }` shape as the
 * real hooks/statusline.mjs. That matters: the first version of this fixture was a
 * bare side-effecting module, so it ran on import and the suite passed while the
 * launcher rendered nothing against the real module, which does not.
 */
function addVersion(cfg, version, marker) {
  const dir = join(cfg, 'plugins', 'cache', 'josephi-claude-tools', 'claude-tools', version, 'hooks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'statusline.mjs'), [
    "import { argv, stdout } from 'node:process';",
    "import { pathToFileURL } from 'node:url';",
    'function main() {',
    `  stdout.write(${JSON.stringify(marker)});`,
    '}',
    "if (import.meta.url === pathToFileURL(argv[1] ?? '').href) { main(); }",
    'export { main };',
    '',
  ].join('\n'));
  return dir;
}

/** The real module, to prove the launcher works against what actually ships. */
function addRealVersion(cfg, version) {
  const base = join(cfg, 'plugins', 'cache', 'josephi-claude-tools', 'claude-tools', version);
  mkdirSync(join(base, 'hooks', 'lib'), { recursive: true });
  const src = join(HERE, '..', '..', '..', 'hooks');
  copyFileSync(join(src, 'statusline.mjs'), join(base, 'hooks', 'statusline.mjs'));
  for (const f of readdirSync(join(src, 'lib'))) {
    if (f.endsWith('.mjs')) copyFileSync(join(src, 'lib', f), join(base, 'hooks', 'lib', f));
  }
  return base;
}

console.log('\ninstall-launcher — installation');

step('creates the launcher at a stable path', () => {
  const cfg = cfgDir();
  const res = install(cfg);
  assert.equal(res.changed, true);
  assert.equal(res.reason, 'created');
  assert.equal(res.path, join(cfg, LAUNCHER_NAME));
  assert.ok(existsSync(res.path));
});

step('is idempotent', () => {
  const cfg = cfgDir();
  install(cfg);
  const second = install(cfg);
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'already current');
});

step('overwrites a stale launcher', () => {
  const cfg = cfgDir();
  install(cfg);
  writeFileSync(launcherPath(cfg), '// old version\n');
  const res = install(cfg);
  assert.equal(res.reason, 'updated');
  assert.equal(readFileSync(res.path, 'utf8'), LAUNCHER_SOURCE);
});

step('leaves no .tmp file behind', () => {
  const cfg = cfgDir();
  install(cfg);
  assert.ok(!existsSync(`${launcherPath(cfg)}.tmp`));
});

step('the path never contains a version number', () => {
  assert.ok(!/\d+\.\d+\.\d+/.test(launcherPath(cfgDir())));
});

step('honours CLAUDE_CONFIG_DIR', () => {
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: '/custom' }), '/custom');
});

console.log('\ninstall-launcher — resolves the newest version at run time');

const runLauncher = (cfg) => execFileSync('node', [launcherPath(cfg)], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
  stdio: ['ignore', 'pipe', 'pipe'],
});

step('delegates to the only installed version', () => {
  const cfg = cfgDir();
  install(cfg);
  addVersion(cfg, '0.6.1', 'from-0.6.1');
  assert.equal(runLauncher(cfg), 'from-0.6.1');
});

// The regression this file previously missed: statusline.mjs guards its entry
// point on import.meta.url === argv[1], and argv[1] for a launcher run is the
// launcher, so importing alone produced no output at all. Assert against the real
// module rather than a stub, since the stub is what hid it.
step('renders real output from the actual shipped statusline.mjs', () => {
  const cfg = cfgDir();
  install(cfg);
  addRealVersion(cfg, '0.6.1');

  const out = execFileSync('node', [launcherPath(cfg)], {
    encoding: 'utf8',
    cwd: join(HERE, '..', '..', '..'),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.ok(out.trim().length > 0, 'launcher produced no output at all');
  assert.match(out, /\S+\s*\|\s*\S+/, 'expected the pipe-separated statusline shape');
});

// This is the whole reason the launcher exists: an update must not require the
// user's settings.local.json to change.
step('follows a newer version without the settings path changing', () => {
  const cfg = cfgDir();
  install(cfg);
  addVersion(cfg, '0.6.1', 'from-0.6.1');
  const before = launcherPath(cfg);
  assert.equal(runLauncher(cfg), 'from-0.6.1');

  addVersion(cfg, '0.7.0', 'from-0.7.0');
  assert.equal(runLauncher(cfg), 'from-0.7.0', 'must pick up the new version');
  assert.equal(launcherPath(cfg), before, 'the configured path must not change');
});

step('orders versions numerically, not lexically', () => {
  const cfg = cfgDir();
  install(cfg);
  addVersion(cfg, '0.9.0', 'from-0.9.0');
  addVersion(cfg, '0.10.0', 'from-0.10.0');
  assert.equal(runLauncher(cfg), 'from-0.10.0');
});

console.log('\ninstall-launcher — degrades quietly');

step('prints nothing when no version is installed', () => {
  const cfg = cfgDir();
  install(cfg);
  assert.equal(runLauncher(cfg), '');
});

step('prints nothing when the cache dir does not exist at all', () => {
  const cfg = cfgDir();
  install(cfg);
  rmSync(join(cfg, 'plugins'), { recursive: true, force: true });
  assert.equal(runLauncher(cfg), '');
});

step('prints nothing when a version dir has no statusline', () => {
  const cfg = cfgDir();
  install(cfg);
  mkdirSync(join(cfg, 'plugins', 'cache', 'm', 'claude-tools', '9.9.9'), { recursive: true });
  assert.equal(runLauncher(cfg), '');
});

step('an uninstalled plugin leaves a blank statusline, not an error', () => {
  const cfg = cfgDir();
  install(cfg);
  addVersion(cfg, '0.6.1', 'x');
  rmSync(join(cfg, 'plugins', 'cache'), { recursive: true, force: true });
  assert.equal(runLauncher(cfg), '', 'must not throw or print a stack trace');
});

console.log('\ninstall-launcher — CLI');

const cli = (cfg, args = []) => execFileSync('node', [SCRIPT, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
  stdio: ['ignore', 'pipe', 'pipe'],
});

step('--print-path reports the path without installing', () => {
  const cfg = cfgDir();
  const out = cli(cfg, ['--print-path']).trim();
  assert.equal(out, launcherPath(cfg));
  assert.ok(!existsSync(out), '--print-path must not install');
});

step('--json reports what it did', () => {
  const cfg = cfgDir();
  const j = JSON.parse(cli(cfg, ['--json']));
  assert.equal(j.changed, true);
  assert.ok(j.path.endsWith(LAUNCHER_NAME));
});

step('human output gives the statusLine command to use', () => {
  assert.match(cli(cfgDir()), /node .*claude-tools-statusline\.mjs/);
});

for (const d of temps) rmSync(d, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
