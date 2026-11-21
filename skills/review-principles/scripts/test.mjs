#!/usr/bin/env node
// Tests for principles.mjs. The owner-voice filter is checked against real
// comment shapes from the owner's repos; the CLI runs against a fake `gh`.
//
// Usage: node principles.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { isOwnerVoice, parseCursors, prNumberOf, selectNew } from './principles.mjs';

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

console.log('\nprinciples — owner voice');

step("keeps the owner's short questions and instructions", () => {
  for (const body of [
    'Use a consts for his and the opthers fixed parametrers',
    'Do we have the sunrise and the sunset on each date?',
    'Can node-version be stored as a const in the yml and reused?',
    'OK, resolve this comment only after you review that all the constantas are applied all over the application',
  ]) assert.equal(isOwnerVoice(body), true, body);
});

step('drops agent findings, replies and summaries posted under the same login', () => {
  for (const body of [
    '**Change requested.** One bad file in `certs/` stops claude-vm from starting.',
    'Nit: the `chromium` symlink is unrelated to #4.',
    'Blocker: created here, never deleted.',
    'should-fix: an int outside the bigint range gets through this check',
    'Done. Two blank lines before the metadata route.',
    'Renamed both in ef24dd1d to say GROUND_REACH_MAX_M.',
    'Merged to main via #545 (squash 6c672589), together with the rest of the stack.',
    'Left as is, per the coordinator.',
    'The `catch (err: any)` turns off checks; use `unknown` and narrow in `setError`.',
    '## Verdict\nMerge after fix',
    'x'.repeat(700),
  ]) assert.equal(isOwnerVoice(body), false, body.slice(0, 40));
});

step('a word that only starts like an opener is not one', () => {
  assert.equal(isOwnerVoice('Donestic test: make the fixtures smaller'), true);
});

console.log('\nprinciples — selection');

const owner = (over) => ({ user: { login: 'me' }, body: 'Use a const here', created_at: '2026-01-02T00:00:00Z', html_url: 'https://github.com/o/r/pull/7#discussion_r1', ...over });

step('only the owner, only after the cursor, sorted, with the PR number', () => {
  const picked = selectNew([
    owner({ created_at: '2026-01-03T00:00:00Z', body: 'Second' }),
    owner({ created_at: '2025-12-31T00:00:00Z', body: 'Before the cursor' }),
    owner({ user: { login: 'someone' }, body: 'Not the owner' }),
    owner({ body: 'First' }),
  ], 'me', '2026-01-01T00:00:00Z');
  assert.deepEqual(picked.map((c) => [c.pr, c.body]), [[7, 'First'], [7, 'Second']]);
});

step('PR number from inline and conversation comment urls', () => {
  assert.equal(prNumberOf({ pull_request_url: 'https://api.github.com/repos/o/r/pulls/12' }), 12);
  assert.equal(prNumberOf({ html_url: 'https://github.com/o/r/pull/34#issuecomment-1' }), 34);
  assert.equal(prNumberOf({ html_url: 'https://github.com/o/r/issues/5#issuecomment-1' }), null);
});

step('cursors are read from the principles file, other sections ignored', () => {
  const md = '# P\n## Tests\n- x\n## Harvest cursors\nnote\n- o/r: 2026-01-01T00:00:00Z\n- a.b/c-d: 2026-02-01T00:00:00Z\n## Later\n- z/z: nope\n';
  assert.deepEqual(parseCursors(md), { 'o/r': '2026-01-01T00:00:00Z', 'a.b/c-d': '2026-02-01T00:00:00Z' });
});

console.log('\nprinciples — CLI against a fake gh');

const root = mkdtempSync(join(tmpdir(), 'bench-principles-'));
const config = join(root, 'config');
mkdirSync(join(config, 'review-principles'), { recursive: true });
writeFileSync(join(config, 'review-principles', 'principles.md'), '# P\n## Harvest cursors\n- o/r: 2026-01-01T00:00:00Z\n');

const bin = join(root, 'bin');
mkdirSync(bin);
const pages = {
  pulls: [[owner({ body: 'Make the timeout a const' }), owner({ created_at: '2025-06-01T00:00:00Z', body: 'Old one' })]],
  issues: [[
    owner({ html_url: 'https://github.com/o/r/pull/9#issuecomment-2', body: 'Why is this default 30?' }),
    owner({ html_url: 'https://github.com/o/r/issues/3#issuecomment-3', body: 'An issue, not a PR' }),
  ]],
};
writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
const pages = ${JSON.stringify(pages)};
if (args.includes('/pulls/comments')) console.log(JSON.stringify(pages.pulls));
else if (args.includes('/issues/comments')) console.log(JSON.stringify(pages.issues));
else console.log('me');
`);
chmodSync(join(bin, 'gh'), 0o755);

step('new returns the owner comments after the cursor from both endpoints', () => {
  const out = JSON.parse(execFileSync('node', [SCRIPT, 'new', '--repo', 'o/r'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: config },
  }));
  assert.equal(out.since, '2026-01-01T00:00:00Z');
  assert.ok(out.until > out.since);
  assert.deepEqual(out.comments.map((c) => [c.pr, c.body]).sort(), [[7, 'Make the timeout a const'], [9, 'Why is this default 30?']]);
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
