#!/usr/bin/env node
// Tests for lib/base-branch-precommit.sh.
//
// This is the backstop the PreToolUse guard cannot be: the guard has to understand
// what a shell command is about to do, and repeated review has shown that
// understanding is never complete. This hook needs no understanding — git already
// knows the branch by the time it runs — so it holds regardless of how the file was
// written.
//
// Run against real repositories, since the whole point is git's own behaviour.
//
// Usage: node hooks/base-branch-precommit.test.mjs

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'lib', 'base-branch-precommit.sh');

let pass = 0;
let fail = 0;
const temps = [];

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

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A repo with the hook installed. `seed: false` leaves the branch unborn. */
function repo({ branch = 'master', seed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-tools-precommit-'));
  temps.push(dir);
  git(dir, ['init', '-q', '-b', branch, '.']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 'T']);
  if (seed) {
    writeFileSync(join(dir, 'seed.txt'), 'seed\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'init']);
  }
  const installed = join(dir, '.git', 'hooks', 'pre-commit');
  copyFileSync(HOOK, installed);
  chmodSync(installed, 0o755);
  return dir;
}

function commit(dir, file, { env = {} } = {}) {
  writeFileSync(join(dir, file), 'x\n');
  git(dir, ['add', '.']);
  const r = spawnSync('git', ['commit', '-m', 'attempt'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { code: r.status, stderr: r.stderr ?? '' };
}

try {
  console.log('\nbase-branch-precommit — refuses on a base branch');

  for (const branch of ['master', 'main', 'dev', 'develop']) {
    step(`refuses a commit on ${branch}`, () => {
      const dir = repo({ branch });
      const r = commit(dir, 'a.txt');
      assert.equal(r.code, 1, `expected refusal on ${branch}`);
      assert.match(r.stderr, /refusing to commit/);
      assert.match(r.stderr, new RegExp(branch));
    });
  }

  step('the staged changes survive the refusal', () => {
    const dir = repo();
    commit(dir, 'a.txt');
    assert.match(git(dir, ['diff', '--cached', '--name-only']), /a\.txt/,
      'a refused commit must not discard the work');
  });

  step('the message says how to recover', () => {
    const { stderr } = commit(repo(), 'a.txt');
    assert.match(stderr, /git checkout -b/, 'it must name the way out');
    assert.match(stderr, /git-per-task/, 'and the rule it is enforcing');
  });

  console.log('\nbase-branch-precommit — allows everything else');

  step('allows a commit on a task branch', () => {
    const dir = repo();
    git(dir, ['checkout', '-q', '-b', 'feat/sync-1_x']);
    assert.equal(commit(dir, 'a.txt').code, 0);
  });

  step('CLAUDE_TOOLS_ALLOW_BASE_EDITS=1 allows it, matching the write guard', () => {
    const dir = repo();
    assert.equal(commit(dir, 'a.txt', { env: { CLAUDE_TOOLS_ALLOW_BASE_EDITS: '1' } }).code, 0);
  });

  step('--no-verify still works, as an explicit act', () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '--no-verify', '-qm', 'deliberate']);
    assert.match(git(dir, ['log', '--oneline', '-1']), /deliberate/);
  });

  // The initial commit of a repository has to land somewhere, and `rev-parse
  // --abbrev-ref HEAD` fails on an unborn branch — which made an earlier version of
  // this hook exit 0 and protect nothing at all.
  step('an unborn branch is not blocked', () => {
    const dir = repo({ seed: false });
    assert.equal(commit(dir, 'first.txt').code, 0, 'the first commit must be possible');
  });

  step('a detached HEAD is not blocked', () => {
    const dir = repo();
    const head = git(dir, ['rev-parse', 'HEAD']).trim();
    git(dir, ['checkout', '-q', head]);
    assert.equal(commit(dir, 'a.txt').code, 0);
  });

  step('a branch merely containing a base name is not blocked', () => {
    const dir = repo();
    git(dir, ['checkout', '-q', '-b', 'feat/sync-2_master-cleanup']);
    assert.equal(commit(dir, 'a.txt').code, 0, 'substring matches must not trip it');
  });
} finally {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
