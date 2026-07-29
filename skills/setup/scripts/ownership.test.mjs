#!/usr/bin/env node
// Tests for ownership.mjs.
//
// The load-bearing property: uninstall must leave the user with what they had.
// Every case where the plugin might over-claim gets an explicit assertion, since
// the failure mode is deleting a colleague's credentials.
//
// Usage: node ownership.test.mjs

import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  chmodSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import {
  writeRecord, readRecord, planRevert, applyRevert, removeRecord, render, fingerprint, matchesWritten,
  RECORD_NAME, configDir, pluginDataDir,
} from './ownership.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'ownership.mjs');

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

function fixture(settingsLocal) {
  const root = mkdtempSync(join(tmpdir(), 'claude-tools-own-'));
  temps.push(root);
  const cfg = join(root, '.claude');
  const data = join(root, 'data');
  mkdirSync(cfg, { recursive: true });
  mkdirSync(data, { recursive: true });
  if (settingsLocal !== undefined) {
    writeFileSync(join(cfg, 'settings.local.json'), JSON.stringify(settingsLocal, null, 2));
  }
  return { cfg, data };
}

const settingsOf = (cfg) => JSON.parse(readFileSync(join(cfg, 'settings.local.json'), 'utf8'));

console.log('\nownership — path resolution');

step('honours CLAUDE_CONFIG_DIR and CLAUDE_PLUGIN_DATA', () => {
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: '/c' }), '/c');
  assert.equal(pluginDataDir({ CLAUDE_PLUGIN_DATA: '/d' }), '/d');
});

step('derives plugin data from the config dir when unset', () => {
  assert.match(pluginDataDir({ CLAUDE_CONFIG_DIR: '/c' }), /^\/c\/plugins\/data\//);
});

console.log('\nownership — recording');

step('writes a record and reads it back', () => {
  const { data } = fixture({});
  writeRecord(data, {
    settingsLocal: { env: { JIRA_URL: { action: 'added', wroteValue: 'u' } } },
  }, { pluginVersion: '0.6.0' });
  const r = readRecord(data);
  assert.equal(r.version, 1);
  assert.equal(r.pluginVersion, '0.6.0');
  assert.equal(r.settingsLocal.env.JIRA_URL.action, 'added');
});

step('a re-run does not downgrade an earlier "replaced" to "added"', () => {
  const { data } = fixture({});
  writeRecord(data, {
    settingsLocal: { env: { K: { action: 'replaced', previous: 'old', wroteValue: 'new' } } },
  });
  writeRecord(data, {
    settingsLocal: { env: { K: { action: 'added', wroteValue: 'new' } } },
  });
  const r = readRecord(data);
  assert.equal(r.settingsLocal.env.K.action, 'replaced', 'first observation must win');
  assert.equal(r.settingsLocal.env.K.previous, 'old');
});

// A whole-entry merge would keep the first run's wroteValue, leaving the record
// disagreeing with the file after a re-run — uninstall would then skip a key we
// wrote as "user-modified".
step('a re-run takes the latest wroteValue but the earliest action', () => {
  const { data } = fixture({});
  writeRecord(data, { settingsLocal: { env: { K: { action: 'replaced', previous: 'old', wroteValue: 'dev' } } } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'dev,master' } } } });
  const m = readRecord(data).settingsLocal.env.K;
  assert.equal(m.action, 'replaced', 'action stays earliest-wins');
  assert.equal(m.previous, 'old', 'previous stays earliest-wins');
  assert.equal(m.wroteValue, 'dev,master', 'wroteValue must be latest-wins');
});

step('a rewritten key is still revertable after a second setup run', () => {
  const { cfg, data } = fixture({ env: { K: 'dev,master' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'dev' } } } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'dev,master' } } } });
  assert.deepEqual(planRevert(cfg, data).env.remove, ['K'],
    'the key we rewrote must not be skipped as user-modified');
});

step('switching a key from value to hash drops the stale value', () => {
  const { data } = fixture({});
  writeRecord(data, { settingsLocal: { env: { T: { action: 'added', wroteValue: 'plaintext' } } } });
  writeRecord(data, { settingsLocal: { env: { T: { action: 'added', wroteHash: 'sha256:abc' } } } });
  const m = readRecord(data).settingsLocal.env.T;
  assert.equal(m.wroteHash, 'sha256:abc');
  assert.equal(m.wroteValue, undefined, 'plaintext must not linger once hashed');
});

