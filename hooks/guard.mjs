#!/usr/bin/env node
// Three jobs:
//
//   PreToolUse on a write tool or Bash — deny edits on a base branch (master/
//     main/dev/develop) and point at task-start. This is the one place
//     git-per-task can actually be enforced rather than asserted: prose in
//     CLAUDE.md cannot stop an edit, permissionDecision "deny" can, and the model
//     is shown the reason so it self-corrects instead of retrying. Bash is
//     included because `cat > file` reaches the filesystem without any write
//     tool, which left the rule resting on the deny message asking for
//     compliance — the thing this hook exists to replace.
//
//   PreToolUse on Bash — deny a `git worktree add` outside
//     <main-checkout>/.claude/worktrees, so every project keeps its worktrees
//     inside the repo whatever its own docs say. BENCH_ALLOW_ANY_WORKTREE_PATH=1
//     lifts it.
//
//   SessionStart (matcher "compact") — re-assert the non-negotiable rules plus
//     the current task state. Compaction is where rule adherence decays;
//     CLAUDE.md text survives it but session-injected context does not, and
//     after a compact the model has often lost which branch and ticket it is on.
//     SessionStart rather than PostCompact because additionalContext is
//     documented for SessionStart and not for PostCompact — an event that fires
//     but whose context is ignored would make this whole path silently inert.
//
// Escape hatch: BENCH_ALLOW_BASE_EDITS=1 disables the guard. A gate with no
// escape hatch is a gate people turn off wholesale via disableAllHooks, which
// would take the router and nudges down with it.
//
// Contract: exit 0 always. On any internal error the guard fails OPEN — a broken
// guard must not make the repo unwritable.

import { pathToFileURL } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { argv, env, stdin, stdout, exit, cwd as processCwd } from 'node:process';
import { taskContext, branchContext, isBaseBranch, mainCheckout } from './lib/task-context.mjs';
import { bashWriteTargets } from './lib/bash-writes.mjs';
import { misplacedWorktreeAdd } from './lib/worktree-path.mjs';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Paths it is legitimate to touch while on a base branch: the guard is about
// protecting product code from un-branched edits, not about blocking a user who
// is deliberately editing their own machine config.
// Accept either separator: Claude Code passes native paths, so on Windows a
// forward-slash-only pattern would fail to match and the guard would block the
// very files git-per-task documents as always writable.
const ALWAYS_ALLOWED = [
  /(^|[\\/])\.claude[\\/]settings\.local\.json$/,
  /(^|[\\/])\.git[\\/]/,
];

// .git/info/exclude decides what counts as ignored, so writing it would let any
// tracked-looking path through the ignored-file carve-out.
const NEVER_ALLOWED = [/(^|[\\/])\.git[\\/]info[\\/]exclude$/];

export function isWriteTool(toolName) {
  return WRITE_TOOLS.has(toolName);
}

export function targetPath(input = {}) {
  for (const k of ['file_path', 'notebook_path', 'path']) {
    if (typeof input?.[k] === 'string' && input[k]) return input[k];
  }
  return '';
}

export function isAlwaysAllowed(path) {
  if (NEVER_ALLOWED.some((re) => re.test(path))) return false;
  return ALWAYS_ALLOWED.some((re) => re.test(path));
}

