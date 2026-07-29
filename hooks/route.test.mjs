#!/usr/bin/env node
// Tests for route.mjs (the UserPromptSubmit router) and lib/issue-ref.mjs.
//
// The task-start / task-completion / pr-review routes are regression-tested
// against scripts/eval-data/triggers.json — the same should-trigger/should-skip
// corpus the Haiku trigger eval uses. Reusing it keeps the deterministic router
// and the model-side skill descriptions honest about the same scenarios.
//
// Usage: node hooks/route.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { matchRoutes, renderContext, loadTable } from './route.mjs';
import { findIssueRef, findIssueRefs, sessionName, issueRefFromBranch } from './lib/issue-ref.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'route.mjs');
const TABLE = loadTable();
const CORPUS = JSON.parse(readFileSync(join(HERE, '..', 'scripts', 'eval-data', 'triggers.json'), 'utf8'));

let pass = 0;
let fail = 0;

// Rejects async callbacks: an un-awaited promise reports `ok` before its
// assertions run, so a broken test looks green. That bug appeared three times in
// this branch, so every step() in hooks/ carries the guard.
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

const idsFor = (prompt) => matchRoutes(prompt, TABLE).map((h) => h.id);

// ---------------------------------------------------------------- issue refs

console.log('\nlib/issue-ref — marker-driven detection');

step('hash form', () => {
  assert.equal(findIssueRef('start #42')?.ref, '#42');
});

step('gh- form, case-insensitive', () => {
  assert.equal(findIssueRef('begin gh-123')?.ref, '#123');
  assert.equal(findIssueRef('begin GH-7')?.ref, '#7');
});

step('prose form, with and without the hash', () => {
  assert.equal(findIssueRef('work on issue 451')?.ref, '#451');
  assert.equal(findIssueRef('work on issue #451')?.ref, '#451');
  assert.equal(findIssueRef('see issues 12')?.ref, '#12');
});

step('leading zeros normalize', () => {
  assert.equal(findIssueRef('#007')?.ref, '#7');
});

step('multiple distinct refs, deduped and in source order', () => {
  const refs = findIssueRefs('fixes #9, refs gh-3, also #9').map((r) => r.ref);
  assert.deepEqual(refs, ['#9', '#3']);
});

console.log('\nlib/issue-ref — bare and lookalike numbers are rejected');

step('a bare number is never an issue', () => {
  for (const t of ['fix the 42 failing tests', 'timeout of 300000', 'port 8080', 'retry 3 times']) {
    assert.equal(findIssueRef(t), null, t);
  }
});

step('rejects hex colours', () => {
  assert.equal(findIssueRef('background is #424242'), null);
  assert.equal(findIssueRef('use #42a for the border'), null);
});

step('rejects a hash inside a larger token', () => {
  assert.equal(findIssueRef('col##42'), null);
});

step('rejects an out-of-range number', () => {
  assert.equal(findIssueRef('#999999'), null);
});

step('the work-era Jira shapes no longer parse', () => {
  for (const t of ['SYNC-27347', 'op-123', 'utf-8', 'CVE-2024-1234']) {
    assert.equal(findIssueRef(t), null, t);
  }
});

console.log('\nlib/issue-ref — session naming');

step('sessionName follows <number>__<kebab>', () => {
  assert.equal(sessionName('#42', 'Extract RabbitMQ producer'), '42__extract-rabbitmq-producer');
});

step('sessionName from a bare number', () => {
  assert.equal(sessionName('42', 'Fix null metadata'), '42__fix-null-metadata');
});

step('sessionName without description', () => {
  assert.equal(sessionName('#7'), '7');
});

step('issueRefFromBranch reads the number positionally', () => {
  assert.equal(issueRefFromBranch('refactor/42_extract-rabbitmq-producer')?.ref, '#42');
  assert.equal(issueRefFromBranch('fix/3_null-metadata')?.ref, '#3');
  assert.equal(issueRefFromBranch('master'), null);
});

step('issueRefFromBranch ignores a non-numeric first segment', () => {
  assert.equal(issueRefFromBranch('spike/try-something'), null);
  assert.equal(issueRefFromBranch('feat/add-thing'), null);
});

// ---------------------------------------------------------------- routing

console.log('\nroute — task-start requires both an issue reference and an intent verb');

step('issue ref + intent verb routes to task-start', () => {
  assert.ok(idsFor("Let's start working on #42").includes('task-start'));
});

step('gh- form + intent verb routes to task-start', () => {
  assert.ok(idsFor('begin work on gh-451').includes('task-start'));
});

step('issue ref alone does not route', () => {
  assert.ok(!idsFor('#42').includes('task-start'));
});

step('intent verb alone does not route', () => {
  assert.ok(!idsFor("let's start working on the retry logic").includes('task-start'));
});

step('a bare number + intent verb does not route', () => {
  assert.ok(!idsFor("let's start working on the 42 failing specs").includes('task-start'));
  assert.ok(!idsFor('begin work on the sha-256 migration').includes('task-start'));
});

step('question about an issue does not route', () => {
  assert.ok(!idsFor('what is #42 about?').includes('task-start'));
  assert.ok(!idsFor('explain why we started #123').includes('task-start'));
});

step('reference with no number still routes (skill resolves it with gh)', () => {
  assert.ok(idsFor('Time to work on the new issue assigned to me').includes('task-start'));
  assert.ok(idsFor("let's start on my next issue").includes('task-start'));
});

step('numberless route tells the model to resolve it with gh', () => {
  const ctx = renderContext(matchRoutes('Time to work on the new issue assigned to me', TABLE));
  assert.match(ctx, /gh issue list/);
});

