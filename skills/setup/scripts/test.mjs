#!/usr/bin/env node
// Tests for uninstall-legacy.mjs.
//
// Runs against real fixture config dirs. The load-bearing property is that only
// manifest-listed paths are removed — a bug here deletes a colleague's own
// skills, so the "leaves unlisted files alone" case is asserted explicitly.
//
// Usage: node test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { plan, readManifest, legacyRulesSection, run, configDir, isSafeEntry, MANIFEST_NAME } from './uninstall-legacy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'uninstall-legacy.mjs');

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

/**
 * Build a fixture config dir.
 * `owned` goes into the manifest; `extra` does not (must survive).
 */
function fixture({ owned = {}, extra = {}, manifest = true, malformed = false, claudeMd = null } = {}) {
  const cfg = mkdtempSync(join(tmpdir(), 'claude-tools-legacy-'));
  temps.push(cfg);

  for (const name of owned.skills ?? []) {
    mkdirSync(join(cfg, 'skills', name), { recursive: true });
    writeFileSync(join(cfg, 'skills', name, 'SKILL.md'), '# x\n');
  }
  for (const name of owned.agents ?? []) {
    mkdirSync(join(cfg, 'agents'), { recursive: true });
    writeFileSync(join(cfg, 'agents', `${name}.md`), '# x\n');
  }
  for (const name of owned.commands ?? []) {
    mkdirSync(join(cfg, 'commands'), { recursive: true });
    writeFileSync(join(cfg, 'commands', `${name}.md`), '# x\n');
  }
  for (const name of extra.skills ?? []) {
    mkdirSync(join(cfg, 'skills', name), { recursive: true });
    writeFileSync(join(cfg, 'skills', name, 'SKILL.md'), '# mine\n');
  }
  for (const name of extra.agents ?? []) {
    mkdirSync(join(cfg, 'agents'), { recursive: true });
    writeFileSync(join(cfg, 'agents', `${name}.md`), '# mine\n');
  }

  if (manifest) {
    writeFileSync(join(cfg, MANIFEST_NAME), malformed ? '{ not json' : JSON.stringify({
      version: '1',
      skills: owned.skills ?? [],
      agents: (owned.agents ?? []).map((n) => `${n}.md`),
      commands: (owned.commands ?? []).map((n) => `${n}.md`),
    }));
  }

  if (claudeMd !== null) writeFileSync(join(cfg, 'CLAUDE.md'), claudeMd);

  return cfg;
}

const envFor = (cfg) => ({ CLAUDE_CONFIG_DIR: cfg });

console.log('\nuninstall-legacy — config dir resolution');

step('honours CLAUDE_CONFIG_DIR', () => {
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: '/custom/dir' }), '/custom/dir');
});

step('falls back to ~/.claude', () => {
  assert.match(configDir({}), /\.claude$/);
});

console.log('\nuninstall-legacy — planning');

step('lists what the manifest owns and still exists', () => {
  const cfg = fixture({ owned: { skills: ['jira', 'deslop'], agents: ['code-reviewer'], commands: ['setup'] } });
  const p = plan(cfg, readManifest(cfg));
  assert.equal(p.skills.length, 2);
  assert.equal(p.agents.length, 1);
  assert.equal(p.commands.length, 1);
  assert.equal(p.missing, 0);
});

step('counts manifest entries already gone', () => {
  const cfg = fixture({ owned: { skills: ['jira'] } });
  rmSync(join(cfg, 'skills', 'jira'), { recursive: true, force: true });
  const p = plan(cfg, readManifest(cfg));
  assert.equal(p.skills.length, 0);
  assert.equal(p.missing, 1);
});

step('no manifest yields an empty plan', () => {
  const cfg = fixture({ manifest: false });
  assert.equal(readManifest(cfg), null);
  assert.equal(plan(cfg, null).skills.length, 0);
});

