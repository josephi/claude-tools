#!/usr/bin/env node
// Tests for session-identity.mjs and lib/task-context.mjs.
//
// The git-dependent helpers run against real throwaway repos in a temp dir —
// stubbing git here would only test the stub, and the fallback logic
// (pushed-without-tracking-config) is precisely what a stub would get wrong.
//
// Usage: node hooks/session-identity.test.mjs

import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { writeFileSync, mkdtempSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { osc0, tabTitle, banner, isBranchChange, handleSessionStart, handleBranchChange } from './session-identity.mjs';
import { taskContext, branchGoal, isBaseBranch, unpushedRef, unpushedCount, projectKey, projectConfig, currentBranch } from './lib/task-context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'session-identity.mjs');

let pass = 0;
let fail = 0;

// Deliberately rejects async callbacks. An un-awaited promise here would report
// `ok` before the assertions ran and surface the real failure as an unhandled
// rejection after the summary — which is exactly what happened while writing
// these tests. Keep step bodies synchronous.
function step(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      throw new Error('step callback must be synchronous — use the *Sync fs APIs');
    }
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

const ESC = '\x1b';
const BELL = '\x07';

// ---------------------------------------------------------------- OSC

console.log('\nsession-identity — OSC 0 encoding');

step('wraps the title in ESC ]0; ... BEL', () => {
  assert.equal(osc0('sync-1__x'), `${ESC}]0;sync-1__x${BELL}`);
});

step('is within the CC allowlist (OSC 0/1/2/9/99/777 + BEL)', () => {
  const seq = osc0('t');
  assert.match(seq, /^\x1b\]0;/);
  assert.equal(seq.at(-1), BELL);
});

step('strips control characters so a title cannot inject another sequence', () => {
  const seq = osc0(`a${ESC}]777;notify;x;y${BELL}b`);
  assert.equal(seq.indexOf(ESC), 0, 'only the leading ESC may remain');
  assert.equal(seq.indexOf(BELL), seq.length - 1, 'only the trailing BEL may remain');
});

step('returns null for empty/absent titles', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(osc0(v), null);
});

step('truncates a very long title', () => {
  assert.ok(osc0('x'.repeat(500)).length <= 120 + 5);
});

// ---------------------------------------------------------------- pure helpers

console.log('\ntask-context — pure helpers');

step('branchGoal extracts the goal half', () => {
  assert.equal(branchGoal('refactor/25891_add-retry-strategy'), 'add-retry-strategy');
  assert.equal(branchGoal('fix/3_null-metadata'), 'null-metadata');
  assert.equal(branchGoal('master'), '');
  assert.equal(branchGoal(undefined), '');
});

step('isBaseBranch covers dev/develop/master/main only', () => {
  for (const b of ['dev', 'develop', 'master', 'main']) assert.ok(isBaseBranch(b), b);
  for (const b of ['feature/x', 'devx', 'mainline', null]) assert.ok(!isBaseBranch(b), String(b));
});

console.log('\nsession-identity — tab title');

step('prefers the derived session name', () => {
  assert.equal(tabTitle({ expectedSessionName: '1__x', branch: 'refactor/1_x' }), '1__x');
});

step('falls back to the branch', () => {
  assert.equal(tabTitle({ branch: 'spike/thing', onBase: false }), 'spike/thing');
});

step('marks a base branch as having no task branch', () => {
  assert.equal(tabTitle({ branch: 'master', onBase: true }), 'master (no task branch)');
});

step('null for no context', () => {
  assert.equal(tabTitle(null), null);
  assert.equal(tabTitle({}), null);
});

console.log('\nsession-identity — banner');

const CTX = {
  branch: 'refactor/26478_ns-account-nightly',
  base: 'master',
  issueRef: '#26478',
  expectedSessionName: '26478__ns-account-nightly',
  worktree: true,
};

step('includes session name, worktree, branch, base and issue', () => {
  const b = banner(CTX);
  for (const s of ['26478__ns-account-nightly', 'refactor/26478_ns-account-nightly', 'master', '#26478']) {
    assert.ok(b.includes(s), `missing ${s}`);
  }
});

step('tells the user the exact /rename to run', () => {
  assert.match(banner(CTX), /\/rename 26478__ns-account-nightly/);
});

step('main checkout says no worktree rename is needed', () => {
  assert.match(banner({ ...CTX, worktree: false }), /main checkout/);
});

step('handles a branch with no derivable key', () => {
  const b = banner({ branch: 'spike/thing', base: 'master', issueRef: null, expectedSessionName: null, worktree: false });
  assert.match(b, /none derivable/);
  assert.ok(!b.includes('/rename'), 'no rename target when no name is derivable');
});

step('null without a branch', () => {
  assert.equal(banner(null), null);
  assert.equal(banner({}), null);
});

console.log('\nsession-identity — branch-change detection');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

for (const c of ['git checkout -b refactor/1_x', 'git switch other', 'git worktree add ../wt br', 'git -c a=b checkout main']) {
  step(`detects: ${c}`, () => assert.ok(isBranchChange(bash(c))));
}