step('task-list chatter does not route', () => {
  assert.ok(!idsFor('show me the task list').includes('task-start'));
  assert.ok(!idsFor("let's take a look at the backlog").includes('task-start'));
});

console.log('\nroute — regression against scripts/eval-data/triggers.json');

// Corpus keys that map onto a deterministic route. Skills whose triggering is
// inherently semantic (deslop, plan-workflow prose) stay with the Haiku eval.
const CORPUS_ROUTES = {
  'task-start': 'task-start',
  'task-completion': 'task-completion',
};

for (const [corpusKey, routeId] of Object.entries(CORPUS_ROUTES)) {
  const entry = CORPUS[corpusKey];
  if (!entry) {
    step(`corpus has an entry for ${corpusKey}`, () => {
      throw new Error(`missing ${corpusKey} in triggers.json`);
    });
    continue;
  }

  for (const prompt of entry['should-trigger'] ?? []) {
    step(`[${routeId}] triggers: "${prompt}"`, () => {
      assert.ok(idsFor(prompt).includes(routeId), `expected ${routeId} for: ${prompt}`);
    });
  }

  for (const prompt of entry['should-skip'] ?? []) {
    step(`[${routeId}] skips: "${prompt}"`, () => {
      assert.ok(!idsFor(prompt).includes(routeId), `expected no ${routeId} for: ${prompt}`);
    });
  }
}

console.log('\nroute — other routes');

step('PR review routes to the code-reviewer agent', () => {
  assert.ok(idsFor('can you review PR 238985').includes('pr-review'));
});

step('quick glance opts out of the review route', () => {
  assert.ok(!idsFor('just glance at PR 238985 for me').includes('pr-review'));
});

// Found by review: a bare \d{5,7} near "review" matched any largish number, so
// reviewing a timeout value or a log line claimed to be a PR review request.
step('pr-review does not fire on an unrelated number near "review"', () => {
  for (const p of [
    'review the timeout of 300000 in the config',
    'can you review this log line where amount was 145900',
    'review the 4000 character limit',
  ]) {
    assert.ok(!idsFor(p).includes('pr-review'), p);
  }
});

step('pr-review still fires on real PR references', () => {
  for (const p of ['review PR 238985', 'can you review pull request 241080', 'review the PR', 'review this merge request']) {
    assert.ok(idsFor(p).includes('pr-review'), p);
  }
});

// Found by review, and it misfired on the review output itself: a timezone
// offset parsed as a Jira key, so "convert this to UTC-5" routed to task-start.
step('a timezone offset is not a task reference', () => {
  for (const p of ['convert this to UTC-5', 'start work on the GMT-3 conversion', "let's begin the PST-8 fix"]) {
    assert.ok(!idsFor(p).includes('task-start'), p);
  }
});

step('issue creation routes to issue authoring', () => {
  assert.ok(idsFor('create a github issue for the retry bug').includes('issue-authoring'));
});

step('test authoring routes to qa-automation', () => {
  assert.ok(idsFor('write integration tests for the sync route').includes('testing'));
});

step('running tests does not route to qa-automation', () => {
  assert.ok(!idsFor('run the tests please').includes('testing'));
});

step('refactor routes to refactor-flow', () => {
  assert.ok(idsFor('refactor the queue helpers into a shared module').includes('refactor'));
});

step('unrelated prompt routes nowhere', () => {
  assert.deepEqual(idsFor('what time is the standup?'), []);
});

step('respects maxRoutesPerPrompt', () => {
  const cap = TABLE.maxRoutesPerPrompt;
  const noisy = "let's start working on #1, write tests, refactor it, plan this, and post to discord";
  assert.ok(matchRoutes(noisy, TABLE).length <= cap, `expected <= ${cap} routes`);
});

console.log('\nroute — rendering and {{issues}} substitution');

step('renderContext returns null with no hits', () => {
  assert.equal(renderContext([]), null);
});

step('{{issues}} is substituted with the canonical refs', () => {
  const hits = matchRoutes("let's start working on gh-451", TABLE);
  const ctx = renderContext(hits);
  assert.ok(ctx.includes('#451'), 'expected canonical ref in message');
  assert.ok(!ctx.includes('{{issues}}'), 'placeholder should be gone');
});

// ---------------------------------------------------------------- end to end

console.log('\nroute — end-to-end stdin/stdout contract');

function run(stdinText) {
  const out = execFileSync('node', [SCRIPT], {
    encoding: 'utf8',
    input: stdinText,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return out ? JSON.parse(out) : null;
}

step('emits a UserPromptSubmit envelope on a match', () => {
  const res = run(JSON.stringify({ prompt: "let's start working on #42" }));
  assert.equal(res.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(res.hookSpecificOutput.additionalContext, /task-start/);
});

step('accepts the user_input field name too', () => {
  const res = run(JSON.stringify({ user_input: 'begin work on gh-451' }));
  assert.match(res.hookSpecificOutput.additionalContext, /task-start/);
});

step('silent on no match', () => {
  assert.equal(run(JSON.stringify({ prompt: 'what time is standup?' })), null);
});

step('silent on empty stdin', () => {
  assert.equal(run(''), null);
});

step('silent on malformed stdin (never costs the user their prompt)', () => {
  assert.equal(run('{not json'), null);
});

step('exits 0 even on garbage input', () => {
  const r = execFileSync('node', [SCRIPT], {
    encoding: 'utf8', input: String.fromCharCode(0, 1), stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(typeof r, 'string');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
