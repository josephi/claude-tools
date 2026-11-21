#!/usr/bin/env node
// Tests for principles.mjs. The filter is checked against real comment shapes
// from the owner's repos; the CLI runs against a fake `gh`.
//
// Usage: node test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { agentSignals, harvestWindow, isGenerated, parseCursors, parseOwnerLogin, prNumberOf, selectNew } from './principles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'principles.mjs');

let pass = 0;
let fail = 0;

function step(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

const OWNER_COMMENTS = [
  'Use a consts for his and the opthers fixed parametrers',
  'Do we have the sunrise and the sunset on each date?',
  'Can node-version be stored as a const in the yml and reused?',
  'OK, resolve this comment only after you review that all the constantas are applied all over the application',
  'Split this into two functions',
  'Right now this runs twice, why?',
  'Same as above',
  'Done?',
  'Why `foo` and not `bar`?',
  'This broke in 6c672589, revert?',
];

const AGENT_COMMENTS = [
  '**Change requested.** One bad file in `certs/` stops claude-vm from starting.',
  'Nit: the `chromium` symlink is unrelated to #4.',
  'Blocker: created here, never deleted.',
  'should-fix: an int outside the bigint range gets through this check',
  'Merged to main via #545 (squash 6c672589), together with the rest of the stack.',
  'Left as is, per the coordinator.',
];

console.log('\nprinciples — what reaches the skill');

step("every owner comment survives, including ones that look like an agent's", () => {
  for (const body of OWNER_COMMENTS) assert.equal(isGenerated(body), false, body);
});

step('only unmistakable generated output is dropped', () => {
  for (const body of [
    '## Verdict\nMerge after fix',
    '| # | Sev |\n|---|---|',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    '**Should fix:** the loop never ends',
    'Fixed in ef24dd1d: renamed both.',
  ]) assert.equal(isGenerated(body), true, body.slice(0, 30));
});

step('agent-style comments come with signals for the skill to weigh', () => {
  for (const body of AGENT_COMMENTS) assert.notDeepEqual(agentSignals(body), [], body);
  assert.deepEqual(agentSignals('Use a consts for his and the opthers fixed parametrers'), []);
  assert.ok(agentSignals('Renamed `a` to `b` in ef24dd1d').includes('cites a commit'));
});

console.log('\nprinciples — window and selection');

const comment = (over) => ({ user: { login: 'me' }, body: 'Use a const here', created_at: '2026-01-02T00:00:00Z', html_url: 'https://github.com/o/r/pull/7#discussion_r1', ...over });

step('until is the newest comment the server returned, never the local clock', () => {
  const window = harvestWindow([
    comment({ created_at: '2026-01-05T10:00:00Z', user: { login: 'someone' } }),
    comment({ created_at: '2026-01-03T00:00:00Z' }),
  ], '2026-01-01T00:00:00Z');
  assert.equal(window.until, '2026-01-05T10:00:00Z');
});

step('nothing new keeps the window closed at the cursor', () => {
  assert.deepEqual(harvestWindow([], '2026-01-01T00:00:00Z'), { since: '2026-01-01T00:00:00Z', until: '2026-01-01T00:00:00Z' });
});

step('window is (since, until] compared as times, not strings', () => {
  const window = { since: '2026-01-01T00:00:16Z', until: '2026-01-02T00:00:00Z' };
  const picked = selectNew([
    comment({ created_at: '2026-01-01T00:00:16.000Z', body: 'exactly at the cursor' }),
    comment({ created_at: '2026-01-01T00:00:16.123Z', body: 'just after' }),
    comment({ created_at: '2026-01-02T00:00:00Z', body: 'at until' }),
    comment({ created_at: '2026-01-02T00:00:01Z', body: 'after until' }),
  ], 'me', window);
  assert.deepEqual(picked.map((c) => c.body), ['just after', 'at until']);
});

step('only the owner, only PR comments, generated output dropped, sorted', () => {
  const picked = selectNew([
    comment({ created_at: '2026-01-03T00:00:00Z', body: 'Second' }),
    comment({ user: { login: 'someone' }, body: 'Not the owner' }),
    comment({ html_url: 'https://github.com/o/r/issues/3#issuecomment-1', body: 'An issue' }),
    comment({ body: '## Summary\nall good' }),
    comment({ body: 'First' }),
  ], 'me', { since: '2026-01-01T00:00:00Z', until: '2026-01-09T00:00:00Z' });
  assert.deepEqual(picked.map((c) => [c.pr, c.body]), [[7, 'First'], [7, 'Second']]);
});

step('PR number from inline and conversation comment urls', () => {
  assert.equal(prNumberOf({ pull_request_url: 'https://api.github.com/repos/o/r/pulls/12' }), 12);
  assert.equal(prNumberOf({ html_url: 'https://github.com/o/r/pull/34#issuecomment-1' }), 34);
  assert.equal(prNumberOf({ html_url: 'https://github.com/o/r/issues/5#issuecomment-1' }), null);
});

step('cursors and owner login are read from the principles file', () => {
  const md = '# P\nOwner login: josephi\n## Tests\n- x\n## Harvest cursors\nnote\n- o/r: 2026-01-01T00:00:00Z\n- a.b/c-d: 2026-02-01T00:00:00Z\n## Later\n- z/z: nope\n';
  assert.deepEqual(parseCursors(md), { 'o/r': '2026-01-01T00:00:00Z', 'a.b/c-d': '2026-02-01T00:00:00Z' });
  assert.equal(parseOwnerLogin(md), 'josephi');
});

console.log('\nprinciples — CLI against a fake gh');

const root = mkdtempSync(join(tmpdir(), 'bench-principles-'));
const config = join(root, 'config');
mkdirSync(join(config, 'review-principles'), { recursive: true });
writeFileSync(join(config, 'review-principles', 'principles.md'), '# P\nOwner login: me\n## Harvest cursors\n- o/r: 2026-01-01T00:00:00Z\n');

function fakeGh(name, script) {
  const bin = join(root, name);
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node\n${script}\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: config };
}

