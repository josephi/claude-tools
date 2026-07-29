#!/usr/bin/env node
// Tests for nudge.mjs (the PostToolUse convention-reminder hook).
//
// Usage: node hooks/nudge.test.mjs

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { matchNudges, filterAlreadySeen, addedText, render, loadTable } from './nudge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'nudge.mjs');
const TABLE = loadTable();

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

const ids = (payload) => matchNudges(payload, TABLE).map((h) => h.id);
const edit = (file_path, new_string = '') => ({ tool_name: 'Edit', tool_input: { file_path, new_string } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

console.log('\nnudge — addedText extraction');

step('Edit uses new_string', () => {
  assert.equal(addedText('Edit', { new_string: 'abc' }), 'abc');
});

step('Write uses content', () => {
  assert.equal(addedText('Write', { content: 'xyz' }), 'xyz');
});

step('MultiEdit concatenates edits', () => {
  const t = addedText('MultiEdit', { edits: [{ new_string: 'a' }, { new_string: 'b' }] });
  assert.ok(t.includes('a') && t.includes('b'));
});

step('tolerates missing/odd input', () => {
  assert.equal(addedText('Edit', undefined), '');
  assert.equal(addedText('Edit', { edits: 'nope' }), '');
});

console.log('\nnudge — testing-conventions on test files');

for (const f of [
  '/r/src/sync.test.js', '/r/a/b.spec.ts', '/r/tests/thing.mjs',
  '/r/__tests__/x.tsx', '/r/Foo/BarTests.cs', '/r/x_test.py',
]) {
  step(`fires for ${f}`, () => assert.ok(ids(edit(f)).includes('testing-conventions')));
}

for (const f of ['/r/src/sync.js', '/r/src/latest.ts', '/r/protest/app.js']) {
  step(`does not fire for ${f}`, () => assert.ok(!ids(edit(f)).includes('testing-conventions')));
}

console.log('\nnudge — log-standards on added logger calls');

step('fires on logger.info', () => {
  assert.ok(ids(edit('/r/a.js', 'logger.info("sync started")')).includes('log-standards'));
});

step('fires on _logger.error and log.warn', () => {
  assert.ok(ids(edit('/r/a.cs', '_logger.error(e)')).includes('log-standards'));
  assert.ok(ids(edit('/r/a.js', 'log.warn("x")')).includes('log-standards'));
});

step('does not fire without a log call', () => {
  assert.ok(!ids(edit('/r/a.js', 'const logger = makeLogger()')).includes('log-standards'));
});

step('does not fire on console.log', () => {
  assert.ok(!ids(edit('/r/a.js', 'console.log("x")')).includes('log-standards'));
});

console.log('\nnudge — code-comments on added comments');

step('fires on a plain // comment', () => {
  assert.ok(ids(edit('/r/a.js', '  // recompute the offset')).includes('code-comments'));
});

step('does not fire on TODO / directive comments', () => {
  for (const c of ['// TODO(SYNC-1): x', '// eslint-disable-next-line', '// @ts-expect-error', '// prettier-ignore']) {
    assert.ok(!ids(edit('/r/a.js', c)).includes('code-comments'), c);
  }
});

step('does not fire on a shebang or preprocessor line', () => {
  assert.ok(!ids(edit('/r/a.sh', '#!/bin/bash')).includes('code-comments'));
  assert.ok(!ids(edit('/r/a.c', '#include <stdio.h>')).includes('code-comments'));
});

step('does not fire on a URL containing //', () => {
  assert.ok(!ids(edit('/r/a.js', 'const u = "https://example.com"')).includes('code-comments'));
});

// A markdown `# Heading` matches the `#` comment pattern, so without the
// filePathPatterns restriction editing CHANGELOG.md reads as adding a comment.
step('does not fire on markdown headings', () => {
  for (const f of ['/r/CHANGELOG.md', '/r/README.md', '/r/docs/guide.md']) {
    assert.ok(!ids(edit(f, '# Heading')).includes('code-comments'), f);
  }
});

// css/scss have no `#` comment syntax, so a line-initial id selector was being
// read as one.
step('does not fire on a CSS id selector', () => {
  for (const [f, s] of [
    ['/r/a.css', '#main { color: red; }'],
    ['/r/a.scss', '#header { margin: 0; }'],
    ['/r/a.css', '#nav, #footer {'],
  ]) {
    assert.ok(!ids(edit(f, s)).includes('code-comments'), `${f} :: ${s}`);
  }
});

step('does not fire on non-source files at all', () => {
  for (const f of ['/r/data.json', '/r/config.yaml', '/r/notes.txt']) {
    assert.ok(!ids(edit(f, '# something')).includes('code-comments'), f);
  }
});

step('still fires across the source languages we care about', () => {
  for (const [f, s] of [
    ['/r/a.js', '// note'], ['/r/a.ts', '// note'], ['/r/a.cs', '// note'],
    ['/r/a.py', '# note'], ['/r/a.sh', '# note'], ['/r/a.sql', '// note'],
  ]) {
    assert.ok(ids(edit(f, s)).includes('code-comments'), f);
  }
});

console.log('\nnudge — post-commit push reminder');

step('fires on git commit', () => {
  assert.ok(ids(bash('git commit -m "x"')).includes('post-commit-push'));
});

step('fires with a global flag before commit', () => {
  assert.ok(ids(bash('git -c user.name=x commit -m "y"')).includes('post-commit-push'));
});

step('does not fire on --dry-run or --amend', () => {
  assert.ok(!ids(bash('git commit --dry-run')).includes('post-commit-push'));
  assert.ok(!ids(bash('git commit --amend --no-edit')).includes('post-commit-push'));
});

step('does not fire on unrelated git commands', () => {
  for (const c of ['git status', 'git log --oneline', 'git push']) {
    assert.ok(!ids(bash(c)).includes('post-commit-push'), c);
  }
});

// Anchoring the positive pattern was only half the problem: the `unless` flags
// were unanchored, so a flag name inside the commit MESSAGE suppressed the nudge.
// Quoted runs are now blanked before matching, which fixes both directions.
step('a flag name inside the commit message does not suppress the nudge', () => {
  for (const c of [
    'git commit -m "fix --amend handling"',
    'git commit -m "add --dry-run flag"',
    "git commit -m 'document --help output'",
  ]) {
    assert.ok(ids(bash(c)).includes('post-commit-push'), c);
  }
});

step('a real flag still suppresses it', () => {
  for (const c of ['git commit --amend', 'git commit --dry-run', 'git commit --amend --no-edit']) {
    assert.ok(!ids(bash(c)).includes('post-commit-push'), c);
  }
});

step('an indented commit still fires', () => {
  assert.ok(ids(bash('  git commit -m x')).includes('post-commit-push'));
});

step('does not fire when the same command already pushes', () => {
  for (const c of ['git commit -m x && git push', 'git commit -m x; git push origin HEAD:refs/heads/b']) {
    assert.ok(!ids(bash(c)).includes('post-commit-push'), c);
  }
});

step('fires after a shell separator', () => {
  for (const c of ['git add . && git commit -m x', 'cd r; git commit -m x', 'true || git commit -m y']) {
    assert.ok(ids(bash(c)).includes('post-commit-push'), c);
  }
});

// A payload that merely CONTAINS the string "git commit" — piped JSON, an echoed
// example — must not trip the nudge; matching anchors to a command boundary.
step('does not fire when the command only mentions git commit in an argument', () => {
  for (const c of [
    `echo '{"command":"git commit -m x"}' | node hooks/nudge.mjs`,
    'grep -rn "git commit" docs/',
    'echo "run git commit next"',
    "printf 'git commit\\n' > notes.txt",
  ]) {
    assert.ok(!ids(bash(c)).includes('post-commit-push'), c);
  }
});

step('is not once-per-session (every commit needs its own push)', () => {
  const hit = matchNudges(bash('git commit -m x'), TABLE).find((h) => h.id === 'post-commit-push');
  assert.equal(hit.oncePerSession, false);
});

console.log('\nnudge — guards');

step('a tool not listed never matches', () => {
  assert.deepEqual(ids({ tool_name: 'Read', tool_input: { file_path: '/r/a.test.js' } }), []);
});

step('missing tool_name yields nothing', () => {
  assert.deepEqual(ids({ tool_input: {} }), []);
});

step('respects maxNudgesPerCall', () => {
  const noisy = edit('/r/a.test.js', '// note\nlogger.info("x")');
  assert.ok(matchNudges(noisy, TABLE).length <= TABLE.maxNudgesPerCall);
});

console.log('\nnudge — once-per-session filtering');

step('drops a once-per-session nudge the second time', () => {
  const store = new Map();
  const io = {
    read: (s) => store.get(s) ?? new Set(),
    write: (s, list) => store.set(s, new Set([...(store.get(s) ?? []), ...list])),
  };
  const hits = [{ id: 'testing-conventions', message: 'm', oncePerSession: true }];
  assert.equal(filterAlreadySeen(hits, 'sess-1', io).length, 1);
  assert.equal(filterAlreadySeen(hits, 'sess-1', io).length, 0);
});

step('a different session starts fresh', () => {
  const store = new Map();
  const io = {
    read: (s) => store.get(s) ?? new Set(),
    write: (s, list) => store.set(s, new Set([...(store.get(s) ?? []), ...list])),
  };
  const hits = [{ id: 'testing-conventions', message: 'm', oncePerSession: true }];
  filterAlreadySeen(hits, 'sess-1', io);
  assert.equal(filterAlreadySeen(hits, 'sess-2', io).length, 1);
});

step('always-on nudges survive repeats', () => {
  const store = new Map();
  const io = {
    read: (s) => store.get(s) ?? new Set(),
    write: (s, list) => store.set(s, new Set([...(store.get(s) ?? []), ...list])),
  };
  const hits = [{ id: 'post-commit-push', message: 'm', oncePerSession: false }];
  assert.equal(filterAlreadySeen(hits, 's', io).length, 1);
  assert.equal(filterAlreadySeen(hits, 's', io).length, 1);
});

step('render returns null for no hits', () => {
  assert.equal(render([]), null);
});

// ---------------------------------------------------------------- end to end

console.log('\nnudge — end-to-end stdin/stdout contract');

let dataDir;

async function withDataDir(fn) {
  dataDir = await mkdtemp(join(tmpdir(), 'claude-tools-nudge-'));
  try {
    return fn();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function run(payload) {
  const out = execFileSync('node', [SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return out ? JSON.parse(out) : null;
}

await withDataDir(() => {
  step('emits a PostToolUse envelope', () => {
    const res = run({ session_id: 'e2e-1', ...bash('git commit -m x') });
    assert.equal(res.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(res.hookSpecificOutput.additionalContext, /pull --rebase/);
  });

  step('once-per-session persists across processes', () => {
    const first = run({ session_id: 'e2e-2', ...edit('/r/a.test.js') });
    assert.match(first.hookSpecificOutput.additionalContext, /testing-conventions/);
    assert.equal(run({ session_id: 'e2e-2', ...edit('/r/b.test.js') }), null);
  });

  step('silent when nothing applies', () => {
    assert.equal(run({ session_id: 'e2e-3', ...edit('/r/plain.js', 'const a = 1') }), null);
  });

  step('silent on malformed stdin', () => {
    const out = execFileSync('node', [SCRIPT], {
      encoding: 'utf8', input: '{nope', env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    assert.equal(out, '');
  });
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
