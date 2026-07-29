#!/usr/bin/env node
// Tests for check-init.mjs (the SessionStart auto-trigger hook).
// Unit-tests buildContext(), then runs the script end-to-end against a temp
// plugin root + data dir to assert the emitted SessionStart JSON envelope.
//
// Usage: node check-init.test.mjs

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { buildContext, buildUpdateReport } from './check-init.mjs';

// The real plugin root, so the update-report tests read the shipped CHANGELOG.md
// rather than a fixture that could drift from its actual format.
const REAL_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SCRIPT = fileURLToPath(new URL('./check-init.mjs', import.meta.url));

// Read from the manifest rather than hardcoding, so a version bump does not
// silently stop asserting that the report names the new version.
const CURRENT_VERSION = JSON.parse(
  readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'),
).version;

let pass = 0;
let fail = 0;

// Rejects async callbacks. An un-awaited promise here reports `ok` before its
// assertions run and surfaces the real failure after the summary, so a broken
// test looks green. Keep step bodies synchronous and use the *Sync fs APIs.
function step(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      throw new Error('step callback must be synchronous — use the *Sync fs APIs');
    }
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

// Run the script with the given env; return parsed stdout JSON or null (no output).
function run(env) {
  const out = execFileSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return out ? JSON.parse(out) : null;
}

// ── buildContext unit tests ──

step('buildContext: absent guard → first-init message with version', () => {
  const ctx = buildContext('0.2.0', null);
  assert.ok(ctx, 'expected non-null context');
  assert.match(ctx, /0\.2\.0/);
  assert.match(ctx, /not yet initialized/i);
  assert.match(ctx, /claude-tools:setup/);
});

step('buildContext: names only the one setup skill, never the removed ones', () => {
  for (const ctx of [buildContext('0.6.0', null), buildContext('0.6.0', '0.5.0')]) {
    assert.ok(!/claude-tools-init|claude-tools-rules-install/.test(ctx),
      `context still references a removed skill: ${ctx}`);
  }
});

step('buildContext: version mismatch → update message with both versions', () => {
  const ctx = buildContext('0.3.0', '0.2.0');
  assert.ok(ctx, 'expected non-null context');
  assert.match(ctx, /updated/i);
  assert.match(ctx, /0\.2\.0/);
  assert.match(ctx, /0\.3\.0/);
});

step('buildContext: legacy empty guard → update message (labelled legacy)', () => {
  const ctx = buildContext('0.2.0', '');
  assert.ok(ctx, 'expected non-null context');
  assert.match(ctx, /legacy/);
  assert.match(ctx, /0\.2\.0/);
});

step('buildContext: matching version → null (silent)', () => {
  assert.equal(buildContext('0.2.0', '0.2.0'), null);
});

// An unresolvable plugin root reports 'unknown'. With a real guard version that
// made guard !== installed true, so the hook claimed "updated to vunknown" every
// session and recorded 'unknown' as the seen-version.
step('buildContext: unknown installed version with a real guard → null', () => {
  assert.equal(buildContext('unknown', '0.6.1'), null);
});

step('buildContext: unknown installed version with NO guard still nags', () => {
  const ctx = buildContext('unknown', null);
  assert.ok(ctx, 'a first install with a broken root should still ask for setup');
  assert.match(ctx, /unknown/);
});

// ── end-to-end script tests ──

let tmpRoot = null;

