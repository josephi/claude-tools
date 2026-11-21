// Decides what a finished or stopped session leaves behind: which worktrees to
// remove and which Docker Compose stacks to take down. Pure functions over git
// and docker output, so the policy is testable without either.

import { basename, join, relative, isAbsolute, sep } from 'node:path';

export const KEEP_SUFFIX = '.keep-docker';

export function worktreesRoot(main) {
  return join(main, '.claude', 'worktrees');
}

export function keepMarkerPath(main, worktreePath) {
  return join(worktreesRoot(main), `${basename(worktreePath)}${KEEP_SUFFIX}`);
}

export function isInside(path, dir) {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function parseWorktrees(porcelain) {
  const worktrees = [];
  let current = null;
  for (const line of (porcelain ?? '').split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, locked: false, prunable: false };
      worktrees.push(current);
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (current && line.startsWith('locked')) {
      current.locked = true;
    } else if (current && line.startsWith('prunable')) {
      current.prunable = true;
    }
  }
  return worktrees;
}

// Input: `docker ps -a` lines of "<project>\t<working_dir>\t<config_files>".
export function parseStacks(psOutput) {
  const byProject = new Map();
  for (const line of (psOutput ?? '').split('\n')) {
    const [project, workingDir, configFiles = ''] = line.split('\t');
    if (!project || !workingDir || byProject.has(project)) continue;
    byProject.set(project, {
      project,
      workingDir,
      configFiles: configFiles.split(',').map((f) => f.trim()).filter(Boolean),
    });
  }
  return [...byProject.values()];
}

export function worktreesMentioned(transcript, worktrees) {
  if (!transcript) return new Set();
  return new Set(worktrees.filter((wt) => transcript.includes(wt.path)).map((wt) => wt.path));
}

/**
 * @param {object} input
 * @param {string} input.main             main checkout
 * @param {Array}  input.worktrees        parseWorktrees() output, main included
 * @param {Array}  input.stacks           parseStacks() output
 * @param {Set}    input.usedBySession    worktree paths this session worked in
 * @param {(wt) => boolean} input.isMerged
 * @param {(wt) => boolean} input.isDirty
 * @param {(wt) => boolean} input.isKept
 * @param {(path) => boolean} input.exists
 */
export function planCleanup({ main, worktrees, stacks, usedBySession, isMerged, isDirty, isKept, exists }) {
  const plan = { removeWorktrees: [], downStacks: [], kept: [], skipped: [] };
  const root = worktreesRoot(main);
  const linked = worktrees.filter((wt) => wt.path !== main && isInside(wt.path, root));
  const stacksIn = (wt) => stacks.filter((s) => isInside(s.workingDir, wt.path));

  for (const wt of linked) {
    const own = stacksIn(wt);
    const usedHere = usedBySession.has(wt.path);

    if (isKept(wt)) { plan.kept.push({ path: wt.path, reason: 'keep marker' }); continue; }
    if (wt.locked) { plan.skipped.push({ path: wt.path, reason: 'locked' }); continue; }

    const finished = wt.branch && isMerged(wt) && !isDirty(wt);
    if (finished && (own.length === 0 || usedHere)) {
      plan.removeWorktrees.push(wt);
      plan.downStacks.push(...own);
    } else if (finished) {
      plan.skipped.push({ path: wt.path, reason: 'merged, but its stack runs and another session may use it' });
    } else if (usedHere && own.length) {
      plan.downStacks.push(...own);
    }
  }

  const known = new Set(linked.map((wt) => wt.path));
  for (const stack of stacks) {
    const orphan = isInside(stack.workingDir, root)
      && ![...known].some((p) => isInside(stack.workingDir, p))
      && !exists(stack.workingDir);
    if (orphan) plan.downStacks.push(stack);
  }

  return plan;
}

export function composeDownArgs(stack, exists) {
  const base = ['compose', '-p', stack.project];
  const filesPresent = stack.configFiles.length > 0 && stack.configFiles.every(exists);
  const files = filesPresent
    ? ['--project-directory', stack.workingDir, ...stack.configFiles.flatMap((f) => ['-f', f])]
    : [];
  return [...base, ...files, 'down', '--volumes', '--rmi', 'local', '--remove-orphans'];
}