// A git-ignored file (.env.local, backups/, scratch) never reaches the base
// branch's history, so editing it is machine config, not an un-branched change.
function checkIgnored(path) {
  const dir = judgeDirFor(path);
  if (!dir) return false;
  try {
    execFileSync('git', ['-C', dir, 'check-ignore', '-q', '--', path], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function realTarget(path) {
  try { return realpathSync(path); } catch { return path; }
}

// Both the path and what it points to must be ignored: a symlink in an ignored
// folder can lead to a tracked file.
export function isGitIgnored(path) {
  const real = realTarget(path);
  return checkIgnored(path) && (real === path || checkIgnored(real));
}

/**
 * @returns {{permissionDecision: 'deny', permissionDecisionReason: string}|null}
 *   null means "no opinion" — the guard defers to normal permission handling.
 */
export function evaluateWrite(payload, ctx, { allowBaseEdits = false, isIgnored = () => false } = {}) {
  if (allowBaseEdits) return null;

  const toolName = payload.tool_name ?? payload.toolName ?? '';
  if (!isWriteTool(toolName)) return null;
  if (!ctx?.branch || !isBaseBranch(ctx.branch)) return null;

  const path = targetPath(payload.tool_input ?? payload.toolInput);
  if (path && (isAlwaysAllowed(path) || isIgnored(path))) return null;

  return {
    permissionDecision: 'deny',
    permissionDecisionReason:
      `git-per-task: you are on "${ctx.branch}", a base branch — direct edits there are not allowed. `
      + 'Invoke the bench:task-start skill to create or switch to a task branch, then repeat this edit. '
      + `If this edit is genuinely meant for ${ctx.branch}, the user can set BENCH_ALLOW_BASE_EDITS=1. `
      + 'Shelling out to a write command is denied too, so that is not a route around this.',
  };
}

/**
 * The directory whose repo should judge a write to `path`.
 *
 * When the target is itself an existing directory (`cp x src/`, `mv a.txt repo/`)
 * that directory is the answer — taking its parent would step outside the repo at
 * the root and allow the write. Otherwise it is the nearest existing ancestor of
 * the parent, so a write into a not-yet-created directory is still judged.
 */
export function judgeDirFor(path) {
  const insideGitDir = path.match(/^(.*?)[\\/]\.git([\\/]|$)/);
  if (insideGitDir) return insideGitDir[1] || '';
  try {
    if (existsSync(path) && statSync(path).isDirectory()) return path;
  } catch { /* unreadable — fall through to the ancestor walk */ }

  let dir = dirname(path);
  for (;;) {
    if (existsSync(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return '';
    dir = parent;
  }
}

/**
 * The Bash counterpart of evaluateWrite: deny a shell command whose write target
 * lands in a repo sitting on a base branch.
 *
 * Each target is judged against ITS OWN repo, so `sed -i` on a scratch file in
 * /tmp stays allowed while the same command against a base-branch checkout does
 * not. Unresolvable or non-repo targets yield no opinion.
 *
 * @param {(dir: string) => {branch?: string}|null} resolveCtx injected for tests
 * @returns {{permissionDecision: 'deny', permissionDecisionReason: string}|null}
 */
export function evaluateBashWrite(payload, resolveCtx, { allowBaseEdits = false, cwd = '', isIgnored = () => false } = {}) {
  if (allowBaseEdits) return null;

  const toolName = payload.tool_name ?? payload.toolName ?? '';
  if (toolName !== 'Bash') return null;

  const input = payload.tool_input ?? payload.toolInput ?? {};
  const command = typeof input.command === 'string' ? input.command : '';
  const base = cwd || payload.cwd || '';

  // Each target carries the directory in effect where its write happens, so
  // `cd /tmp && cat > scratch.txt` resolves against /tmp (allowed) while
  // `cd <repo> && cat > f` resolves into the repo (denied) and
  // `echo hi > f; cd /tmp` is judged against the session cwd it actually wrote to.
  for (const { target, dir, unknownDir } of bashWriteTargets(command)) {
    // A `~` target is not resolvable here; skip rather than guess.
    if (target.startsWith('~')) continue;
    if (!isAbsolute(target) && unknownDir) continue;

    const relativeBase = dir ? resolve(base, dir) : base;
    const absolute = isAbsolute(target) ? target : resolve(relativeBase, target);
    if (isAlwaysAllowed(absolute)) continue;

    const judgeDir = judgeDirFor(absolute);
    if (!judgeDir) continue;

    const ctx = resolveCtx(judgeDir);
    if (!ctx?.branch || !isBaseBranch(ctx.branch)) continue;
    if (isIgnored(absolute)) continue;

    return {
      permissionDecision: 'deny',
      permissionDecisionReason:
        `git-per-task: this command writes "${target}", which is in a repo on "${ctx.branch}" — a base branch. `
        + 'Invoke the bench:task-start skill to create or switch to a task branch, then repeat the command. '
        + `If the write is genuinely meant for ${ctx.branch}, the user can set BENCH_ALLOW_BASE_EDITS=1.`,
    };
  }

  return null;
}

/**
 * Deny a `git worktree add` whose target is outside <main-checkout>/.claude/worktrees.
 *
 * @param {(dir: string) => string|null} resolveMain injected for tests
 * @returns {{permissionDecision: 'deny', permissionDecisionReason: string}|null}
 */
export function evaluateWorktreeAdd(payload, resolveMain, { allowAnywhere = false, cwd = '' } = {}) {
  if (allowAnywhere) return null;
  if ((payload.tool_name ?? payload.toolName) !== 'Bash') return null;

  const input = payload.tool_input ?? payload.toolInput ?? {};
  const command = typeof input.command === 'string' ? input.command : '';
  const misplaced = misplacedWorktreeAdd(command, cwd || payload.cwd || '', resolveMain);
  if (!misplaced) return null;

  return {
    permissionDecision: 'deny',
    permissionDecisionReason:
      `worktree location: "${misplaced.target}" is outside the repo. Worktrees live inside the main checkout, `
      + `under .claude/worktrees — repeat the command with "${misplaced.expected}" as the path. `
      + 'This applies even when the project docs show a sibling path like ../<repo>-<name>. '
      + 'If a worktree genuinely belongs elsewhere, the user can set BENCH_ALLOW_ANY_WORKTREE_PATH=1.',
  };
}

export function compactContext(ctx) {
  const rules = [
    'git-per-task: never edit on a base branch; push after every commit, no batching.',
    'bench-tools-first: prefer the matching bench skill or agent over hand-rolling.',
    'pr-review-via-agent: PR reviews go through the bench:code-reviewer agent.',
    'pr-comment-action-scope: only post change-requesting PR comments the user agreed to.',
    'code-comments: default to zero comments; make the code self-explanatory.',
  ];

  const lines = ['bench — re-asserting after compaction.', '', 'Non-negotiable rules:'];
  for (const r of rules) lines.push(`- ${r}`);

  if (ctx?.branch) {
    lines.push('', 'Current task state:');
    lines.push(`- branch: ${ctx.branch}${ctx.onBase ? ' (BASE BRANCH — edits are blocked)' : ''}`);
    if (ctx.issueRef) lines.push(`- issue: ${ctx.issueRef}`);
    if (ctx.base) lines.push(`- base: ${ctx.base}`);
    if (ctx.unpushed > 0) lines.push(`- ${ctx.unpushed} unpushed commit(s) — push now per git-per-task.`);
  }

  return lines.join('\n');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    if (!raw.trim()) return exit(0);
    payload = JSON.parse(raw);
  } catch {
    return exit(0);
  }

  let out = null;
  try {
    const dir = payload.cwd || processCwd();
    const event = payload.hook_event_name ?? payload.hookEventName ?? '';

    if (event === 'SessionStart') {
      // Registered with matcher "compact", so this only fires post-compaction.
      // The source check is belt-and-braces against a looser registration.
      if (payload.source === 'compact') {
        const context = compactContext(taskContext(dir));
        if (context) {
          out = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
        }
      }
    } else if ((payload.tool_name ?? payload.toolName) === 'Bash') {
      const verdict = evaluateWorktreeAdd(payload, mainCheckout, {
        allowAnywhere: env.BENCH_ALLOW_ANY_WORKTREE_PATH === '1',
        cwd: dir,
      }) ?? evaluateBashWrite(payload, branchContext, {
        allowBaseEdits: env.BENCH_ALLOW_BASE_EDITS === '1',
        cwd: dir,
        isIgnored: isGitIgnored,
      });
      if (verdict) {
        out = { hookSpecificOutput: { hookEventName: 'PreToolUse', ...verdict } };
      }
    } else {
      // Judge the branch of the repo the write LANDS IN, not the session's cwd.
      // In a multi-repo or worktree session those differ, and judging cwd denied
      // legitimate edits — pushing users to BENCH_ALLOW_BASE_EDITS=1, which
      // disables the guard everywhere. Falls back to cwd for a brand-new path
      // whose parent does not exist yet.
      const target = targetPath(payload.tool_input ?? payload.toolInput);
      const targetDir = target ? judgeDirFor(isAbsolute(target) ? target : resolve(dir, target)) : '';
      const guardDir = targetDir || dir;

      // The write guard reads only branch/onBase but runs on every Edit and
      // Write, so it takes the two-subprocess context rather than the full one.
      const verdict = evaluateWrite(payload, branchContext(guardDir), {
        allowBaseEdits: env.BENCH_ALLOW_BASE_EDITS === '1',
        isIgnored: isGitIgnored,
      });
      if (verdict) {
        out = { hookSpecificOutput: { hookEventName: 'PreToolUse', ...verdict } };
      }
    }
  } catch {
    // Fail open: never make the repo unwritable because of a guard bug.
    return exit(0);
  }

  if (out) stdout.write(JSON.stringify(out));
  exit(0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}
