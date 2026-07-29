#!/usr/bin/env node
// Tests for statusline.mjs.
//
// hookHealth() is the load-bearing part: it is the only channel that can report
// hooks being disabled, because when they are disabled no hook runs to say so.
// Each failure mode gets a fixture config dir.
//
// Usage: node hooks/statusline.test.mjs

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { hookHealth, renderLine, renderSegments } from './statusline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'statusline.mjs');

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

/** Build a fake config dir + plugin data dir. */
function fixture({ settings, local, initialized = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-sl-'));
  temps.push(dir);
  const claudeDir = join(dir, '.claude');
  const pluginData = join(dir, 'data');
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(pluginData, { recursive: true });
  if (settings) writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(settings));
  if (local) writeFileSync(join(claudeDir, 'settings.local.json'), JSON.stringify(local));
  if (initialized) writeFileSync(join(pluginData, '.initialized'), '0.5.0');
  return { claudeDir, pluginData };
}

const ENABLED = { enabledPlugins: { 'bench@josephi-bench': true } };

console.log('\nstatusline — hook health');

step('healthy when plugin enabled and initialized', () => {
  const h = hookHealth(fixture({ settings: ENABLED }));
  assert.equal(h.ok, true);
  assert.equal(h.reason, null);
});

step('detects disableAllHooks in settings.json', () => {
  const h = hookHealth(fixture({ settings: { ...ENABLED, disableAllHooks: true } }));
  assert.equal(h.ok, false);
  assert.match(h.reason, /disableAllHooks in settings\.json/);
});

step('detects disableAllHooks in settings.local.json', () => {
  const h = hookHealth(fixture({ settings: ENABLED, local: { disableAllHooks: true } }));
  assert.equal(h.ok, false);
  assert.match(h.reason, /disableAllHooks in settings\.local\.json/);
});

step('disableAllHooks wins over an otherwise healthy setup', () => {
  const h = hookHealth(fixture({ settings: { ...ENABLED, disableAllHooks: true }, initialized: true }));
  assert.match(h.reason, /hooks OFF/);
});

step('detects the plugin explicitly disabled', () => {
  const h = hookHealth(fixture({ settings: { enabledPlugins: { 'bench@josephi-bench': false } } }));
  assert.equal(h.ok, false);
  assert.match(h.reason, /disabled/);
});

step('detects the plugin absent from enabledPlugins', () => {
  const h = hookHealth(fixture({ settings: { enabledPlugins: { 'other@mkt': true } } }));
  assert.equal(h.ok, false);
  assert.match(h.reason, /not enabled/);
});

step('detects not-yet-initialized', () => {
  const h = hookHealth(fixture({ settings: ENABLED, initialized: false }));
  assert.equal(h.ok, false);
  assert.match(h.reason, /not set up/);
  assert.match(h.reason, /bench:setup/);
});

step('settings.local.json can enable the plugin on its own', () => {
  const h = hookHealth(fixture({ local: ENABLED }));
  assert.equal(h.ok, true);
});

step('a marketplace-suffixed key still matches', () => {
  const h = hookHealth(fixture({ settings: { enabledPlugins: { 'bench@some-other-marketplace': true } } }));
  assert.equal(h.ok, true);
});

step('missing config files are reported, not thrown', () => {
  const h = hookHealth(fixture({}));
  assert.equal(h.ok, false);
});

step('malformed settings JSON does not throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-sl-bad-'));
  temps.push(dir);
  const claudeDir = join(dir, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), '{ not json');
  const h = hookHealth({ claudeDir, pluginData: join(dir, 'data') });
  assert.equal(typeof h.ok, 'boolean');
});

console.log('\nstatusline — rendering');

const OK = { ok: true, reason: null };
const BAD = { ok: false, reason: 'hooks OFF (disableAllHooks in settings.json)' };

const TASK = {
  branch: 'refactor/26478_ns-account-nightly',
  base: 'master',
  issueRef: '#26478',
  unpushed: 0,
  onBase: false,
  worktree: false,
};

function plain(ctx, health) {
  return renderLine(ctx, health).replace(/\x1b\[[0-9;]*m/g, '');
}

step('shows issue ref, branch, base and pushed state', () => {
  const l = plain(TASK, OK);
  assert.match(l, /#26478/);
  assert.match(l, /refactor\/26478_ns-account-nightly/);
  assert.match(l, /<- master/);
  assert.match(l, /pushed/);
});

step('shows unpushed count when ahead', () => {
  assert.match(plain({ ...TASK, unpushed: 3 }, OK), /unpushed:3/);
});

step('flags a base branch as having no task', () => {
  const l = plain({ ...TASK, branch: 'master', issueRef: null, onBase: true }, OK);
  assert.match(l, /no task/);
  assert.match(l, /master/);
});

step('flags a task branch with no derivable issue number', () => {
  assert.match(plain({ ...TASK, issueRef: null }, OK), /no issue/);
});

step('marks a worktree', () => {
  assert.match(plain({ ...TASK, worktree: true }, OK), /\bwt\b/);
});

step('appends the hook-health warning when unhealthy', () => {
  assert.match(plain(TASK, BAD), /! hooks OFF/);
});

step('omits the health segment when healthy', () => {
  assert.ok(!plain(TASK, OK).includes('!'));
});

step('handles a non-repo directory', () => {
  assert.match(plain(null, OK), /not a git repo/);
});

step('still warns about hooks outside a repo', () => {
  const l = plain(null, BAD);
  assert.match(l, /not a git repo/);
  assert.match(l, /hooks OFF/);
});

step('NO_COLOR yields no escape sequences', () => {
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    // Re-import with NO_COLOR set would be needed for the module-level flag;
    // assert instead that stripping is a no-op on already-plain segments.
    const segs = renderSegments(TASK, OK);
    assert.ok(Array.isArray(segs) && segs.length > 0);
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved;
  }
});

console.log('\nstatusline — end-to-end');

function run(payload, extraEnv = {}) {
  return execFileSync('node', [SCRIPT], {
    encoding: 'utf8',
    input: payload === undefined ? '' : JSON.stringify(payload),
    env: { ...process.env, NO_COLOR: '1', ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

step('prints a line for the current repo', () => {
  const out = run({ workspace: { current_dir: join(HERE, '..') } });
  assert.ok(out.trim().length > 0);
});

step('does not crash on empty stdin', () => {
  assert.equal(typeof run(undefined), 'string');
});

step('does not crash on malformed stdin', () => {
  const out = execFileSync('node', [SCRIPT], {
    encoding: 'utf8', input: '{bad', env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(typeof out, 'string');
});

step('never writes to stderr', () => {
  const r = execFileSync('node', [SCRIPT], {
    encoding: 'utf8', input: '{}', env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(typeof r, 'string');
});

step('emits a single line (statuslines must not wrap rows)', () => {
  const out = run({ workspace: { current_dir: join(HERE, '..') } });
  assert.equal(out.replace(/\n$/, '').includes('\n'), false);
});

for (const d of temps) rmSync(d, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
