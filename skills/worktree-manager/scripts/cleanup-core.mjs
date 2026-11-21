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
// A project name started from two different folders is ambiguous: `-p name down`
// would reach both, so it is never taken down.
export function parseStacks(psOutput) {
  const byProject = new Map();
  for (const line of (psOutput ?? '').split('\n')) {
    const [project, workingDir, configFiles = ''] = line.split('\t');
    if (!project || !workingDir) continue;
    const known = byProject.get(project);
    if (known) {
      if (known.workingDir !== workingDir) known.ambiguous = true;
      continue;
    }
    byProject.set(project, {
      project,
      workingDir,
      configFiles: configFiles.split(',').map((f) => f.trim()).filter(Boolean),
      ambiguous: false,
    });
  }
  return [...byProject.values()];
}

const PATH_END = /^($|[\s/'"`;&|)])/;

function namesPath(text, path) {
  for (let at = text.indexOf(path); at !== -1; at = text.indexOf(path, at + 1)) {
    if (PATH_END.test(text.slice(at + path.length, at + path.length + 1))) return true;
  }
  return false;
}

function transcriptEntries(transcript) {
  return (transcript ?? '').split('\n').flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function dockerCommands(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === 'tool_use' && typeof part.input?.command === 'string')
    .map((part) => part.input.command)
    .filter((command) => /\bdocker\b/.test(command));
}

// A worktree counts as used by the session when the session ran in it, or ran a
// docker command naming it. Mentions in tool output (a `git worktree list`, say)
// do not count: those name every worktree.
export function worktreesUsed(transcript, worktrees) {
  const entries = transcriptEntries(transcript);
  const cwds = entries.map((e) => e?.cwd).filter((c) => typeof c === 'string');
  const commands = entries.flatMap(dockerCommands);
  return new Set(worktrees
    .filter((wt) => cwds.some((c) => isInside(c, wt.path)) || commands.some((c) => namesPath(c, wt.path)))
    .map((wt) => wt.path));
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
 * @param {(wt) => boolean} input.isRecentlyActive  git activity a live session would cause
 * @param {(path) => boolean} input.exists
 *
 * downStacks entries are { stack, keepData }: a removed worktree's stack loses its
 * volumes; an open task's stack keeps them, so its database survives the stop.
 */
export function planCleanup({ main, worktrees, stacks, usedBySession, isMerged, isDirty, isKept, isRecentlyActive = () => false, exists }) {
  const plan = { removeWorktrees: [], downStacks: [], kept: [], skipped: [] };
  const root = worktreesRoot(main);
  const linked = worktrees.filter((wt) => wt.path !== main && isInside(wt.path, root));
  const ownable = stacks.filter((s) => !s.ambiguous);
  const stacksIn = (wt) => ownable.filter((s) => isInside(s.workingDir, wt.path));
  const down = (list, keepData) => plan.downStacks.push(...list.map((stack) => ({ stack, keepData })));

  for (const wt of linked) {
    const own = stacksIn(wt);
    const usedHere = usedBySession.has(wt.path);

    if (isKept(wt)) { plan.kept.push({ path: wt.path, reason: 'keep marker' }); continue; }
    if (wt.locked) { plan.skipped.push({ path: wt.path, reason: 'locked' }); continue; }

    const finished = Boolean(wt.branch) && isMerged(wt) && !isDirty(wt);
    const maybeInUseElsewhere = !usedHere && (own.length > 0 || isRecentlyActive(wt));
    if (finished && !maybeInUseElsewhere) {
      plan.removeWorktrees.push(wt);
      down(own, false);
    } else if (finished) {
      plan.skipped.push({ path: wt.path, reason: 'merged, but another session may still be using it' });
    } else if (usedHere && own.length) {
      down(own, true);
    }
  }

  const known = linked.map((wt) => wt.path);
  const orphans = ownable.filter((stack) => isInside(stack.workingDir, root)
    && !known.some((p) => isInside(stack.workingDir, p))
    && !exists(stack.workingDir));
  down(orphans, false);

  return plan;
}

export function composeDownArgs(stack, exists, { keepData = false } = {}) {
  const base = ['compose', '-p', stack.project];
  const filesPresent = stack.configFiles.length > 0 && stack.configFiles.every(exists);
  const files = filesPresent
    ? ['--project-directory', stack.workingDir, ...stack.configFiles.flatMap((f) => ['-f', f])]
    : [];
  const volumes = keepData ? [] : ['--volumes'];
  return [...base, ...files, 'down', ...volumes, '--rmi', 'local', '--remove-orphans'];
}