step('malformed manifest is flagged, not parsed', () => {
  const cfg = fixture({ malformed: true });
  assert.equal(readManifest(cfg).malformed, true);
  assert.equal(plan(cfg, readManifest(cfg)).skills.length, 0);
});

console.log('\nuninstall-legacy — unsafe manifest entries are refused');

step('isSafeEntry accepts plain names only', () => {
  for (const ok of ['jira', 'code-reviewer.md', 'tip_health']) assert.ok(isSafeEntry(ok), ok);
  for (const bad of [
    '../../../Documents', '/etc/passwd', 'a/b', '..', '.', '.ssh', '', null, undefined, 42, {},
  ]) {
    assert.ok(!isSafeEntry(bad), JSON.stringify(bad));
  }
});

// The manifest is the sole authority for a recursive delete and lives in a
// user-writable file, so a traversal entry must never reach rmSync.
step('a traversal entry is rejected, not resolved', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'claude-tools-legacy-'));
  temps.push(cfg);
  mkdirSync(join(cfg, 'skills', 'real'), { recursive: true });
  writeFileSync(join(cfg, 'skills', 'real', 'SKILL.md'), '# x\n');
  const outside = join(cfg, 'outside-the-config-dir');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(cfg, MANIFEST_NAME), JSON.stringify({
    skills: ['real', '../outside-the-config-dir'], agents: [], commands: [],
  }));

  const p = plan(cfg, readManifest(cfg));
  assert.equal(p.skills.length, 1, 'only the safe entry is planned');
  assert.deepEqual(p.rejected, ['../outside-the-config-dir']);

  run({ apply: true, e: { CLAUDE_CONFIG_DIR: cfg } });
  assert.ok(existsSync(outside), 'a path outside the config dir MUST survive');
  assert.ok(!existsSync(join(cfg, 'skills', 'real')), 'the safe entry is still removed');
});

step('a non-string entry does not throw', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'claude-tools-legacy-'));
  temps.push(cfg);
  writeFileSync(join(cfg, MANIFEST_NAME), JSON.stringify({ skills: [42, null], agents: [], commands: [] }));
  const p = plan(cfg, readManifest(cfg));
  assert.equal(p.skills.length, 0);
  assert.equal(p.rejected.length, 2);
});

step('the report names refused entries rather than hiding them', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'claude-tools-legacy-'));
  temps.push(cfg);
  writeFileSync(join(cfg, MANIFEST_NAME), JSON.stringify({ skills: ['../evil'], agents: [], commands: [] }));
  assert.match(cli(cfg), /REFUSED/);
});

console.log('\nuninstall-legacy — removal');

step('removes only manifest-listed paths', () => {
  const cfg = fixture({
    owned: { skills: ['jira', 'deslop'], agents: ['code-reviewer'] },
    extra: { skills: ['my-own-skill'], agents: ['my-own-agent'] },
  });
  const res = run({ apply: true, e: envFor(cfg) });

  assert.equal(res.failed.length, 0);
  assert.ok(!existsSync(join(cfg, 'skills', 'jira')), 'owned skill should be gone');
  assert.ok(!existsSync(join(cfg, 'skills', 'deslop')), 'owned skill should be gone');
  assert.ok(!existsSync(join(cfg, 'agents', 'code-reviewer.md')), 'owned agent should be gone');

  assert.ok(existsSync(join(cfg, 'skills', 'my-own-skill')), 'UNLISTED skill must survive');
  assert.ok(existsSync(join(cfg, 'agents', 'my-own-agent.md')), 'UNLISTED agent must survive');
});

step('deletes the manifest after a clean removal', () => {
  const cfg = fixture({ owned: { skills: ['jira'] } });
  run({ apply: true, e: envFor(cfg) });
  assert.ok(!existsSync(join(cfg, MANIFEST_NAME)), 'manifest should be gone');
});

step('dry run removes nothing', () => {
  const cfg = fixture({ owned: { skills: ['jira'] } });
  const res = run({ apply: false, e: envFor(cfg) });
  assert.equal(res.applied, false);
  assert.equal(res.removed.length, 0);
  assert.ok(existsSync(join(cfg, 'skills', 'jira')), 'dry run must not delete');
  assert.ok(existsSync(join(cfg, MANIFEST_NAME)), 'dry run must keep the manifest');
});

