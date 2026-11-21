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
import { appendFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, env, exit, stdin } from 'node:process';
import {
  composeDownArgs, isInside, keepMarkerPath, parseStacks, parseWorktrees, planCleanup,
  worktreesRoot, worktreesUsed,
} from './cleanup-core.mjs';

const DRY_RUN = argv.includes('--dry-run');
const REGEN_PREFIXES = ['.husky/_', 'node_modules'];
const BUDGET_MS = 55000;
const RECENT_ACTIVITY_MS = 30 * 60 * 1000;
const deadline = Date.now() + BUDGET_MS;
const NON_INTERACTIVE_GIT = {
  ...env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@localhost',
  GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@localhost',
};

const timeLeft = () => deadline - Date.now();

function run(cmd, args, { timeout = 20000, trim = true, ...opts } = {}) {
  const allowed = Math.min(timeout, timeLeft() - 1000);
  if (allowed <= 0) return null;
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: allowed, env: NON_INTERACTIVE_GIT, ...opts });
    return trim ? out.trim() : out;
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
  const status = run('git', ['-C', wt.path, 'status', '--porcelain', '-z'], { trim: false });
  if (status === null) return true;
  return status.split('\0').filter(Boolean).some((entry) => {
    const path = entry.slice(3);
    return !REGEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  });
}

function isRecentlyActive(main, wt) {
  const admin = git(wt.path, 'rev-parse', '--path-format=absolute', '--git-dir');
  if (!admin) return true;
  return ['HEAD', 'index'].some((file) => {
    try { return Date.now() - statSync(join(admin, file)).mtimeMs < RECENT_ACTIVITY_MS; } catch { return false; }
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
  for (const base of bases) run('git', ['-C', main, 'fetch', '--quiet', 'origin', base], { timeout: 10000 });

  const usedBySession = worktreesUsed(readTranscript(payload.transcript_path), worktrees);
  if (projectDir !== main) usedBySession.add(resolve(projectDir));

  const plan = planCleanup({
    main,
    worktrees,
    stacks: stacks ?? [],
    usedBySession,
    isMerged: (wt) => bases.some((base) => mergedInto(main, wt.branch, base)),
    isDirty,
    isKept: (wt) => existsSync(keepMarkerPath(main, wt.path)),
    isRecentlyActive: (wt) => isRecentlyActive(main, wt),
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
  for (const { stack, keepData } of plan.downStacks) {
    const ok = run('docker', composeDownArgs(stack, existsSync, { keepData }), { timeout: 40000 }) !== null;
    log.push(`${ok ? 'down' : 'FAILED down'} ${stack.project}${keepData ? ' (data kept)' : ''} (${stack.workingDir})`);
    if (!ok) failedStackDirs.push(stack.workingDir);
  }

  for (const wt of plan.removeWorktrees) {
    if (timeLeft() < 5000) {
      log.push(`out of time, left ${wt.path} for the next session`);
      continue;
    }
    if (failedStackDirs.some((dir) => isInside(dir, wt.path))) {
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
