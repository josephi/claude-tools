// Where git worktrees live: inside the repo, at <main-checkout>/.claude/worktrees/<name>.
// Claude Code's own worktree feature already uses that location; this keeps a
// hand-run `git worktree add ../x` from scattering checkouts next to the repo.

import { basename, join, resolve, isAbsolute, relative, sep } from 'node:path';
import { mainCheckout } from './task-context.mjs';
import { maskShellSyntax, shellTokens } from './shell-command.mjs';

export const WORKTREES_DIR = join('.claude', 'worktrees');

const ADD_FLAGS_WITH_VALUE = new Set(['-b', '-B', '--reason']);
const GIT_FLAGS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

export function worktreesRoot(main) {
  return join(main, WORKTREES_DIR);
}

export function isInsideWorktreesRoot(path, main) {
  const rel = relative(worktreesRoot(main), path);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel) && !rel.includes(`..${sep}`);
}

function segments(tokens) {
  const out = [[]];
  for (const t of tokens) {
    if (t.type === 'sep') out.push([]);
    else out[out.length - 1].push(t);
  }
  return out.filter((s) => s.length);
}

function parseWorktreeAdd(words) {
  if (basename(words[0]?.value ?? '') !== 'git') return null;

  let gitDir = null;
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i].value;
    if (!w.startsWith('-')) break;
    if (GIT_FLAGS_WITH_VALUE.has(w)) {
      if (w === '-C') gitDir = words[i + 1] ?? null;
      i++;
    }
  }
  if (words[i]?.value !== 'worktree' || words[i + 1]?.value !== 'add') return null;

  for (let j = i + 2; j < words.length; j++) {
    const w = words[j].value;
    if (w === '--') return { path: words[j + 1] ?? null, gitDir };
    if (ADD_FLAGS_WITH_VALUE.has(w)) { j++; continue; }
    if (w.startsWith('-')) continue;
    return { path: words[j], gitDir };
  }
  return { path: null, gitDir };
}

/**
 * Every `git worktree add` in a command line, with its path word and any `-C` dir.
 * Words carry `unresolvable` when they contain an expansion.
 */
export function worktreeAdds(command) {
  if (typeof command !== 'string' || !command.includes('worktree')) return [];
  const tokens = shellTokens(maskShellSyntax(command), command);
  const found = [];
  for (const segment of segments(tokens)) {
    const words = segment.filter((t) => t.type === 'word');
    const add = parseWorktreeAdd(words);
    if (add?.path) found.push(add);
  }
  return found;
}

/**
 * The first `git worktree add` in `command` whose target is outside
 * <main>/.claude/worktrees, as `{ target, expected }`; null when every add is fine
 * or cannot be judged (expansions, a `cd` earlier in the line, no repo).
 *
 * @param {(dir: string) => string|null} resolveMain injected for tests
 */
export function misplacedWorktreeAdd(command, cwd, resolveMain = mainCheckout) {
  if (/(^|[\s;&|(])(cd|pushd)\s/.test(maskShellSyntax(command ?? ''))) return null;

  for (const { path, gitDir } of worktreeAdds(command)) {
    if (path.unresolvable || path.value.startsWith('~')) continue;
    if (gitDir && (gitDir.unresolvable || gitDir.value.startsWith('~'))) continue;

    const base = gitDir ? resolve(cwd, gitDir.value) : cwd;
    const main = resolveMain(base);
    if (!main) continue;

    const target = resolve(base, path.value);
    if (isInsideWorktreesRoot(target, main)) continue;

    return { target, expected: join(worktreesRoot(main), basename(target)) };
  }
  return null;
}
