#!/usr/bin/env node
// UserPromptSubmit hook. Matches the submitted prompt against hooks/routing.json
// and injects a directive naming the claude-tools skill or agent that should handle
// it.
//
// Why this exists: the claude-tools-tools-first rule lives in ~/.claude/CLAUDE.md,
// the lowest-salience position in the context window, competing with ~40 skill
// descriptions. UserPromptSubmit additionalContext lands *alongside the
// submitted prompt* instead, and only when a route actually matches — so it is
// both closer to the decision and quieter than always-on prose.
//
// Contract: exit 0 always, print nothing when no route matches. A router that
// errors must never cost the user their prompt (exit 2 on UserPromptSubmit
// erases it), so every failure path is silent.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argv, env, stdin, stdout, exit } from 'node:process';
import { findIssueRefs } from './lib/issue-ref.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = env.CLAUDE_TOOLS_ROUTING_TABLE?.trim() || join(HERE, 'routing.json');

export function loadTable(path = TABLE_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// No caching: each hook invocation is a fresh one-shot process handling exactly
// one prompt, so every pattern array is compiled at most once per run anyway.
function compile(patterns) {
  return (patterns ?? []).map((p) => new RegExp(p, 'i'));
}

function anyMatch(regexes, text) {
  return regexes.some((re) => re.test(text));
}

/**
 * Decide which routes fire for a prompt.
 * @returns {Array<{id: string, target: string, message: string}>}
 */
export function matchRoutes(prompt, table) {
  if (typeof prompt !== 'string' || prompt.trim() === '') return [];

  const refs = findIssueRefs(prompt);

  // A task reference is either an explicit issue (#42, gh-42, "issue 42") or a
  // bare noun phrase ("the new issue assigned to me") — the skill can resolve
  // the latter with `gh issue list`, so the router must not require a number.
  const hasTaskRef = refs.length > 0 || anyMatch(compile(table.taskRefPatterns), prompt);
  const keyList = refs.length > 0 ? refs.map((r) => r.ref).join(', ') : 'no issue given — resolve it with `gh issue list`';
  const hits = [];

  for (const route of table.routes ?? []) {
    if (route.requiresIssueRef && refs.length === 0) continue;
    if (route.requiresTaskRef && !hasTaskRef) continue;
    if (!anyMatch(compile(route.when), prompt)) continue;
    if (route.unless?.length && anyMatch(compile(route.unless), prompt)) continue;

    hits.push({
      id: route.id,
      target: route.target,
      message: route.message.replace(/\{\{issues\}\}/g, keyList),
    });
  }

  const cap = Number.isInteger(table.maxRoutesPerPrompt) ? table.maxRoutesPerPrompt : hits.length;
  return hits.slice(0, cap);
}

export function renderContext(hits) {
  if (hits.length === 0) return null;

  const header = hits.length === 1
    ? 'claude-tools routing — a specialized tool covers this prompt:'
    : 'claude-tools routing — specialized tools cover this prompt:';

  const body = hits
    .map((h) => `- ${h.target}\n  ${h.message}`)
    .join('\n');

  return `${header}\n${body}\n\n`
    + 'Use the named tool rather than hand-rolling the work. If you judge it genuinely does not fit, '
    + 'say so in one line and proceed — but do not silently skip it.';
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let prompt = '';
  try {
    const raw = await readStdin();
    if (!raw.trim()) return exit(0);
    const payload = JSON.parse(raw);
    prompt = payload.prompt ?? payload.user_input ?? payload.userInput ?? '';
  } catch {
    return exit(0);
  }

  let context = null;
  try {
    context = renderContext(matchRoutes(prompt, loadTable()));
  } catch {
    return exit(0);
  }

  if (context) {
    stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
      suppressOutput: true,
    }));
  }
  exit(0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}
