#!/usr/bin/env node
// Tests for cleanup-core.mjs and session-end-cleanup.mjs.
//
// The end-to-end half runs the hook against a real git repo with a fake `docker`
// on PATH, which records every call, so ownership and the keep marker are checked
// against what would actually be executed.
//
// Usage: node cleanup.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { composeDownArgs, keepMarkerPath, parseStacks, parseWorktrees, planCleanup, worktreesUsed } from './cleanup-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'session-end-cleanup.mjs');

let pass = 0;
let fail = 0;
const temps = [];

function step(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

const MAIN = '/r/app';
const WT = (name) => `${MAIN}/.claude/worktrees/${name}`;
const wt = (name, extra = {}) => ({ path: WT(name), branch: `feat/${name}`, locked: false, prunable: false, ...extra });
const stack = (project, dir) => ({ project, workingDir: dir, configFiles: [`${dir}/docker-compose.yml`] });

function plan(overrides = {}) {
  return planCleanup({
    main: MAIN,
    worktrees: [{ path: MAIN, branch: 'main' }, wt('a'), wt('b')],
    stacks: [],
    usedBySession: new Set(),
    isMerged: () => false,
    isDirty: () => false,
    isKept: () => false,
    exists: () => true,
    ...overrides,
  });
}

console.log('\ncleanup — parsing');

step('parses worktree porcelain with branch, lock and prunable', () => {
  const list = parseWorktrees([
    `worktree ${MAIN}`, 'HEAD 1', 'branch refs/heads/main', '',
    `worktree ${WT('a')}`, 'HEAD 2', 'branch refs/heads/feat/a', 'locked claude agent', '',
    `worktree ${WT('b')}`, 'HEAD 3', 'detached', 'prunable gitdir file points to non-existent location',
  ].join('\n'));
  assert.deepEqual(list.map((w) => [w.path, w.branch, w.locked, w.prunable]), [
    [MAIN, 'main', false, false], [WT('a'), 'feat/a', true, false], [WT('b'), null, false, true],
  ]);
});

step('a project name started from two folders is ambiguous and never taken down', () => {
  const stacks = parseStacks(`p1\t${WT('a')}\t\np1\t${WT('b')}\t`);
  assert.equal(stacks[0].ambiguous, true);
  const p = plan({ stacks, usedBySession: new Set([WT('a')]) });
  assert.equal(p.downStacks.length, 0);
});

step('used = ran in it, or a docker command named it; never a mention in output', () => {
  const worktrees = [wt('feat-4'), wt('feat-42'), wt('b'), wt('c')];
  const transcript = [
    { cwd: WT('feat-42') },
    { type: 'user', message: { content: [{ type: 'tool_result', content: `${WT('b')} abc [feat/b]\n${WT('c')} def [feat/c]` }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `docker compose -f ${WT('c')}/docker-compose.yml up -d` } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `git worktree list | grep ${WT('b')}` } }] } },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.deepEqual([...worktreesUsed(transcript, worktrees)].sort(), [WT('c'), WT('feat-42')].sort());
});

step('one stack per compose project, config files split', () => {
  const stacks = parseStacks(`p1\t${WT('a')}\t${WT('a')}/c.yml,/tmp/net.yml\np1\t${WT('a')}\t\np2\t${MAIN}\t`);
  assert.equal(stacks.length, 2);
  assert.deepEqual(stacks[0].configFiles, [`${WT('a')}/c.yml`, '/tmp/net.yml']);
});

console.log('\ncleanup — policy');

step('merged and clean: worktree removed, its stacks taken down', () => {
  const p = plan({ isMerged: (w) => w.path === WT('a'), stacks: [stack('pa', WT('a'))], usedBySession: new Set([WT('a')]) });
  assert.deepEqual(p.removeWorktrees.map((w) => w.path), [WT('a')]);
  assert.deepEqual(p.downStacks.map((d) => d.stack.project), ['pa']);
});

step('merged but dirty: nothing removed', () => {
  const p = plan({ isMerged: () => true, isDirty: () => true });
  assert.equal(p.removeWorktrees.length, 0);
});

step('open task this session used: stack down with its data kept, worktree stays', () => {
  const p = plan({ stacks: [stack('pa', WT('a'))], usedBySession: new Set([WT('a')]) });
  assert.equal(p.removeWorktrees.length, 0);
  assert.deepEqual(p.downStacks.map((d) => [d.stack.project, d.keepData]), [['pa', true]]);
});

step('merged worktree with recent git activity from another session is skipped', () => {
  const p = plan({ isMerged: () => true, isRecentlyActive: (w) => w.path === WT('a') });
  assert.ok(!p.removeWorktrees.some((w) => w.path === WT('a')));
  assert.ok(p.removeWorktrees.some((w) => w.path === WT('b')));
});

step('recent activity does not block a worktree this session used', () => {
  const p = plan({ isMerged: () => true, isRecentlyActive: () => true, usedBySession: new Set([WT('a')]) });
  assert.deepEqual(p.removeWorktrees.map((w) => w.path), [WT('a')]);
});

step("another session's stack is never touched", () => {
  const p = plan({ stacks: [stack('pb', WT('b'))], usedBySession: new Set([WT('a')]) });
  assert.equal(p.downStacks.length, 0);
});

step('merged worktree with a running stack this session never used is skipped', () => {
  const p = plan({ isMerged: () => true, stacks: [stack('pb', WT('b'))] });
  assert.ok(!p.removeWorktrees.some((w) => w.path === WT('b')));
  assert.ok(p.skipped.some((s) => s.path === WT('b')));
});

