#!/usr/bin/env node
// PostToolUse hook. Attaches the relevant bench convention next to the tool
// result at the moment it becomes relevant — a test-file edit gets
// testing-conventions, a new logger call gets log-standards, a commit gets the
// git-per-task push reminder.
//
// This exists because recall of the right convention, out of ~11 rules and ~40
// skill descriptions, decays over a long session. PostToolUse additionalContext
// lands next to the tool result, so the reminder arrives attached to the action
// that triggered it rather than competing for attention up front.
//
// Informational nudges are once-per-session (a reminder repeated on every edit
// becomes noise the model learns to skip). Actionable ones — the push reminder
// — fire every time, because each commit genuinely needs its own push.
//
// Contract: exit 0 always, print nothing when nothing applies.

import { readFileSync, mkdirSync, existsSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argv, env, stdin, stdout, exit } from 'node:process';
import { blankQuoted } from './lib/shell-command.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = env.BENCH_NUDGE_TABLE?.trim() || join(HERE, 'nudges.json');

const CLAUDE_DIR = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
const PLUGIN_DATA = env.CLAUDE_PLUGIN_DATA?.trim()
  || join(CLAUDE_DIR, 'plugins', 'data', 'bench-josephi-bench');

export function loadTable(path = TABLE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// No caching: each hook invocation is a fresh one-shot process handling exactly
// one tool call, so every pattern array is compiled at most once per run anyway.
function anyMatch(patterns, text, flags = '') {
  if (!patterns?.length || typeof text !== 'string') return false;
  return patterns.some((p) => new RegExp(p, flags).test(text));
}

// Text a tool call is about to introduce. Edit uses new_string, Write uses
// content, MultiEdit carries an edits array. Only *added* text is considered,
// so reading a file full of comments never trips the comment nudge.
export function addedText(toolName, input = {}) {
  if (!input || typeof input !== 'object') return '';
  const parts = [];
  if (typeof input.new_string === 'string') parts.push(input.new_string);
  if (typeof input.content === 'string') parts.push(input.content);
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) if (typeof e?.new_string === 'string') parts.push(e.new_string);
  }
  return parts.join('\n');
}

/**
 * Which nudges apply to this tool call.
 * @returns {Array<{id: string, message: string, oncePerSession: boolean}>}
 */
export function matchNudges(payload, table) {
  const toolName = payload.tool_name ?? payload.toolName ?? '';
  const input = payload.tool_input ?? payload.toolInput ?? {};
  if (!toolName) return [];

  const filePath = typeof input.file_path === 'string' ? input.file_path
    : typeof input.notebook_path === 'string' ? input.notebook_path : '';
  // Quoted runs blanked so a pattern meant for the command's flags cannot read
  // its arguments — `git commit -m "fix --amend handling"` was suppressing the
  // push nudge via the --amend in the message.
  const command = blankQuoted(typeof input.command === 'string' ? input.command : '');
  const added = addedText(toolName, input);

  const hits = [];

  for (const n of table.nudges ?? []) {
    if (n.tools?.length && !n.tools.includes(toolName)) continue;

    // Every declared condition family that a nudge specifies must match.
    if (n.filePathPatterns && !anyMatch(n.filePathPatterns, filePath, 'i')) continue;
    if (n.contentPatterns && !anyMatch(n.contentPatterns, added, 'm')) continue;
    if (n.commandPatterns && !anyMatch(n.commandPatterns, command)) continue;
    if (n.commandUnless && anyMatch(n.commandUnless, command)) continue;

    // A nudge with no condition beyond `tools` would fire on every call.
    if (!n.filePathPatterns && !n.contentPatterns && !n.commandPatterns) continue;

    hits.push({ id: n.id, message: n.message, oncePerSession: n.oncePerSession === true });
  }

  const cap = Number.isInteger(table.maxNudgesPerCall) ? table.maxNudgesPerCall : hits.length;
  return hits.slice(0, cap);
}

// Once-per-session bookkeeping. One append-only file per session id; a missing
// or unwritable state dir degrades to "always nudge" rather than failing.
function seenPath(sessionId) {
  const safe = String(sessionId ?? 'unknown').replace(/[^\w.-]/g, '_');
  return join(PLUGIN_DATA, 'nudge-state', `${safe}.log`);
}

export function filterAlreadySeen(hits, sessionId, io = defaultIo) {
  const once = hits.filter((h) => h.oncePerSession);
  if (once.length === 0) return hits;

  const seen = io.read(sessionId);
  const kept = hits.filter((h) => !h.oncePerSession || !seen.has(h.id));
  const toRecord = kept.filter((h) => h.oncePerSession).map((h) => h.id);
  if (toRecord.length) io.write(sessionId, toRecord);
  return kept;
}

const defaultIo = {
  read(sessionId) {
    try {
      const raw = readFileSync(seenPath(sessionId), 'utf8');
      return new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean));
    } catch {
      return new Set();
    }
  },
  write(sessionId, ids) {
    try {
      const p = seenPath(sessionId);
      if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, `${ids.join('\n')}\n`);
      pruneStale(dirname(p));
    } catch { /* nudging is best-effort; never fail a tool call over state */ }
  },
};

// One state file per session id and nothing else ever deletes them, so without
// this the directory grows unboundedly. Sessions do not span two weeks; writes
// are rare (once-per-session nudges only), so pruning here costs nothing.
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

function pruneStale(dir) {
  try {
    const cutoff = Date.now() - STALE_MS;
    for (const f of readdirSync(dir)) {
      // Only our own session-state files; anything else that ever lands here is
      // not ours to delete.
      if (!f.endsWith('.log')) continue;
      const p = join(dir, f);
      try {
        if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
      } catch { /* raced or unreadable — skip */ }
    }
  } catch { /* state dir unreadable — the once-per-session filter degrades, nothing breaks */ }
}

export function render(hits) {
  if (hits.length === 0) return null;
  return hits.map((h) => `bench — ${h.message}`).join('\n\n');
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

  let context = null;
  try {
    const hits = filterAlreadySeen(
      matchNudges(payload, loadTable()),
      payload.session_id ?? payload.sessionId,
    );
    context = render(hits);
  } catch {
    return exit(0);
  }

  if (context) {
    stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
      suppressOutput: true,
    }));
  }
  exit(0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}