const pages = {
  pulls: [[comment({ body: 'Make the timeout a const' }), comment({ created_at: '2025-06-01T00:00:00Z', body: 'Old one' })]],
  issues: [[
    comment({ html_url: 'https://github.com/o/r/pull/9#issuecomment-2', body: 'Why is this default 30?', created_at: '2026-01-04T00:00:00Z' }),
    comment({ html_url: 'https://github.com/o/r/issues/3#issuecomment-3', body: 'An issue, not a PR' }),
  ]],
};

step('new returns the owner comments after the cursor from both endpoints, until = newest', () => {
  const okEnv = fakeGh('ok', `const a = process.argv.slice(2).join(' '); const p = ${JSON.stringify(pages)};
if (a.includes('/pulls/comments')) console.log(JSON.stringify(p.pulls)); else if (a.includes('/issues/comments')) console.log(JSON.stringify(p.issues)); else process.exit(9);`);
  const out = JSON.parse(execFileSync('node', [SCRIPT, 'new', '--repo', 'o/r'], { encoding: 'utf8', env: okEnv }));
  assert.equal(out.login, 'me', 'login from the principles file, gh user never asked');
  assert.equal(out.until, '2026-01-04T00:00:00Z');
  assert.deepEqual(out.comments.map((c) => [c.pr, c.body]).sort(), [[7, 'Make the timeout a const'], [9, 'Why is this default 30?']]);
});

step('a gh failure is one line on stderr and exit 1, no stack trace', () => {
  const failEnv = fakeGh('fail', `process.stderr.write('HTTP 403: rate limited\\n'); process.exit(1);`);
  const result = spawnSync('node', [SCRIPT, 'new', '--repo', 'o/r'], { encoding: 'utf8', env: failEnv });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^principles: could not fetch comments for o\/r: HTTP 403: rate limited\n$/);
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
