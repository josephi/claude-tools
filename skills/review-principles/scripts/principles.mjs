#!/usr/bin/env node
// The owner's review principles, kept once at user level and enriched
// incrementally: each review fetches only the owner's PR comments added since the
// last harvest of that repo, instead of re-reading every old PR.
//
//   principles.mjs path                      print the principles file
//   principles.mjs new --repo <owner/repo>   owner's new comments since the cursor (JSON)
//
// The cursors live in the principles file itself ("## Harvest cursors"), so the
// skill records new principles and the cursor in one edit, and this script never
// writes: a sandboxed shell cannot write the Claude config dir anyway.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argv, env, exit, stdout, stderr } from 'node:process';

const AGENT_REVIEW_MAX_CHARS = 600;
const EPOCH = '1970-01-01T00:00:00Z';

export function principlesDir(e = env) {
  return join(e.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'), 'review-principles');
}

export const principlesFile = (e = env) => join(principlesDir(e), 'principles.md');

export function parseCursors(markdown) {
  const section = (markdown ?? '').split(/^## Harvest cursors\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const cursors = {};
  for (const match of section.matchAll(/^- ([\w.-]+\/[\w.-]+): (\S+)\s*$/gm)) cursors[match[1]] = match[2];
  return cursors;
}

function cursorFor(repo) {
  try { return parseCursors(readFileSync(principlesFile(), 'utf8'))[repo] ?? EPOCH; } catch { return EPOCH; }
}

// Agents post under the owner's login too: findings with a severity label,
// replies that say what was done and cite a commit, generated summaries. The
// owner's own voice is a short question or instruction. This only narrows the
// candidates; the review-principles skill makes the final call.
const AGENT_OPENERS = [
  'change requested', 'observation', 'nit', 'suggestion', 'for discussion', 'warning', 'critical',
  'positive', 'question', 'blocking', 'non-blocking', 'blocker', 'should fix', 'should-fix', 'must fix',
  'minor', 'major', 'stale', 'same as', 'same fix', 'agreed', 'applied', 'kept', 'split', 'replaced',
  'follow-up', 'not a bug', 'not deliberate', 'verified', 'confirmed', 'done', 'merged', 'label added',
  'changed', 'fixed', 'removed', 'renamed', 'right', 'noted', 'dropped', 'superseded', 'left as is',
  'added', 'restored', 'review addressed', 'addressed',
];
const COMMIT_SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
const GENERATED = /🤖|Generated with|^#{1,6} |^\|.*\|$|^\*\*/m;

function opensLikeAnAgent(text) {
  const opening = text.replace(/^[*_`\s]+/, '').toLowerCase();
  return AGENT_OPENERS.some((word) => opening.startsWith(word) && !/[a-z]/.test(opening[word.length] ?? ''));
}

export function isOwnerVoice(body) {
  const text = (body ?? '').trim();
  if (!text || text.length > AGENT_REVIEW_MAX_CHARS) return false;
  const quotesCodeLikeAnAgent = (text.match(/`/g) ?? []).length >= 4;
  return !GENERATED.test(text) && !COMMIT_SHA.test(text) && !opensLikeAnAgent(text) && !quotesCodeLikeAnAgent;
}

export function prNumberOf(comment) {
  const url = comment.pull_request_url ?? comment.html_url ?? '';
  const match = url.match(/\/pulls?\/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function selectNew(comments, login, since) {
  return comments
    .filter((c) => c.user?.login === login && c.created_at > since && isOwnerVoice(c.body))
    .filter((c) => prNumberOf(c) !== null)
    .map((c) => ({
      pr: prNumberOf(c),
      url: c.html_url,
      path: c.path ?? null,
      line: c.line ?? c.original_line ?? null,
      created_at: c.created_at,
      body: c.body.trim(),
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

function ghPages(path) {
  const out = gh(['api', '--paginate', '--slurp', path]);
  return JSON.parse(out).flat();
}

function newComments(repo, login) {
  const since = cursorFor(repo);
  const until = new Date().toISOString();
  const query = `per_page=100&sort=created&direction=asc&since=${encodeURIComponent(since)}`;
  const inline = ghPages(`repos/${repo}/pulls/comments?${query}`);
  const conversation = ghPages(`repos/${repo}/issues/comments?${query}`).filter((c) => /\/pull\/\d+/.test(c.html_url ?? ''));
  return { repo, login, since, until, comments: selectNew([...inline, ...conversation], login, since) };
}

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
}

function main() {
  const command = argv[2];
  if (command === 'path') {
    stdout.write(`${principlesFile()}\n`);
    stdout.write(existsSync(principlesFile()) ? '' : '(not created yet)\n');
    return;
  }
  const repo = flag('repo');
  if (!repo) {
    stderr.write('usage: principles.mjs path | new --repo <owner/repo> [--login <me>]\n');
    exit(2);
  }
  if (command === 'new') {
    const login = flag('login') ?? gh(['api', 'user', '-q', '.login']).trim();
    stdout.write(`${JSON.stringify(newComments(repo, login), null, 2)}\n`);
    return;
  }
  stderr.write(`unknown command: ${command}\n`);
  exit(2);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) main();