step('a re-run adds newly recorded keys', () => {
  const { data } = fixture({});
  writeRecord(data, { settingsLocal: { env: { A: { action: 'added', wroteValue: '1' } } } });
  writeRecord(data, { settingsLocal: { env: { B: { action: 'added', wroteValue: '2' } } } });
  const r = readRecord(data);
  assert.deepEqual(Object.keys(r.settingsLocal.env).sort(), ['A', 'B']);
});

step('no record yields an empty plan', () => {
  const { cfg, data } = fixture({ env: { JIRA_URL: 'u' } });
  const plan = planRevert(cfg, data);
  assert.equal(plan.recordPresent, false);
  assert.deepEqual(plan.env.remove, []);
});

// The env fix was not applied to the two sibling fields, so a re-run kept the
// first run's statusLine command and dropped later deny rules. That strands both
// at uninstall — for statusLine it bit everyone who set up before the launcher.
step('statusLine takes the latest recorded command across runs', () => {
  const { data } = fixture({});
  writeRecord(data, { settingsLocal: { statusLine: { action: 'added', wroteValue: 'node /OLD/0.6.0/statusline.mjs' } } });
  writeRecord(data, { settingsLocal: { statusLine: { action: 'added', wroteValue: 'node /cfg/claude-tools-statusline.mjs' } } });
  assert.equal(readRecord(data).settingsLocal.statusLine.wroteValue, 'node /cfg/claude-tools-statusline.mjs');
});

step('a repointed statusLine is still revertable after a re-run', () => {
  const cmd = 'node /cfg/claude-tools-statusline.mjs';
  const { cfg, data } = fixture({ statusLine: { type: 'command', command: cmd } });
  writeRecord(data, { settingsLocal: { statusLine: { action: 'added', wroteValue: 'node /OLD/0.6.0/statusline.mjs' } } });
  writeRecord(data, { settingsLocal: { statusLine: { action: 'added', wroteValue: cmd } } });
  assert.equal(planRevert(cfg, data).statusLine.action, 'remove',
    'must not be skipped as user-modified for a command we wrote');
});

step('deny entries union across runs instead of keeping only the first', () => {
  const { data } = fixture({});
  writeRecord(data, { settingsLocal: { permissionsDeny: { action: 'appended', entries: ['A'] } } });
  writeRecord(data, { settingsLocal: { permissionsDeny: { action: 'appended', entries: ['A', 'B', 'C'] } } });
  assert.deepEqual(readRecord(data).settingsLocal.permissionsDeny.entries, ['A', 'B', 'C']);
});

step('deny rules added by a later release are still removed', () => {
  const { cfg, data } = fixture({ permissions: { deny: ['A', 'B', 'theirs'] } });
  writeRecord(data, { settingsLocal: { permissionsDeny: { action: 'appended', entries: ['A'] } } });
  writeRecord(data, { settingsLocal: { permissionsDeny: { action: 'appended', entries: ['A', 'B'] } } });
  applyRevert(cfg, planRevert(cfg, data));
  assert.deepEqual(settingsOf(cfg).permissions.deny, ['theirs']);
});

console.log('\nownership — the user keeps what they had');

step('never removes an env key it did not record', () => {
  const { cfg, data } = fixture({ env: { OURS: 'x', THEIRS: 'y' } });
  writeRecord(data, { settingsLocal: { env: { OURS: { action: 'added', wroteValue: 'x' } } } });
  const plan = planRevert(cfg, data);
  assert.deepEqual(plan.env.remove, ['OURS']);
  applyRevert(cfg, plan);
  const s = settingsOf(cfg);
  assert.equal(s.env.OURS, undefined, 'our key should be gone');
  assert.equal(s.env.THEIRS, 'y', 'their key MUST survive');
});

step('restores a placeholder we overwrote instead of deleting it', () => {
  const { cfg, data } = fixture({ env: { K: 'real-value' } });
  writeRecord(data, {
    settingsLocal: { env: { K: { action: 'replaced', previous: '<your-token>', wroteValue: 'real-value' } } },
  });
  const plan = planRevert(cfg, data);
  assert.deepEqual(plan.env.restore, [{ key: 'K', previous: '<your-token>' }]);
  applyRevert(cfg, plan);
  assert.equal(settingsOf(cfg).env.K, '<your-token>');
});