step('keep marker keeps the worktree and its stack', () => {
  const p = plan({ isMerged: () => true, isKept: (w) => w.path === WT('a'), stacks: [stack('pa', WT('a'))], usedBySession: new Set([WT('a')]) });
  assert.ok(!p.removeWorktrees.some((w) => w.path === WT('a')));
  assert.equal(p.downStacks.length, 0);
  assert.equal(p.kept[0].path, WT('a'));
});

step('locked worktrees are left alone', () => {
  const p = plan({ worktrees: [{ path: MAIN, branch: 'main' }, wt('a', { locked: true })], isMerged: () => true });
  assert.equal(p.removeWorktrees.length, 0);
});

step('stack of a worktree that no longer exists is an orphan and comes down', () => {
  const p = plan({ stacks: [stack('gone', WT('gone'))], exists: (path) => !path.includes('gone') });
  assert.deepEqual(p.downStacks.map((d) => d.stack.project), ['gone']);
});

step('main checkout stacks are never touched', () => {
  const p = plan({ stacks: [stack('m', MAIN)], usedBySession: new Set([MAIN]) });
  assert.equal(p.downStacks.length, 0);
});

step('compose down uses the config files when they all exist, removes volumes and built images', () => {
  const s = stack('pa', WT('a'));
  assert.deepEqual(composeDownArgs(s, () => true),
    ['compose', '-p', 'pa', '--project-directory', WT('a'), '-f', `${WT('a')}/docker-compose.yml`,
      'down', '--volumes', '--rmi', 'local', '--remove-orphans']);
  assert.deepEqual(composeDownArgs(s, () => false),
    ['compose', '-p', 'pa', 'down', '--volumes', '--rmi', 'local', '--remove-orphans']);
  assert.deepEqual(composeDownArgs(s, () => false, { keepData: true }),
    ['compose', '-p', 'pa', 'down', '--rmi', 'local', '--remove-orphans']);
});

console.log('\ncleanup — end-to-end against a real repo');

const root = mkdtempSync(join(tmpdir(), 'bench-cleanup-'));
temps.push(root);
const G = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const origin = join(root, 'origin.git');
const main = join(root, 'app');
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
execFileSync('git', ['clone', '-q', origin, main], { stdio: 'ignore' });
G(main, 'config', 'user.email', 't@t');
G(main, 'config', 'user.name', 't');
G(main, 'commit', '-q', '--allow-empty', '-m', 'init');
G(main, 'push', '-q', 'origin', 'HEAD:main');
G(main, 'remote', 'set-head', 'origin', 'main');

function worktreeWithCommits(name, files) {
  const path = join(main, '.claude', 'worktrees', name);
  G(main, 'worktree', 'add', '-q', path, '-b', `feat/${name}`, 'origin/main');
  for (const [file, body] of files) {
    writeFileSync(join(path, file), body);
    G(path, 'add', file);
    G(path, 'commit', '-q', '-m', `${name} ${file}`);
  }
  return path;
}

const squashed = worktreeWithCommits('squashed', [['a.txt', 'a'], ['b.txt', 'b']]);
const open = worktreeWithCommits('open', [['c.txt', 'c']]);
const kept = worktreeWithCommits('kept', [['d.txt', 'd']]);
G(main, 'merge', '-q', '--squash', 'feat/squashed');
G(main, 'commit', '-q', '-m', 'squash of feat/squashed');
G(main, 'merge', '-q', '--squash', 'feat/kept');
G(main, 'commit', '-q', '-m', 'squash of feat/kept');
G(main, 'push', '-q', 'origin', 'HEAD:main');
writeFileSync(keepMarkerPath(main, kept), '');

const bin = join(root, 'bin');
mkdirSync(bin);
const calls = join(root, 'docker-calls.log');
const ps = [`s-open\t${open}\t${open}/compose.yml`, `s-kept\t${kept}\t`, `s-other\t${join(main, '.claude', 'worktrees', 'other')}\t`].join('\n');
writeFileSync(join(main, '.claude', 'worktrees', 'other'), '');
writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> "${calls}"\n[ "$1" = ps ] && printf '%s\\n' '${ps.replace(/'/g, "'\\''")}'\nexit 0\n`);
chmodSync(join(bin, 'docker'), 0o755);

const transcript = join(root, 'transcript.jsonl');
writeFileSync(transcript, [
  { cwd: open },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `docker compose -f ${squashed}/compose.yml up -d` } }] } },
].map((e) => JSON.stringify(e)).join('\n'));

function hook(extraArgs = []) {
  return execFileSync('node', [HOOK, ...extraArgs], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'SessionEnd', cwd: main, transcript_path: transcript }),
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: main, CLAUDE_PRUNE_BASE: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

step('dry run plans without changing anything', () => {
  const p = JSON.parse(hook(['--dry-run']));
  assert.deepEqual(p.removeWorktrees.map((w) => w.branch), ['feat/squashed']);
  assert.deepEqual(p.downStacks.map((d) => d.stack.project), ['s-open']);
  assert.ok(existsSync(squashed));
});

step('applies: squash-merged worktree and branch gone, open one kept, only owned stacks down', () => {
  hook();
  assert.ok(!existsSync(squashed), 'squash-merged worktree removed');
  assert.equal(G(main, 'branch', '--list', 'feat/squashed'), '');
  assert.ok(existsSync(open), 'open task keeps its files');
  assert.ok(existsSync(kept), 'keep marker honoured');
  const log = readFileSync(calls, 'utf8');
  assert.match(log, /compose -p s-open .*down --rmi local/);
  assert.doesNotMatch(log, /-p s-open .*--volumes/);
  assert.doesNotMatch(log, /-p s-kept/);
  assert.doesNotMatch(log, /-p s-other/);
});

for (const d of temps) rmSync(d, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
