#!/usr/bin/env node
// Keeps the session's *identity* aligned with the task: the terminal tab title,
// the Claude Code session name, and the task-start banner.
//
// Mechanisms, both verified against Claude Code 2.1.220:
//
//   terminalSequence - a top-level hook output field carrying one OSC escape
//     sequence. The binary allowlists OSC 0/1/2/9/99/777 and BEL, so OSC 0
//     (icon + window title) is permitted and sets the Warp tab title. This
//     needs no MCP and no controlling terminal; the warp plugin's own
//     emit-terminal-sequence.sh documents the field landing in CC 2.1.141.
//
//   sessionTitle - a SessionStart-only hookSpecificOutput field. On startup and
//     resume we can therefore name the session from the branch, which removes
//     the manual `/rename` the task-start skill otherwise asks for every time.
//     No mid-session hook can set it, so the first task-start of a session
//     still needs `/rename` - the banner says so explicitly.
//
// The banner goes out as `systemMessage`, which the UI renders as a real notice
// rather than model prose, so it cannot be paraphrased away or skipped.
//
// Opt out with BENCH_NO_TAB_TITLE=1.
//
// Contract: exit 0 always; print nothing when there is nothing to say.

import { pathToFileURL } from 'node:url';
import { argv, env, stdin, stdout, exit, cwd as processCwd } from 'node:process';
import { taskContext } from './lib/task-context.mjs';
import { blankQuoted } from './lib/shell-command.mjs';

const ESC = '\x1b';
const BELL = '\x07';

/** OSC 0 sets icon name and window title together - the conventional tab title. */
export function osc0(title) {
  // An OSC body containing ESC or BEL would terminate the sequence early and be
  // rejected by the allowlist, so strip every control character first.
  const safe = String(title ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120);
  return safe ? `${ESC}]0;${safe}${BELL}` : null;
}

/** Tab title for a task context: session name when known, else the branch. */
export function tabTitle(ctx) {
  if (!ctx) return null;
  if (ctx.expectedSessionName) return ctx.expectedSessionName;
  if (ctx.branch) return ctx.onBase ? `${ctx.branch} (no task branch)` : ctx.branch;
  return null;
}

/**
 * The task banner.
 *
 * No hook payload carries the current session name, so this cannot tell whether
 * the session is already named correctly and the `/rename` line always prints.
 */
export function banner(ctx) {
  if (!ctx?.branch) return null;

  const name = ctx.expectedSessionName ?? '(no issue number in branch - none derivable)';
  const rows = [
    ['session name', name],
    ['worktree', ctx.worktree ? name : '(main checkout - no worktree rename needed)'],
    ['branch', ctx.branch],
    ['base', ctx.base ?? '(unknown)'],
    ['issue', ctx.issueRef ?? '(none)'],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  const body = rows.map(([k, v]) => `  ${k.padEnd(width)} : ${v}`).join('\n');

  const rule = '='.repeat(58);
  const lines = [rule, '  bench - task session', '', body];

  if (ctx.expectedSessionName) {
    lines.push('', `  -> Run  /rename ${ctx.expectedSessionName}`, '     to align the Claude Code session name.');
  }
  lines.push(rule);
  return lines.join('\n');
}

// Anchored to a shell command boundary, not \b: an unanchored match fires on any
// command that merely *mentions* the git subcommand inside a quoted argument
// (echoing an example, grepping a log, piping a JSON payload).
// `^\s*` not `^`: the command may be indented (heredocs, multi-line scripts,
// anything the model formats), and requiring position 0 silently missed those.
const BRANCH_CHANGE = /(?:^\s*|[;&|]\s*|\n\s*)git(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+(checkout|switch|worktree\s+add)\b/;

export function isBranchChange(payload) {
  const tool = payload.tool_name ?? payload.toolName ?? '';
  if (tool !== 'Bash') return false;
  const raw = payload.tool_input?.command ?? payload.toolInput?.command ?? '';
  if (typeof raw !== 'string') return false;
  const command = blankQuoted(raw);
  // `git checkout -- <path>` discards changes; it never changes branch.
  if (/\bcheckout\s+--\s/.test(command)) return false;
  return BRANCH_CHANGE.test(command);
}

function tabPayload(ctx) {
  if (env.BENCH_NO_TAB_TITLE === '1') return {};
  const seq = osc0(tabTitle(ctx));
  return seq ? { terminalSequence: seq } : {};
}

export function handleSessionStart(payload, ctx) {
  if (!ctx) return null;
  const out = { ...tabPayload(ctx) };

  if (ctx.expectedSessionName) {
    out.hookSpecificOutput = {
      hookEventName: 'SessionStart',
      sessionTitle: ctx.expectedSessionName,
    };
  }

  // On a base branch at startup there is no task yet - say so once, quietly,
  // rather than injecting a directive the model would have to act on.
  if (ctx.onBase && payload.source !== 'compact') {
    out.systemMessage = `bench - on ${ctx.branch} (a base branch). `
      + 'Run /bench:task-start before editing; git-per-task forbids direct edits here.';
  }

  return Object.keys(out).length ? out : null;
}

export function handleBranchChange(ctx) {
  if (!ctx?.branch) return null;
  const out = { ...tabPayload(ctx), suppressOutput: true };
  const b = banner(ctx);
  if (b) out.systemMessage = b;
  return out.systemMessage || out.terminalSequence ? out : null;
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

    // taskContext() spawns several git processes, and this hook runs on EVERY
    // Bash call. isBranchChange is a pure regex over the command string, so
    // resolve context only once it has passed — otherwise `ls` pays for git.
    if (event === 'SessionStart') out = handleSessionStart(payload, taskContext(dir));
    else if (isBranchChange(payload)) out = handleBranchChange(taskContext(dir));
  } catch {
    return exit(0);
  }

  if (out) stdout.write(JSON.stringify(out));
  exit(0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}