step('refuses to touch a key the user edited after setup', () => {
  const { cfg, data } = fixture({ env: { K: 'user-changed-this' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'what-we-wrote' } } } });
  const plan = planRevert(cfg, data);
  assert.deepEqual(plan.env.remove, []);
  assert.equal(plan.env.skipped[0].reason, 'user-modified since setup');
  applyRevert(cfg, plan);
  assert.equal(settingsOf(cfg).env.K, 'user-changed-this', 'user edit MUST survive');
});

step('tolerates a key already removed by hand', () => {
  const { cfg, data } = fixture({ env: {} });
  writeRecord(data, { settingsLocal: { env: { GONE: { action: 'added', wroteValue: 'x' } } } });
  const plan = planRevert(cfg, data);
  assert.equal(plan.env.skipped[0].reason, 'already absent');
});

step('preserves unrelated top-level keys', () => {
  const { cfg, data } = fixture({ env: { OURS: 'x' }, sandbox: { enabled: true }, theme: 'dracula' });
  writeRecord(data, { settingsLocal: { env: { OURS: { action: 'added', wroteValue: 'x' } } } });
  applyRevert(cfg, planRevert(cfg, data));
  const s = settingsOf(cfg);
  assert.deepEqual(s.sandbox, { enabled: true });
  assert.equal(s.theme, 'dracula');
});

console.log('\nownership — secrets are guarded by hash, not plaintext');

step('fingerprint is stable and does not contain the value', () => {
  const h = fingerprint('super-secret-pat');
  assert.equal(h, fingerprint('super-secret-pat'));
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!h.includes('super-secret'));
});

step('a secret is removed when unchanged', () => {
  const { cfg, data } = fixture({ env: { TOKEN: 'pat-abc' } });
  writeRecord(data, {
    settingsLocal: { env: { TOKEN: { action: 'added', wroteHash: fingerprint('pat-abc') } } },
  });
  assert.deepEqual(planRevert(cfg, data).env.remove, ['TOKEN']);
});

// Without a value-match guard, rotating a token then uninstalling deletes it.
// Hashing gives the guard without storing the token.
step('a ROTATED secret is left alone, not deleted', () => {
  const { cfg, data } = fixture({ env: { TOKEN: 'pat-rotated' } });
  writeRecord(data, {
    settingsLocal: { env: { TOKEN: { action: 'added', wroteHash: fingerprint('pat-abc') } } },
  });
  const plan = planRevert(cfg, data);
  assert.deepEqual(plan.env.remove, []);
  assert.equal(plan.env.skipped[0].reason, 'user-modified since setup');
  applyRevert(cfg, plan);
  assert.equal(settingsOf(cfg).env.TOKEN, 'pat-rotated', 'rotated token MUST survive');
});

step('the record never contains the secret itself', () => {
  const { data } = fixture({});
  writeRecord(data, {
    settingsLocal: { env: { TOKEN: { action: 'added', wroteHash: fingerprint('pat-abc') } } },
  });
  assert.ok(!readFileSync(join(data, RECORD_NAME), 'utf8').includes('pat-abc'));
});

// Deleting on "don't know" was the one guard here that erred toward destruction,
// and these entries can be credentials.
step('an entry with neither wroteValue nor wroteHash is left alone', () => {
  const { cfg, data } = fixture({ env: { TOKEN: 'secret' } });
  writeRecord(data, { settingsLocal: { env: { TOKEN: { action: 'added' } } } });
  const plan = planRevert(cfg, data);
  assert.deepEqual(plan.env.remove, []);
  assert.match(plan.env.skipped[0].reason, /no recorded value/);
  applyRevert(cfg, plan);
  assert.equal(settingsOf(cfg).env.TOKEN, 'secret', 'unverifiable credential MUST survive');
});

console.log('\nownership — a no-op revert is not success');

step('reports nothing-to-revert instead of claiming it applied', () => {
  const { cfg, data } = fixture({ env: { THEIRS: 'x' } });
  writeRecord(data, { settingsLocal: { env: { GONE: { action: 'added', wroteValue: 'x' } } } });
  const res = applyRevert(cfg, planRevert(cfg, data));
  assert.equal(res.changed, false);
  assert.match(res.reason, /nothing to revert/);
});

