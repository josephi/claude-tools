#!/usr/bin/env node
// SessionEnd hook: clean up after the session.
//
// - A worktree whose branch is merged and clean is removed with its branch, and
//   its Compose stacks are taken down (containers, volumes, images they built).
// - A worktree this session worked in whose task is still open keeps its files,
//   but its stacks are taken down.
// - `<main>/.claude/worktrees/<name>.keep-docker` keeps a worktree and its stacks.
// - Stacks are matched by their compose working-dir label, so another session's
//   stack is never touched.
//
// Silent and fail-open: every error leaves things as they were. Writes what it
// did to <main>/.claude/worktrees/.bench-cleanup.log.
//
// Flags: --dry-run prints the plan as JSON and changes nothing.
// Env:   CLAUDE_PRUNE_BASE base branch(es), comma-separated; default origin/HEAD.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, env, exit, stdin } from 'node:process';
import {
  composeDownArgs, keepMarkerPath, parseStacks, parseWorktrees, planCleanup,
  worktreesMentioned, worktreesRoot,
} from './cleanup-core.mjs';

const DRY_RUN = argv.includes('--dry-run');
const REGEN_PREFIXES = ['.husky/_', 'node_modules'];

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000, ...opts }).trim();
  } catch {
    return null;
  }
}

const git = (dir, ...args) => run('git', ['-C', dir, ...args]);

async function readPayload() {
  if (stdin.isTTY) return {};
  let raw = '';
  for await (const chunk of stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return {}; }
}

function baseBranches(main) {
  const configured = (env.CLAUDE_PRUNE_BASE ?? '').split(',').map((b) => b.trim()).filter(Boolean);
  if (configured.length) return configured;
  const head = git(main, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  return head ? [head.replace(/^origin\//, '')] : ['main'];
}

// Merged by a merge commit, or squash-merged: a single commit with the branch's
// tree on top of the merge base has an equivalent patch already in the base.
function mergedInto(main, branch, base) {
  const target = `origin/${base}`;
  const mergeBase = git(main, 'merge-base', target, branch);
  if (!mergeBase) return false;
  const ahead = git(main, 'rev-list', '--count', `${mergeBase}..${branch}`);
  if (!ahead || ahead === '0') return false;
  if (run('git', ['-C', main, 'merge-base', '--is-ancestor', branch, target]) !== null) return true;
  const squash = git(main, 'commit-tree', `${branch}^{tree}`, '-p', mergeBase, '-m', 'bench squash probe');
  if (!squash) return false;
  return git(main, 'cherry', target, squash)?.startsWith('-') ?? false;
}

function isDirty(wt) {
  const status = git(wt.path, 'status', '--porcelain');
  if (status === null) return true;
  return status.split('\n').filter(Boolean).some((line) => {
    const path = line.slice(3);
    return !REGEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  });
}

function listStacks() {
  const out = run('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format',
    '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "com.docker.compose.project.config_files"}}']);
  return out === null ? null : parseStacks(out);
}

function readTranscript(path) {
  try { return path ? readFileSync(path, 'utf8') : ''; } catch { return ''; }
}

async function main() {
  const payload = await readPayload();
  const projectDir = env.CLAUDE_PROJECT_DIR || payload.cwd;
  if (!projectDir || !existsSync(projectDir)) return;

  const commonDir = git(projectDir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  if (!commonDir) return;
  const main = resolve(commonDir, '..');
  if (!existsSync(worktreesRoot(main))) return;

  const worktrees = parseWorktrees(git(main, 'worktree', 'list', '--porcelain'));
  const stacks = listStacks();
  const bases = baseBranches(main);
  for (const base of bases) git(main, 'fetch', '--quiet', 'origin', base);

  const usedBySession = worktreesMentioned(readTranscript(payload.transcript_path), worktrees);
  if (projectDir !== main) usedBySession.add(resolve(projectDir));

  const plan = planCleanup({
    main,
    worktrees,
    stacks: stacks ?? [],
    usedBySession,
    isMerged: (wt) => bases.some((base) => mergedInto(main, wt.branch, base)),
    isDirty,
    isKept: (wt) => existsSync(keepMarkerPath(main, wt.path)),
    exists: existsSync,
  });

  if (stacks === null) {
    plan.skipped.push(...plan.removeWorktrees.map((wt) => ({ path: wt.path, reason: 'docker unavailable' })));
    plan.removeWorktrees = [];
    plan.downStacks = [];
  }

  if (DRY_RUN) {
    console.log(JSON.stringify({ main, bases, ...plan, usedBySession: [...usedBySession] }, null, 2));
    return;
  }

  const log = [];
  const failedStackDirs = [];
  for (const stack of plan.downStacks) {
    const ok = run('docker', composeDownArgs(stack, existsSync), { timeout: 40000 }) !== null;
    log.push(`${ok ? 'down' : 'FAILED down'} ${stack.project} (${stack.workingDir})`);
    if (!ok) failedStackDirs.push(stack.workingDir);
  }

  for (const wt of plan.removeWorktrees) {
    if (failedStackDirs.some((dir) => dir.startsWith(wt.path))) {
      log.push(`kept ${wt.path}: its stack did not come down`);
      continue;
    }
    const removed = git(main, 'worktree', 'remove', '--force', wt.path) !== null;
    if (removed) git(main, 'branch', '-D', wt.branch);
    if (removed && existsSync(wt.path)) rmSync(wt.path, { recursive: true, force: true });
    log.push(`${removed ? 'removed' : 'FAILED remove'} worktree ${wt.path} (${wt.branch})`);
  }

  for (const k of plan.kept) log.push(`kept ${k.path}: ${k.reason}`);
  if (!log.length) return;

  const stamp = new Date().toISOString();
  try {
    appendFileSync(resolve(worktreesRoot(main), '.bench-cleanup.log'), log.map((l) => `${stamp} ${l}\n`).join(''));
  } catch { /* logging is best effort */ }
  console.error(`[bench cleanup] ${log.join('; ')}`);
}

main().catch(() => exit(0));
