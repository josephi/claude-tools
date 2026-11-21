#!/usr/bin/env node
// Lists the owner's PR comments made since a repo's harvest cursor.
// Usage: principles.mjs path | new --repo <owner/repo> [--login <me>]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argv, env, exit, stdout, stderr } from 'node:process';

const EPOCH = '1970-01-01T00:00:00Z';
const CODE_SPANS_TYPICAL_OF_AGENTS = 2;
const LONG_FOR_THE_OWNER = 600;

// Only unmistakable generated output is dropped; everything else under the
// owner's login comes back with signals, and the skill decides.
const GENERATED = [
  /🤖|Generated with \[?Claude/,
  /^#{1,6} /m,
  /^\|.*\|\s*$/m,
  /^\*\*[^*]{2,40}[.:]?\*\*/,
  /^(Fixed|Addressed|Done|Changed|Replaced|Removed|Renamed) in [0-9a-f]{7,40}\b/i,
];
const AGENT_OPENERS = /^[*_\s]*(change requested|observation|nit|suggestion|for discussion|warning|critical|positive|blocker|should[- ]fix|must fix|minor|major|stale|agreed|applied|kept|verified|confirmed|merged|label added|left as is|superseded|review addressed)\b/i;
const COMMIT_SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;

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

export function parseOwnerLogin(markdown) {
  return (markdown ?? '').match(/^Owner login: (\S+)\s*$/m)?.[1] ?? null;
}

export function isGenerated(body) {
  return GENERATED.some((pattern) => pattern.test((body ?? '').trim()));
}

export function agentSignals(body) {
  const text = (body ?? '').trim();
  const signals = [];
  if (AGENT_OPENERS.test(text)) signals.push('opens like a review finding or reply');
  if (COMMIT_SHA.test(text)) signals.push('cites a commit');
  if ((text.match(/`[^`]+`/g) ?? []).length >= CODE_SPANS_TYPICAL_OF_AGENTS) signals.push('quotes code');
  if (text.length > LONG_FOR_THE_OWNER) signals.push('long');
  return signals;
}

export function prNumberOf(comment) {
  const url = comment.pull_request_url ?? comment.html_url ?? '';
  const match = url.match(/\/pulls?\/(\d+)/);
  return match ? Number(match[1]) : null;
}

const at = (iso) => Date.parse(iso);

// The window is (since, until], and until is the newest comment the server
// returned, so the next run starts exactly where this one stopped.
export function harvestWindow(allComments, since) {
  const until = allComments.map((c) => c.created_at)
    .filter((t) => at(t) > at(since))
    .reduce((newest, t) => (at(t) > at(newest) ? t : newest), since);
  return { since, until };
}

export function selectNew(comments, login, { since, until }) {
  return comments
    .filter((c) => c.user?.login === login && at(c.created_at) > at(since) && at(c.created_at) <= at(until))
    .filter((c) => prNumberOf(c) !== null && !isGenerated(c.body))
    .map((c) => ({
      pr: prNumberOf(c),
      url: c.html_url,
      path: c.path ?? null,
      created_at: c.created_at,
      agentSignals: agentSignals(c.body),
      body: c.body.trim(),
    }))
    .sort((a, b) => at(a.created_at) - at(b.created_at));
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

const ghPages = (path) => JSON.parse(gh(['api', '--paginate', '--slurp', path])).flat();

function readPrinciples() {
  try { return readFileSync(principlesFile(), 'utf8'); } catch { return ''; }
}

function newComments(repo, login) {
  const since = parseCursors(readPrinciples())[repo] ?? EPOCH;
  const query = `per_page=100&sort=created&direction=asc&since=${encodeURIComponent(since)}`;
  const inline = ghPages(`repos/${repo}/pulls/comments?${query}`);
  const conversation = ghPages(`repos/${repo}/issues/comments?${query}`).filter((c) => /\/pull\/\d+/.test(c.html_url ?? ''));
  const all = [...inline, ...conversation];
  const window = harvestWindow(all, since);
  return { repo, login, ...window, comments: selectNew(all, login, window) };
}

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
}

function main() {
  const command = argv[2];
  if (command === 'path') {
    stdout.write(`${principlesFile()}\n`);
    return;
  }
  const repo = flag('repo');
  if (command !== 'new' || !repo) {
    stderr.write('usage: principles.mjs path | new --repo <owner/repo> [--login <me>]\n');
    exit(2);
  }
  try {
    const login = flag('login') ?? parseOwnerLogin(readPrinciples()) ?? gh(['api', 'user', '-q', '.login']).trim();
    stdout.write(`${JSON.stringify(newComments(repo, login), null, 2)}\n`);
  } catch (error) {
    const reason = (error.stderr?.toString() || error.message).trim().split('\n')[0];
    stderr.write(`principles: could not fetch comments for ${repo}: ${reason}\n`);
    exit(1);
  }
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) main();