step('keeps the record when there was nothing to revert', () => {
  const { cfg, data } = fixture({ env: { THEIRS: 'x' } });
  writeRecord(data, { settingsLocal: { env: { GONE: { action: 'added', wroteValue: 'x' } } } });
  try { cli(cfg, data, ['revert', '--apply']); } catch { /* exits 1 */ }
  assert.ok(existsSync(join(data, RECORD_NAME)),
    'a key skipped as user-modified would otherwise become unrevertable');
});

step('does not reformat the settings file when it changes nothing', () => {
  const { cfg, data } = fixture(undefined);
  const compact = '{"env":{"THEIRS":"x"},"customFormatting":true}';
  writeFileSync(join(cfg, 'settings.local.json'), compact);
  writeRecord(data, { settingsLocal: { env: { GONE: { action: 'added', wroteValue: 'x' } } } });
  applyRevert(cfg, planRevert(cfg, data));
  assert.equal(readFileSync(join(cfg, 'settings.local.json'), 'utf8'), compact,
    'the user\'s formatting must survive a no-op');
});

console.log('\nownership — atomic write');

step('no .tmp file is left behind after a successful revert', () => {
  const { cfg, data } = fixture({ env: { K: 'v' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  applyRevert(cfg, planRevert(cfg, data));
  assert.ok(!existsSync(join(cfg, 'settings.local.json.claude-tools.tmp')));
});

// rename installs a NEW inode, so unlike an in-place write it does not inherit
// the original mode. A 0600 credential file was coming back as 0644.
step('preserves the file mode across the tmp+rename', () => {
  const { cfg, data } = fixture({ env: { K: 'v', THEIRS: 'keep' } });
  const p = join(cfg, 'settings.local.json');
  chmodSync(p, 0o600);
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  applyRevert(cfg, planRevert(cfg, data));
  assert.equal(statSync(p).mode & 0o777, 0o600, 'must not widen permissions on a credential file');
});

step('defaults to 0600 when the original mode cannot be read', () => {
  const { cfg, data } = fixture(undefined);
  writeFileSync(join(cfg, 'settings.local.json'), '{"env":{"K":"v"}}');
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  assert.equal(applyRevert(cfg, planRevert(cfg, data)).changed, true);
});

console.log('\nownership — record subcommand');

const recordVia = (cfg, data, payload, args = []) => execFileSync('node', [SCRIPT, 'record', ...args], {
  encoding: 'utf8',
  input: typeof payload === 'string' ? payload : JSON.stringify(payload),
  env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_DATA: data },
  stdio: ['pipe', 'pipe', 'pipe'],
});

step('writes a record from stdin', () => {
  const { cfg, data } = fixture({});
  recordVia(cfg, data, {
    pluginVersion: '0.6.1',
    settingsLocal: { env: { JIRA_URL: { action: 'added', wroteValue: 'https://j' } } },
  });
  const r = readRecord(data);
  assert.equal(r.pluginVersion, '0.6.1');
  assert.equal(r.settingsLocal.env.JIRA_URL.wroteValue, 'https://j');
});

step('separates pluginVersion/now from the settingsLocal payload', () => {
  const { cfg, data } = fixture({});
  recordVia(cfg, data, {
    pluginVersion: '9.9.9',
    now: '2026-07-28T00:00:00Z',
    settingsLocal: { env: {} },
  });
  const r = readRecord(data);
  assert.equal(r.pluginVersion, '9.9.9');
  assert.equal(r.writtenAt, '2026-07-28T00:00:00Z');
  assert.equal(r.settingsLocal.pluginVersion, undefined, 'must not leak into settingsLocal');
});

step('--json echoes the stored record', () => {
  const { cfg, data } = fixture({});
  const out = JSON.parse(recordVia(cfg, data, { settingsLocal: { env: { A: { action: 'added' } } } }, ['--json']));
  assert.equal(out.version, 1);
  assert.ok(out.settingsLocal.env.A);
});

step('exits non-zero on malformed stdin', () => {
  const { cfg, data } = fixture({});
  let code = 0;
  try { recordVia(cfg, data, '{ not json'); } catch (e) { code = e.status; }
  assert.equal(code, 1);
  assert.ok(!existsSync(join(data, RECORD_NAME)), 'must not write a record it could not parse');
});

// JSON.parse('null') succeeds, so the destructure downstream threw a TypeError
// and printed a stack trace.
step('exits non-zero on valid JSON that is not an object', () => {
  for (const payload of ['null', '42', '"a string"', '[]']) {
    const { cfg, data } = fixture({});
    let code = 0;
    let err = '';
    try { recordVia(cfg, data, payload); } catch (e) { code = e.status; err = e.stderr ?? ''; }
    assert.notEqual(code, 0, `expected non-zero for ${payload}`);
    assert.ok(!/TypeError|at Object|at file:/.test(err), `stack trace leaked for ${payload}: ${err.slice(0, 80)}`);
  }
});

step('an unknown subcommand exits 2 rather than behaving as plan', () => {
  const { cfg, data } = fixture({});
  let code = 0;
  let out = '';
  try { out = cli(cfg, data, ['revrt', '--apply']); } catch (e) { code = e.status; out = e.stdout ?? ''; }
  assert.equal(code, 2);
  assert.match(out, /unknown command/);
});

console.log('\nownership — permissions.deny');

step('removes only the rules it appended', () => {
  const { cfg, data } = fixture({
    permissions: { deny: ['Bash(rm -rf*)', 'Bash(sudo*)', 'Bash(my-own-rule)'] },
  });
  writeRecord(data, {
    settingsLocal: { permissionsDeny: { action: 'appended', entries: ['Bash(rm -rf*)', 'Bash(sudo*)'] } },
  });
  applyRevert(cfg, planRevert(cfg, data));
  assert.deepEqual(settingsOf(cfg).permissions.deny, ['Bash(my-own-rule)'], 'user rule MUST survive');
});

step('drops an emptied deny array rather than leaving []', () => {
  const { cfg, data } = fixture({ permissions: { deny: ['Bash(sudo*)'] } });
  writeRecord(data, {
    settingsLocal: { permissionsDeny: { action: 'appended', entries: ['Bash(sudo*)'] } },
  });
  applyRevert(cfg, planRevert(cfg, data));
  assert.equal(settingsOf(cfg).permissions, undefined);
});

step('skips a deny rule the user already removed', () => {
  const { cfg, data } = fixture({ permissions: { deny: ['Bash(sudo*)'] } });
  writeRecord(data, {
    settingsLocal: { permissionsDeny: { action: 'appended', entries: ['Bash(sudo*)', 'Bash(rm -rf*)'] } },
  });
  const plan = planRevert(cfg, data);
  assert.deepEqual(plan.permissionsDeny.remove, ['Bash(sudo*)']);
  assert.equal(plan.permissionsDeny.skipped[0].entry, 'Bash(rm -rf*)');
});

step('never touches a deny list it did not append to', () => {
  const { cfg, data } = fixture({ permissions: { deny: ['Bash(their-rule)'] } });
  writeRecord(data, { settingsLocal: { env: {} } });
  applyRevert(cfg, planRevert(cfg, data));
  assert.deepEqual(settingsOf(cfg).permissions.deny, ['Bash(their-rule)']);
});

console.log('\nownership — statusLine');

step('removes a statusLine it wrote', () => {
  const cmd = 'node /p/hooks/statusline.mjs';
  const { cfg, data } = fixture({ statusLine: { type: 'command', command: cmd } });
  writeRecord(data, { settingsLocal: { statusLine: { action: 'added', wroteValue: cmd } } });
  assert.equal(planRevert(cfg, data).statusLine.action, 'remove');
  applyRevert(cfg, planRevert(cfg, data));
  assert.equal(settingsOf(cfg).statusLine, undefined);
});

step('leaves a statusLine the user repointed elsewhere', () => {
  const { cfg, data } = fixture({ statusLine: { type: 'command', command: 'node /my/own.mjs' } });
  writeRecord(data, { settingsLocal: { statusLine: { action: 'added', wroteValue: 'node /p/hooks/statusline.mjs' } } });
  const plan = planRevert(cfg, data);
  assert.equal(plan.statusLine.action, 'skip');
  applyRevert(cfg, plan);
  assert.equal(settingsOf(cfg).statusLine.command, 'node /my/own.mjs');
});

console.log('\nownership — robustness');

step('missing settings.local.json does not throw', () => {
  const { cfg, data } = fixture(undefined);
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  const plan = planRevert(cfg, data);
  assert.equal(plan.env.skipped[0].reason, 'already absent');
  assert.equal(applyRevert(cfg, plan).changed, false);
});

step('malformed settings.local.json does not throw', () => {
  const { cfg, data } = fixture({});
  writeFileSync(join(cfg, 'settings.local.json'), '{ not json');
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  assert.equal(typeof planRevert(cfg, data).recordPresent, 'boolean');
});

step('unknown action is skipped, not guessed at', () => {
  const { cfg, data } = fixture({ env: { K: 'v' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'sideways', wroteValue: 'v' } } } });
  const plan = planRevert(cfg, data);
  assert.deepEqual(plan.env.remove, []);
  assert.match(plan.env.skipped[0].reason, /unknown action/);
});