for (const c of [
  'git checkout -- src/a.js', 'git status', 'git commit -m x', 'git push',
  // Must anchor to a command boundary: an unanchored match fires on any command
  // that merely mentions the subcommand inside a quoted argument.
  `echo '{"command":"git switch main"}' | node hooks/session-identity.mjs`,
  'grep -rn "git checkout" docs/',
  'echo "then run git switch main"',
]) {
  step(`ignores: ${c}`, () => assert.ok(!isBranchChange(bash(c))));
}

for (const c of ['git fetch && git switch main', 'cd r; git checkout -b refactor/1_x']) {
  step(`detects after a separator: ${c}`, () => assert.ok(isBranchChange(bash(c))));
}

// Anchoring to exactly position 0 silently missed indented commands — heredocs,
// multi-line scripts, anything the model formats. No banner, no tab title.
for (const c of ['  git checkout foo', '\tgit switch main', '    git worktree add ../wt br']) {
  step(`detects when indented: ${JSON.stringify(c)}`, () => assert.ok(isBranchChange(bash(c))));
}

step('a quoted mention is still not a branch change', () => {
  for (const c of ['grep -rn "git checkout" docs/', 'echo "then run git switch main"']) {
    assert.ok(!isBranchChange(bash(c)), c);
  }
});

step('ignores non-Bash tools', () => {
  assert.ok(!isBranchChange({ tool_name: 'Edit', tool_input: { command: 'git switch x' } }));
});

console.log('\nsession-identity — event handlers');

step('SessionStart sets sessionTitle and a tab title', () => {
  const out = handleSessionStart({ source: 'startup' }, CTX);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(out.hookSpecificOutput.sessionTitle, '26478__ns-account-nightly');
  assert.match(out.terminalSequence, /^\x1b\]0;/);
});

step('SessionStart on a base branch warns via systemMessage', () => {
  const out = handleSessionStart({ source: 'startup' }, { branch: 'master', onBase: true, base: 'master' });
  assert.match(out.systemMessage, /base branch/);
  assert.match(out.systemMessage, /task-start/);
});

step('SessionStart after a compact does not repeat the base-branch warning', () => {
  const out = handleSessionStart({ source: 'compact' }, { branch: 'master', onBase: true, base: 'master' });
  assert.ok(!out?.systemMessage);
});

step('BENCH_NO_TAB_TITLE=1 suppresses the tab title', () => {
  process.env.BENCH_NO_TAB_TITLE = '1';
  try {
    assert.equal(handleSessionStart({ source: 'startup' }, CTX).terminalSequence, undefined);
  } finally {
    delete process.env.BENCH_NO_TAB_TITLE;
  }
});

step('branch change emits banner plus tab title', () => {
  const out = handleBranchChange(CTX);
  assert.match(out.systemMessage, /bench/);
  assert.match(out.terminalSequence, /^\x1b\]0;/);
});

step('branch change with no context yields nothing', () => {
  assert.equal(handleBranchChange(null), null);
});

// ---------------------------------------------------------------- real repos

console.log('\ntask-context — against real git repos');

const G = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'bench-ctx-'));
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  await mkdir(origin, { recursive: true });
  G(['init', '--bare', '--initial-branch=master', '.'], origin);
  G(['clone', origin, work], dir);
  G(['config', 'user.email', 't@t'], work);
  G(['config', 'user.name', 'T'], work);
  writeFileSync(join(work, 'a.txt'), 'a\n');
  G(['add', '.'], work);
  G(['commit', '-m', 'init'], work);
  G(['push', '-u', 'origin', 'master'], work);
  return { dir, work };
}

const repos = [];
async function repo() {
  const r = await makeRepo();
  repos.push(r.dir);
  return r.work;
}