step('is idempotent — a second apply is a no-op', () => {
  const cfg = fixture({ owned: { skills: ['jira'] } });
  run({ apply: true, e: envFor(cfg) });
  const second = run({ apply: true, e: envFor(cfg) });
  assert.equal(second.manifest, null);
  assert.equal(second.failed.length, 0);
});

step('malformed manifest removes nothing', () => {
  const cfg = fixture({ owned: { skills: ['jira'] }, malformed: true });
  run({ apply: true, e: envFor(cfg) });
  assert.ok(existsSync(join(cfg, 'skills', 'jira')), 'must not delete on an untrustworthy manifest');
});

console.log('\nuninstall-legacy — legacy CLAUDE.md rules section');

step('detects a sync.mjs "# Rules" section', () => {
  const cfg = fixture({ claudeMd: '# Global Principles\n\nstuff\n\n---\n\n# Rules\n\nrule a\nrule b\n' });
  const r = legacyRulesSection(cfg);
  assert.ok(r, 'expected detection');
  assert.equal(r.hasMarker, false);
  assert.ok(r.lineCount > 0);
});

step('stops at the plugin marker block when both are present', () => {
  const cfg = fixture({
    claudeMd: '# Global Principles\n\n# Rules\n\nold a\nold b\n\n<!-- BEGIN claude-tools rules -->\nnew\n<!-- END claude-tools rules -->\n',
  });
  const r = legacyRulesSection(cfg);
  assert.equal(r.hasMarker, true);
  assert.ok(r.lineCount < 8, `section should stop at the marker, got ${r.lineCount}`);
});

step('null when there is no legacy section', () => {
  assert.equal(legacyRulesSection(fixture({ claudeMd: '# Global Principles\n\nnothing here\n' })), null);
});

step('null when CLAUDE.md is absent', () => {
  assert.equal(legacyRulesSection(fixture({})), null);
});

step('does not match a heading that merely starts with Rules', () => {
  assert.equal(legacyRulesSection(fixture({ claudeMd: '# Rules of thumb\n\nx\n' })), null);
});

step('removal never edits CLAUDE.md (setup rewrites it)', () => {
  const md = '# Global Principles\n\n# Rules\n\nold\n';
  const cfg = fixture({ owned: { skills: ['jira'] }, claudeMd: md });
  run({ apply: true, e: envFor(cfg) });
  assert.equal(readFileSync(join(cfg, 'CLAUDE.md'), 'utf8'), md);
});

console.log('\nuninstall-legacy — CLI');

function cli(cfg, args = []) {
  return execFileSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

step('--json reports counts without applying', () => {
  const cfg = fixture({ owned: { skills: ['jira', 'deslop'] } });
  const out = JSON.parse(cli(cfg, ['--json']));
  assert.equal(out.counts.skills, 2);
  assert.equal(out.applied, false);
  assert.ok(existsSync(join(cfg, 'skills', 'jira')));
});

step('--apply --json reports the removal', () => {
  const cfg = fixture({ owned: { skills: ['jira'] } });
  const out = JSON.parse(cli(cfg, ['--apply', '--json']));
  assert.equal(out.applied, true);
  assert.equal(out.removed, 1);
  assert.ok(!existsSync(join(cfg, 'skills', 'jira')));
});

step('human output states nothing to do when no manifest', () => {
  assert.match(cli(fixture({ manifest: false })), /never used here/i);
});

step('human output tells the user how to apply', () => {
  assert.match(cli(fixture({ owned: { skills: ['jira'] } })), /--apply/);
});

step('exits 0 on success', () => {
  const cfg = fixture({ owned: { skills: ['jira'] } });
  cli(cfg, ['--apply']);
  assert.ok(true);
});

for (const d of temps) rmSync(d, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