step('removeRecord is idempotent', () => {
  const { data } = fixture({});
  writeRecord(data, { settingsLocal: { env: {} } });
  assert.equal(removeRecord(data), true);
  assert.equal(removeRecord(data), false);
  assert.equal(readRecord(data), null);
});

step('render explains the no-record case rather than claiming success', () => {
  const { cfg, data } = fixture({});
  assert.match(render(planRevert(cfg, data)), /no record|has no record/i);
});

console.log('\nownership — CLI');

function cli(cfg, data, args) {
  return execFileSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_DATA: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

step('plan reports without changing anything', () => {
  const { cfg, data } = fixture({ env: { K: 'v' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  const out = JSON.parse(cli(cfg, data, ['plan', '--json']));
  assert.deepEqual(out.env.remove, ['K']);
  assert.equal(out.applied, false);
  assert.equal(settingsOf(cfg).env.K, 'v');
});

step('revert --apply changes the file and clears the record', () => {
  const { cfg, data } = fixture({ env: { K: 'v', THEIRS: 'keep' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  const out = JSON.parse(cli(cfg, data, ['revert', '--apply', '--json']));
  assert.equal(out.applied, true);
  assert.equal(settingsOf(cfg).env.K, undefined);
  assert.equal(settingsOf(cfg).env.THEIRS, 'keep');
  assert.ok(!existsSync(join(data, RECORD_NAME)));
});

step('revert without a record is a safe no-op', () => {
  const { cfg, data } = fixture({ env: { THEIRS: 'keep' } });
  cli(cfg, data, ['revert', '--apply']);
  assert.equal(settingsOf(cfg).env.THEIRS, 'keep');
});

// The record is the only ownership signal. Deleting it after a failed revert
// leaves the user's plugin-written keys permanently unrevertable, and the old
// code did exactly that while still printing "Applied."
step('keeps the record when settings.local.json is unreadable', () => {
  const { cfg, data } = fixture({ env: { K: 'v' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  writeFileSync(join(cfg, 'settings.local.json'), '{ "env": { "K": "v" }, }');

  let code = 0;
  try {
    cli(cfg, data, ['revert', '--apply']);
  } catch (e) {
    code = e.status;
  }

  assert.equal(code, 1, 'a failed revert must exit non-zero');
  assert.ok(existsSync(join(data, RECORD_NAME)), 'record MUST survive a failed revert');
});

step('reports the failure reason instead of claiming success', () => {
  const { cfg, data } = fixture({ env: { K: 'v' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  writeFileSync(join(cfg, 'settings.local.json'), '{ bad json');

  let out = '';
  try {
    out = cli(cfg, data, ['revert', '--apply']);
  } catch (e) {
    out = e.stdout ?? '';
  }
  assert.ok(!out.includes('Applied.'), 'must not print Applied on failure');
  assert.match(out, /Nothing reverted/);
});

step('--json surfaces the failure reason', () => {
  const { cfg, data } = fixture({ env: { K: 'v' } });
  writeRecord(data, { settingsLocal: { env: { K: { action: 'added', wroteValue: 'v' } } } });
  writeFileSync(join(cfg, 'settings.local.json'), '{ bad json');

  let out = '';
  try { out = cli(cfg, data, ['revert', '--apply', '--json']); } catch (e) { out = e.stdout ?? ''; }
  const j = JSON.parse(out);
  assert.equal(j.applied, false);
  assert.ok(j.failureReason, 'expected a failureReason');
});

for (const d of temps) rmSync(d, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