async function main() {
  tmpRoot = await mkdtemp(join(tmpdir(), 'claude-tools-hook-'));
  const pluginRoot = join(tmpRoot, 'plugin');
  const dataDir = join(tmpRoot, 'data');
  await mkdir(join(pluginRoot, '.claude-plugin'), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(pluginRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'claude-tools', version: '9.9.9' }));

  const baseEnv = { CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: dataDir };

  // Guard files for the update-report tests: one behind the shipped version, and
  // one absent (first install).
  const staleData = join(tmpRoot, 'stale-data');
  await mkdir(staleData, { recursive: true });
  await writeFile(join(staleData, '.initialized'), '0.5.0');
  await mkdir(join(tmpRoot, 'empty-data'), { recursive: true });

  step('e2e: no guard file → emits SessionStart additionalContext', () => {
    const res = run(baseEnv);
    assert.ok(res, 'expected JSON output');
    assert.equal(res.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(res.hookSpecificOutput.additionalContext, /9\.9\.9/);
    assert.match(res.hookSpecificOutput.additionalContext, /not yet initialized/i);
  });

  await writeFile(join(dataDir, '.initialized'), '9.9.9');
  step('e2e: guard matches installed version → silent', () => {
    assert.equal(run(baseEnv), null);
  });

  await writeFile(join(dataDir, '.initialized'), '9.9.8');
  step('e2e: guard older than installed version → update message', () => {
    const res = run(baseEnv);
    assert.ok(res, 'expected JSON output');
    assert.match(res.hookSpecificOutput.additionalContext, /updated/i);
  });

  step('e2e: missing plugin.json → still exits 0 with unknown version', () => {
    const res = run({ CLAUDE_PLUGIN_ROOT: join(tmpRoot, 'nope'), CLAUDE_PLUGIN_DATA: join(tmpRoot, 'empty-data') });
    assert.ok(res, 'expected JSON output (guard absent)');
    assert.match(res.hookSpecificOutput.additionalContext, /unknown/);
  });

  // The update report is the user-facing half: additionalContext tells the model
  // to run setup, systemMessage tells the human what changed.
  step('buildUpdateReport: null on a first install (nothing has "changed")', () => {
    assert.equal(buildUpdateReport('0.6.0', null), null);
  });

  step('buildUpdateReport: null when already current', () => {
    assert.equal(buildUpdateReport('0.6.0', '0.6.0'), null);
  });

  step('e2e: an update emits the changelog as systemMessage', () => {
    const res = run({
      CLAUDE_PLUGIN_ROOT: REAL_ROOT,
      CLAUDE_PLUGIN_DATA: join(tmpRoot, 'stale-data'),
    });
    assert.ok(res, 'expected JSON output');
    assert.ok(res.systemMessage, 'expected a user-facing systemMessage');
    // Assert on the report's structure, not on changelog prose — the work
    // original matched a phrase that happened to appear in its own entry body,
    // which broke the moment the file was rewritten for this plugin.
    assert.match(res.systemMessage, /claude-tools updated/i);
    assert.match(res.systemMessage, /TL;DR/);
    assert.ok(res.systemMessage.includes(CURRENT_VERSION), 'report names the new version');
    assert.match(res.hookSpecificOutput.additionalContext, /updated/i);
  });

  step('e2e: a first install emits no systemMessage', () => {
    const res = run({ CLAUDE_PLUGIN_ROOT: REAL_ROOT, CLAUDE_PLUGIN_DATA: join(tmpRoot, 'empty-data') });
    assert.ok(res.hookSpecificOutput.additionalContext, 'expected context');
    assert.equal(res.systemMessage, undefined);
  });

  // The full changelog is worth reading once. Reprinting it every session until
  // setup runs trains people to skip it, and the guard can stay unset for days.
  const onceData = join(tmpRoot, 'once-data');
  await mkdir(onceData, { recursive: true });
  await writeFile(join(onceData, '.initialized'), '0.5.0');

  step('e2e: the full report is shown once, then a one-liner', () => {
    const env2 = { CLAUDE_PLUGIN_ROOT: REAL_ROOT, CLAUDE_PLUGIN_DATA: onceData, NO_COLOR: '1' };

    const first = run(env2);
    assert.match(first.systemMessage, /TL;DR/, 'first session should get the full report');
    assert.ok(first.systemMessage.includes('\n'), 'full report is multi-line');

    const second = run(env2);
    assert.ok(!second.systemMessage.includes('TL;DR'), 'second session must not repeat the changelog');
    assert.ok(!second.systemMessage.includes('\n'), 'reminder is a single line');
    assert.match(second.systemMessage, /\/claude-tools:setup/, 'still tells them what to run');

    const third = run(env2);
    assert.equal(third.systemMessage, second.systemMessage, 'stays a one-liner');
  });

  step('e2e: the model is still told to run setup on every session', () => {
    const res = run({ CLAUDE_PLUGIN_ROOT: REAL_ROOT, CLAUDE_PLUGIN_DATA: onceData, NO_COLOR: '1' });
    assert.match(res.hookSpecificOutput.additionalContext, /claude-tools:setup/);
  });

  step('e2e: a version whose changelog was never shown reports in full', () => {
    const env2 = { CLAUDE_PLUGIN_ROOT: REAL_ROOT, CLAUDE_PLUGIN_DATA: onceData, NO_COLOR: '1' };
    writeFileSync(join(onceData, '.changelog-seen'), '0.0.1');
    assert.match(run(env2).systemMessage, /TL;DR/, 'a version we have not seen shows in full');
  });

  step('e2e: honours NO_COLOR', () => {
    const plainData = join(tmpRoot, 'plain-data');
    mkdirSync(plainData, { recursive: true });
    writeFileSync(join(plainData, '.initialized'), '0.5.0');
    const res = run({ CLAUDE_PLUGIN_ROOT: REAL_ROOT, CLAUDE_PLUGIN_DATA: plainData, NO_COLOR: '1' });
    assert.ok(!/\x1b\[/.test(res.systemMessage), 'expected no escape codes under NO_COLOR');
  });

  // The contract at the top of check-init.mjs says exit 0 always. Every other
  // hook has a fail-open test; this one asserted the contract only in prose.
  step('e2e: fails open on a garbage plugin root', () => {
    const res = run({
      CLAUDE_PLUGIN_ROOT: join(tmpRoot, 'does-not-exist'),
      CLAUDE_PLUGIN_DATA: join(tmpRoot, 'empty-data'),
    });
    assert.ok(res === null || typeof res === 'object', 'must not crash');
  });

  step('e2e: fails open on an unparseable CHANGELOG', () => {
    const brokenRoot = join(tmpRoot, 'broken-plugin');
    mkdirSync(join(brokenRoot, '.claude-plugin'), { recursive: true });
    writeFileSync(join(brokenRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'claude-tools', version: '5.5.5' }));
    writeFileSync(join(brokenRoot, 'CHANGELOG.md'), 'not a changelog at all');

    const data = join(tmpRoot, 'broken-data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, '.initialized'), '5.5.4');

    const res = run({ CLAUDE_PLUGIN_ROOT: brokenRoot, CLAUDE_PLUGIN_DATA: data, NO_COLOR: '1' });
    assert.ok(res, 'still reports the update');
    assert.match(res.hookSpecificOutput.additionalContext, /updated/i,
      'the model is still told to run setup even with no usable changelog');
  });

  step('e2e: an unwritable data dir does not break session start', () => {
    const res = run({
      CLAUDE_PLUGIN_ROOT: REAL_ROOT,
      CLAUDE_PLUGIN_DATA: '/proc/nonexistent-unwritable',
      NO_COLOR: '1',
    });
    assert.ok(res === null || typeof res === 'object');
  });

  step('e2e: colour uses scoped closes, never a full reset', () => {
    const colorData = join(tmpRoot, 'color-data');
    mkdirSync(colorData, { recursive: true });
    writeFileSync(join(colorData, '.initialized'), '0.5.0');
    const res = run({
      CLAUDE_PLUGIN_ROOT: REAL_ROOT, CLAUDE_PLUGIN_DATA: colorData, CLAUDE_TOOLS_REPORT_COLOR: '1',
    });
    assert.match(res.systemMessage, /\x1b\[36m/, 'expected colour');
    assert.ok(!res.systemMessage.includes('\x1b[0m'),
      'a full reset would clear the host dim styling for the rest of the message');
  });
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
