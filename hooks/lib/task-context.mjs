// Resolves "what task is this session on" from the repo, for the statusline,
// the terminal tab title, and the Claude session name.
//
// Everything here is derived from git plus the personal-projects registry —
// nothing depends on the model having told us anything, so it stays correct
// even when task-start was skipped (which is exactly when the statusline needs
// to say so).
//
// The work original read a repo-root service.json for project metadata. Personal
// repos have no such file; the equivalent registry is `projects.<key>` in
// <config-dir>/settings.local.json, which the personal-projects skill writes and
// github-context / gcloud-auth / deploy-status read. Resolution mirrors
// bin/project-key (exact key, then `match` globs against the main checkout's basename) but
// is done natively rather than by shelling out to it, because this runs on every
// prompt and project-key spawns bash + python3.

import { readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { env } from 'node:process';
import { issueRefFromBranch, sessionName, branchGoal } from './issue-ref.mjs';

const BASE_BRANCHES = ['dev', 'develop', 'master', 'main'];

export function git(args, cwd, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    return fallback;
  }
}

export function isRepo(cwd) {
  return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

// Each helper takes an optional memo context so one taskContext() call does not
// re-spawn git for a question already answered — current branch, toplevel and
// upstream are each needed by several helpers. Called standalone (no ctx) they
// behave exactly as before.
const memoized = (ctx, key, fn) => (ctx?.once ? ctx.once(key, fn) : fn());

export function currentBranch(cwd, ctx) {
  return memoized(ctx, 'branch', () => {
    const b = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    return b && b !== 'HEAD' ? b : null;
  });
}

export function topLevel(cwd, ctx) {
  return memoized(ctx, 'toplevel', () => git(['rev-parse', '--show-toplevel'], cwd));
}

/** The main checkout behind `cwd`, even from inside a linked worktree. Null for bare repos. */
export function mainCheckout(cwd, ctx) {
  return memoized(ctx, 'mainCheckout', () => {
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
    return common && basename(common) === '.git' ? dirname(common) : null;
  });
}

export function upstreamRef(cwd, ctx) {
  return memoized(ctx, 'upstream',
    () => git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd));
}

export function isBaseBranch(branch) {
  return typeof branch === 'string' && BASE_BRANCHES.includes(branch);
}

/** Base branch this repo uses — first of dev/develop/master/main that exists on origin. */
export function baseBranch(cwd, ctx) {
  return memoized(ctx, 'base', () => baseBranchUncached(cwd));
}

function baseBranchUncached(cwd) {
  const head = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (head) {
    const short = head.replace(/^origin\//, '');
    if (short) return short;
  }
  for (const b of BASE_BRANCHES) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`], cwd)) return b;
  }
  return null;
}

/**
 * Commits on HEAD not yet on the remote.
 *
 * Prefers the configured upstream. Falls back to the same-named remote branch,
 * because a branch can be pushed without tracking config ever being written —
 * `git push` under a restrictive sandbox does exactly that, and counting
 * against the base instead would report every commit as unpushed. Only when
 * neither exists does it compare to the base, so a genuinely never-pushed
 * branch still reports honestly.
 */
export function unpushedCount(cwd, ctx) {
  const n = git(['rev-list', '--count', `${unpushedRef(cwd, ctx) ?? ''}..HEAD`], cwd, '0');
  const parsed = Number.parseInt(n ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function unpushedRef(cwd, ctx) {
  const upstream = upstreamRef(cwd, ctx);
  if (upstream) return upstream;

  const branch = currentBranch(cwd, ctx);
  if (branch && git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], cwd)) {
    return `origin/${branch}`;
  }

  const base = baseBranch(cwd, ctx);
  return base ? `origin/${base}` : null;
}

export function hasUpstream(cwd, ctx) {
  return upstreamRef(cwd, ctx) !== null;
}

/** Claude config dir, honoring the CLAUDE_CONFIG_DIR override. */
export function configDir() {
  return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

/** The whole `projects` registry, or {} when the file is absent or malformed. */
export function projectRegistry() {
  const p = env.PROJECTS_CFG?.trim() || join(configDir(), 'settings.local.json');
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed.projects === 'object' && parsed.projects !== null
      ? parsed.projects
      : {};
  } catch {
    return {};
  }
}

function globToRe(glob) {
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/**
 * Personal-project key for this repo — exact key match on the main checkout's basename
 * (so a worktree under .claude/worktrees resolves to its repo),
 * then any `match` glob. Mirrors bin/project-key. Null when nothing matches.
 */
export function projectKey(cwd, ctx) {
  return memoized(ctx, 'projectKey', () => {
    const root = mainCheckout(cwd, ctx) || topLevel(cwd, ctx) || cwd;
    const name = basename(root);
    if (!name) return null;

    const projects = projectRegistry();
    if (Object.hasOwn(projects, name)) return name;

    for (const [key, body] of Object.entries(projects)) {
      const globs = Array.isArray(body?.match) ? body.match : [];
      if (globs.some((g) => globToRe(g).test(name))) return key;
    }
    return null;
  });
}

/** The resolved `projects.<key>` body for this repo; null when unregistered. */
export function projectConfig(cwd, ctx) {
  const key = projectKey(cwd, ctx);
  return key ? (projectRegistry()[key] ?? null) : null;
}

/** True when cwd is a git worktree rather than the main checkout. */
export function inWorktree(cwd, ctx) {
  const top = topLevel(cwd, ctx);
  const list = git(['worktree', 'list', '--porcelain'], cwd);
  if (!top || !list) return false;
  const first = list.split('\n').find((l) => l.startsWith('worktree '));
  return Boolean(first) && first.slice('worktree '.length).trim() !== top;
}

/**
 * Just the branch, for callers that need nothing else.
 *
 * `guard.mjs` runs on every Edit/Write and reads only `branch`/`onBase`; the
 * full taskContext() spawns a git subprocess for every field it fills.
 */
export function branchContext(cwd = process.cwd()) {
  if (!isRepo(cwd)) return null;
  const branch = currentBranch(cwd);
  const parsed = issueRefFromBranch(branch);
  return {
    branch,
    issueRef: parsed?.ref ?? null,
    onBase: isBaseBranch(branch),
  };
}

/**
 * Everything the presentation layers need about the current task.
 *
 * Prefer branchContext() when the branch is all you need — this still spawns
 * several git processes even with the memo.
 */
export function taskContext(cwd = process.cwd()) {
  if (!isRepo(cwd)) return null;

  const memo = new Map();
  const ctx = {
    cwd,
    once: (key, fn) => {
      if (!memo.has(key)) memo.set(key, fn());
      return memo.get(key);
    },
  };

  const branch = currentBranch(cwd, ctx);
  const parsed = issueRefFromBranch(branch);
  const goal = branchGoal(branch);

  return {
    branch,
    base: baseBranch(cwd, ctx),
    issueRef: parsed?.ref ?? null,
    issueNumber: parsed?.number ?? null,
    projectKey: projectKey(cwd, ctx),
    goal,
    unpushed: unpushedCount(cwd, ctx),
    hasUpstream: hasUpstream(cwd, ctx),
    onBase: isBaseBranch(branch),
    worktree: inWorktree(cwd, ctx),
    expectedSessionName: parsed ? sessionName(parsed, goal) : null,
    project: projectConfig(cwd, ctx),
  };
}

export { branchGoal };