try {
  const work = await repo();

  step('resolves branch, base and issue ref from a task branch', () => {
    G(['checkout', '-b', 'refactor/26478_ns-account-nightly'], work);
    const c = taskContext(work);
    assert.equal(c.branch, 'refactor/26478_ns-account-nightly');
    assert.equal(c.base, 'master');
    assert.equal(c.issueRef, '#26478');
    assert.equal(c.issueNumber, '26478');
    assert.equal(c.expectedSessionName, '26478__ns-account-nightly');
    assert.equal(c.onBase, false);
  });

  step('a short issue number resolves too', () => {
    G(['checkout', '-b', 'fix/3_null-metadata'], work);
    const c = taskContext(work);
    assert.equal(c.issueRef, '#3');
    assert.equal(c.expectedSessionName, '3__null-metadata');
  });

  step('a branch with no issue number yields none', () => {
    G(['checkout', '-b', 'spike/try-something'], work);
    const c = taskContext(work);
    assert.equal(c.issueRef, null);
    assert.equal(c.expectedSessionName, null);
  });

  step('flags a base branch', () => {
    G(['checkout', 'master'], work);
    const c = taskContext(work);
    assert.equal(c.onBase, true);
    assert.equal(c.issueRef, null);
  });

  step('counts unpushed commits against a same-named remote branch', () => {
    G(['checkout', '-b', 'refactor/9_x'], work);
    writeFileSync(join(work, 'b.txt'), 'b\n');
    G(['add', '.'], work);
    G(['commit', '-m', 'two'], work);
    assert.equal(unpushedCount(work), 1, 'one commit ahead of base, not yet pushed');

    // Push WITHOUT tracking config — the sandbox-restricted case.
    G(['push', 'origin', 'HEAD:refs/heads/refactor/9_x'], work);
    G(['fetch', 'origin'], work);
    assert.equal(unpushedRef(work), 'origin/refactor/9_x');
    assert.equal(unpushedCount(work), 0, 'pushed branch must not report unpushed commits');
  });

  step('counts again after a further commit', () => {
    writeFileSync(join(work, 'c.txt'), 'c\n');
    G(['add', '.'], work);
    G(['commit', '-m', 'three'], work);
    assert.equal(unpushedCount(work), 1);
  });

  const cfgDir = mkdtempSync(join(tmpdir(), 'bench-cfg-'));
  const cfg = join(cfgDir, 'settings.local.json');
  const writeRegistry = (projects) => {
    writeFileSync(cfg, JSON.stringify({ projects }));
    process.env.PROJECTS_CFG = cfg;
  };

  step('resolves the personal-project key by exact repo basename', () => {
    writeRegistry({ [basename(work)]: { displayName: 'Exact match' } });
    assert.equal(projectKey(work), basename(work));
    assert.equal(projectConfig(work).displayName, 'Exact match');
  });

  step('falls back to a match glob', () => {
    writeRegistry({ aclim: { match: [`${basename(work).slice(0, 4)}*`], displayName: 'Glob match' } });
    assert.equal(projectKey(work), 'aclim');
    assert.equal(projectConfig(work).displayName, 'Glob match');
  });

  step('an exact key wins over another entry\'s glob', () => {
    writeRegistry({
      aclim: { match: ['*'], displayName: 'Glob match' },
      [basename(work)]: { displayName: 'Exact match' },
    });
    assert.equal(projectKey(work), basename(work));
  });

  step('an unregistered repo has no project key', () => {
    writeRegistry({ other: { match: ['nope-*'] } });
    assert.equal(projectKey(work), null);
    assert.equal(projectConfig(work), null);
  });

  step('a malformed registry is treated as absent, not fatal', () => {
    writeFileSync(cfg, '{ not json');
    process.env.PROJECTS_CFG = cfg;
    assert.equal(projectKey(work), null);
  });

  step('a missing registry file is treated as absent', () => {
    process.env.PROJECTS_CFG = join(cfgDir, 'does-not-exist.json');
    assert.equal(projectKey(work), null);
    delete process.env.PROJECTS_CFG;
  });

  step('non-repo directory yields null context', () => {
    const plain = mkdtempSync(join(tmpdir(), 'bench-plain-'));
    repos.push(plain);
    assert.equal(taskContext(plain), null);
    assert.equal(currentBranch(plain), null);
  });

  console.log('\nsession-identity — end-to-end stdin/stdout contract');

  const run = (payload, cwd) => {
    const out = execFileSync('node', [SCRIPT], {
      encoding: 'utf8',
      input: JSON.stringify({ cwd, ...payload }),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out ? JSON.parse(out) : null;
  };

  step('SessionStart emits sessionTitle for a task branch', () => {
    G(['checkout', 'refactor/26478_ns-account-nightly'], work);
    const res = run({ hook_event_name: 'SessionStart', source: 'startup' }, work);
    assert.equal(res.hookSpecificOutput.sessionTitle, '26478__ns-account-nightly');
  });

  step('branch-change Bash call emits the banner', () => {
    const res = run({ hook_event_name: 'PostToolUse', ...bash('git switch master') }, work);
    assert.match(res.systemMessage, /bench/);
  });

  step('unrelated Bash call is silent', () => {
    assert.equal(run({ hook_event_name: 'PostToolUse', ...bash('ls -la') }, work), null);
  });

  // isBranchChange is a pure regex; context resolution must stay behind it, or
  // every Bash call pays for git subprocesses it does not need.
  step('a non-branch-change Bash call spawns no git at all', () => {
    const shim = mkdtempSync(join(tmpdir(), 'bench-shim-'));
    repos.push(shim);
    const log = join(shim, 'log');
    writeFileSync(join(shim, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\nexec /usr/bin/git "$@"\n`);
    chmodSync(join(shim, 'git'), 0o755);

    const call = (command) => execFileSync('node', [SCRIPT], {
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work, ...bash(command) }),
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    writeFileSync(log, '');
    call('ls -la');
    assert.equal(readFileSync(log, 'utf8').trim(), '', 'no git should run for a non-branch command');

    writeFileSync(log, '');
    call('git switch master');
    assert.ok(readFileSync(log, 'utf8').trim().length > 0, 'a real branch change still resolves context');
  });

  step('malformed stdin is silent and exit 0', () => {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf8', input: '{bad', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.equal(out.trim(), '');
  });
} finally {
  for (const d of repos) await rm(d, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
