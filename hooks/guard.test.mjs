#!/usr/bin/env node
// Tests for guard.mjs — the protected-branch write guard and post-compaction
// rule re-injection (SessionStart with source "compact").
//
// Usage: node hooks/guard.test.mjs

import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import {
  evaluateWrite, compactContext, isWriteTool, targetPath, isAlwaysAllowed, evaluateBashWrite,
} from './guard.mjs';
import { taskContext } from './lib/task-context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'guard.mjs');

let pass = 0;
let fail = 0;

function step(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('step callback must be synchronous');
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

const onBase = (branch = 'master') => ({ branch, onBase: true, base: branch, issueRef: null, unpushed: 0 });
const onTask = () => ({
  branch: 'refactor/1_x', onBase: false, base: 'master', issueRef: '#1', unpushed: 0,
});
const write = (tool, file_path) => ({ tool_name: tool, tool_input: { file_path } });

console.log('\nguard — helpers');

step('recognises the write tools', () => {
  for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) assert.ok(isWriteTool(t), t);
  for (const t of ['Read', 'Bash', 'Grep', 'Glob']) assert.ok(!isWriteTool(t), t);
});

step('extracts the target path from any of the known keys', () => {
  assert.equal(targetPath({ file_path: '/a' }), '/a');
  assert.equal(targetPath({ notebook_path: '/b' }), '/b');
  assert.equal(targetPath({}), '');
  assert.equal(targetPath(undefined), '');
});

step('always-allowed paths are recognised', () => {
  assert.ok(isAlwaysAllowed('/r/.claude/settings.local.json'));
  assert.ok(isAlwaysAllowed('/r/.git/config'));
  assert.ok(!isAlwaysAllowed('/r/src/app.js'));
});

// Forward-slash-only patterns never match Windows paths, and these two are the
// paths git-per-task documents as always writable.
step('always-allowed paths work with Windows separators', () => {
  assert.ok(isAlwaysAllowed('C:\\Users\\x\\.claude\\settings.local.json'));
  assert.ok(isAlwaysAllowed('C:\\repo\\.git\\config'));
  assert.ok(!isAlwaysAllowed('C:\\repo\\src\\app.js'));
});

step('a similarly-named file is not carved out', () => {
  assert.ok(!isAlwaysAllowed('/r/.claude/settings.json'));
  assert.ok(!isAlwaysAllowed('/r/gitignore/thing.js'));
});

console.log('\nguard — denies writes on a base branch');

for (const branch of ['master', 'main', 'dev', 'develop']) {
  step(`denies an Edit on ${branch}`, () => {
    const v = evaluateWrite(write('Edit', '/r/src/a.js'), onBase(branch));
    assert.equal(v.permissionDecision, 'deny');
    assert.match(v.permissionDecisionReason, new RegExp(branch));
  });
}

step('the reason names task-start so the model can self-correct', () => {
  const v = evaluateWrite(write('Write', '/r/src/a.js'), onBase());
  assert.match(v.permissionDecisionReason, /task-start/);
});

step('the reason names the escape hatch', () => {
  assert.match(evaluateWrite(write('Edit', '/r/a.js'), onBase()).permissionDecisionReason,
    /BENCH_ALLOW_BASE_EDITS=1/);
});

// The guard fails open by design, which means a THROW is indistinguishable from
// "allowed" in production. A name collision between two `dir` bindings made every
// Bash write silently permitted, and only the deny assertions caught it — so this
// exercises the evaluator directly over hostile and exotic input.
step('evaluateBashWrite never throws, whatever the command', () => {
  const ctx = () => ({ branch: 'master' });
  const commands = [
    '', '   ', '>', '>>', '>|', '<', '2>', 'cat >', 'cat > ', '| tee', '&&', ';;',
    'cd', 'cd -', 'cd &&', 'tee', 'sed -i', 'cp', 'mv', 'dd of=', 'rsync',
    '"', "'", '"unterminated', "'unterminated", '\\', 'echo \\',
    '<<EOF', 'cat <<EOF', '((', '[[', '$(', '`', '${', 'a=1',
    'cat > /dev/null', 'echo $((1>0))', 'x'.repeat(5000), `cat > ${'a/'.repeat(300)}f`,
    '\n\n\n', 'cat >\n', String.fromCharCode(1, 2, 3),
    // The byte behind the incident this battery was written for.
    `cat > a${String.fromCharCode(0)}b.txt`, String.fromCharCode(0),
  ];
  for (const command of commands) {
    assert.doesNotThrow(
      () => evaluateBashWrite({ tool_name: 'Bash', tool_input: { command } }, ctx, { cwd: '/r' }),
      `threw on: ${JSON.stringify(command).slice(0, 60)}`,
    );
  }
});

// The message must not merely ask for compliance — it states that the shell route
// is denied as well, which evaluateBashWrite now makes true.
step('the reason rules out shelling around the guard', () => {
  assert.match(evaluateWrite(write('Edit', '/r/a.js'), onBase()).permissionDecisionReason,
    /Shelling out to a write command is denied/);
});

step('covers every write tool', () => {
  for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    assert.equal(evaluateWrite(write(t, '/r/a.js'), onBase())?.permissionDecision, 'deny', t);
  }
});

console.log('\nguard — allows what it should');

step('allows writes on a task branch', () => {
  assert.equal(evaluateWrite(write('Edit', '/r/src/a.js'), onTask()), null);
});

step('allows non-write tools even on a base branch', () => {
  for (const t of ['Read', 'Bash', 'Grep']) {
    assert.equal(evaluateWrite({ tool_name: t, tool_input: {} }, onBase()), null, t);
  }
});

step('allows machine-config and .git paths on a base branch', () => {
  assert.equal(evaluateWrite(write('Edit', '/r/.claude/settings.local.json'), onBase()), null);
  assert.equal(evaluateWrite(write('Write', '/r/.git/config'), onBase()), null);
});

step('honours the escape hatch', () => {
  assert.equal(evaluateWrite(write('Edit', '/r/a.js'), onBase(), { allowBaseEdits: true }), null);
});

step('no opinion outside a repo', () => {
  assert.equal(evaluateWrite(write('Edit', '/r/a.js'), null), null);
});

step('no opinion on a detached HEAD', () => {
  assert.equal(evaluateWrite(write('Edit', '/r/a.js'), { branch: null, onBase: false }), null);
});

console.log('\nguard — post-compaction re-injection');

step('re-asserts the non-negotiable rules', () => {
  const c = compactContext(onTask());
  for (const s of ['git-per-task', 'bench-tools-first', 'pr-review-via-agent', 'code-comments']) {
    assert.ok(c.includes(s), `missing ${s}`);
  }
});

step('includes current branch and issue ref', () => {
  const c = compactContext(onTask());
  assert.match(c, /refactor\/1_x/);
  assert.match(c, /#1/);
  assert.match(c, /master/);
});

step('marks a base branch as blocked', () => {
  assert.match(compactContext(onBase()), /BASE BRANCH/);
});

step('surfaces unpushed commits', () => {
  assert.match(compactContext({ ...onTask(), unpushed: 3 }), /3 unpushed commit/);
});

step('omits task state outside a repo but still lists rules', () => {
  const c = compactContext(null);
  assert.match(c, /git-per-task/);
  assert.ok(!c.includes('Current task state'));
});

// ---------------------------------------------------------------- end to end

console.log('\nguard — end-to-end against a real repo');

const temps = [];

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'bench-guard-'));
  temps.push(dir);
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  await mkdir(origin, { recursive: true });
  const G = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  G(['init', '--bare', '--initial-branch=master', '.'], origin);
  G(['clone', origin, work], dir);
  G(['config', 'user.email', 't@t'], work);
  G(['config', 'user.name', 'T'], work);
  writeFileSync(join(work, 'a.txt'), 'a\n');
  G(['add', '.'], work);
  G(['commit', '-m', 'init'], work);
  G(['push', '-u', 'origin', 'master'], work);
  return { work, G };
}

function run(payload, cwd, extraEnv = {}) {
  const out = execFileSync('node', [SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify({ cwd, ...payload }),
    env: { ...process.env, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return out ? JSON.parse(out) : null;
}

try {
  const { work, G } = await makeRepo();

  step('denies an Edit while on master', () => {
    const res = run({ hook_event_name: 'PreToolUse', ...write('Edit', join(work, 'a.txt')) }, work);
    assert.equal(res.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(res.hookSpecificOutput.hookEventName, 'PreToolUse');
  });

  step('allows the same Edit after switching to a task branch', () => {
    G(['checkout', '-b', 'feature/sync-2_y'], work);
    assert.equal(run({ hook_event_name: 'PreToolUse', ...write('Edit', join(work, 'a.txt')) }, work), null);
  });

  // The guard judges the repo the write lands in, not the session's cwd. Judging
  // cwd denied legitimate cross-repo edits and pushed users to the global escape
  // hatch.
  step('an edit into a task-branch repo is allowed even when cwd is on master', () => {
    G(['checkout', 'master'], work);
    const other = join(temps[0], 'other-repo');
    execFileSync('git', ['init', '-b', 'master', other], { stdio: 'ignore' });
    G(['config', 'user.email', 't@t'], other);
    G(['config', 'user.name', 'T'], other);
    writeFileSync(join(other, 'x.txt'), 'x\n');
    G(['add', '.'], other);
    G(['commit', '-m', 'init'], other);
    G(['checkout', '-b', 'feature/sync-3_z'], other);

    const res = run({ hook_event_name: 'PreToolUse', ...write('Edit', join(other, 'x.txt')) }, work);
    assert.equal(res, null, 'target repo is on a feature branch; cwd must not decide');
  });

  step('an edit into a master repo is denied even when cwd is on a feature branch', () => {
    G(['checkout', 'feature/sync-2_y'], work);
    const other2 = join(temps[0], 'other-repo-2');
    execFileSync('git', ['init', '-b', 'master', other2], { stdio: 'ignore' });
    G(['config', 'user.email', 't@t'], other2);
    G(['config', 'user.name', 'T'], other2);
    writeFileSync(join(other2, 'y.txt'), 'y\n');
    G(['add', '.'], other2);
    G(['commit', '-m', 'init'], other2);

    const res = run({ hook_event_name: 'PreToolUse', ...write('Edit', join(other2, 'y.txt')) }, work);
    assert.equal(res.hookSpecificOutput.permissionDecision, 'deny',
      'target repo is on master; a feature-branch cwd must not bypass the guard');
  });

  step('a new file in a not-yet-existing directory falls back to cwd', () => {
    G(['checkout', 'feature/sync-2_y'], work);
    const res = run({
      hook_event_name: 'PreToolUse',
      ...write('Write', join(work, 'brand', 'new', 'deep', 'file.js')),
    }, work);
    assert.equal(res, null, 'cwd is on a feature branch, so the write is fine');
  });

  // Bash reaches the filesystem without any write tool, so the guard covered
  // Edit/Write while `cat > file` walked past it — enforcement resting on the
  // deny message asking the model not to shell around it.
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

  step('denies a redirect into a master repo', () => {
    G(['checkout', 'master'], work);
    const res = run({ hook_event_name: 'PreToolUse', ...bash(`cat > ${join(work, 'a.txt')}`) }, work);
    assert.equal(res.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(res.hookSpecificOutput.permissionDecisionReason, /git-per-task/);
  });

  step('denies sed -i and tee into a master repo', () => {
    for (const cmd of [`sed -i '' s/a/b/ ${join(work, 'a.txt')}`, `echo x | tee ${join(work, 'a.txt')}`]) {
      const res = run({ hook_event_name: 'PreToolUse', ...bash(cmd) }, work);
      assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny', cmd);
    }
  });

  step('denies a relative redirect resolved against cwd', () => {
    const res = run({ hook_event_name: 'PreToolUse', ...bash('echo x >> a.txt') }, work);
    assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
  });

  step('allows the same redirect on a task branch', () => {
    G(['checkout', 'feature/sync-2_y'], work);
    assert.equal(run({ hook_event_name: 'PreToolUse', ...bash(`cat > ${join(work, 'a.txt')}`) }, work), null);
  });

  // The guard must not become a tax on ordinary shell use while on a base branch.
  step('allows non-write and out-of-repo commands on master', () => {
    G(['checkout', 'master'], work);
    for (const cmd of [
      'npm test 2>&1',
      'command -v pandoc > /dev/null',
      'git status --short',
      'echo "a > b"',
      `cat ${join(work, 'a.txt')}`,
      'echo scratch > /tmp/bench-scratch.txt',
    ]) {
      assert.equal(run({ hook_event_name: 'PreToolUse', ...bash(cmd) }, work), null, cmd);
    }
  });

  step('allows a Bash write to settings.local.json on master', () => {
    const res = run({
      hook_event_name: 'PreToolUse',
      ...bash(`echo '{}' > ${join(work, '.claude', 'settings.local.json')}`),
    }, work);
    assert.equal(res, null, 'machine config stays writable on a base branch');
  });

  // Every one of these denied a read-only command through the real hook. Kept as
  // end-to-end cases rather than unit cases because the deny came from the
  // combination of extractor and cwd resolution, not from either alone.
  step('read-only commands with a bare > are allowed on master', () => {
    G(['checkout', 'master'], work);
    for (const cmd of [
      'if (( count > 3 )); then echo hi; fi',
      '[[ "$a" > "$b" ]] && echo yes',
      'echo done # writes > nothing',
      'psql <<EOF\nselect 1 > 0;\nEOF',
      'git commit -F- <<EOF\nfix: handle a > b\nEOF',
      'rsync -av src/ user@host:/var/www',
    ]) {
      const res = run({ hook_event_name: 'PreToolUse', ...bash(cmd) }, work);
      assert.equal(res, null, `denied a command that writes nothing: ${cmd.split('\n')[0]}`);
    }
  });

  step('a cd to elsewhere makes a relative write no longer the repo\'s business', () => {
    for (const cmd of [
      'cd /tmp && cat > scratch.txt',
      '( cd /tmp; echo x > note.txt )',
      'echo start\ncd /tmp\ncat > scratch.txt',
      'pwd\npushd /tmp\necho x > f.txt',
    ]) {
      assert.equal(run({ hook_event_name: 'PreToolUse', ...bash(cmd) }, work), null, cmd);
    }
  });

  // Skipping relative targets whenever a cd appeared was too blunt: it allowed a cd
  // INTO the repo, and let a cd appended after a write excuse that write.
  step('a cd into the repo still gets the write judged', () => {
    const res = run({ hook_event_name: 'PreToolUse', ...bash(`cd ${work} && cat > newfile.txt`) }, work);
    assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny',
      'the cd names the repo itself, so the target is resolvable and on master');
  });

  step('a subshell cd does not excuse a later write into the repo', () => {
    const res = run({ hook_event_name: 'PreToolUse', ...bash('( cd /tmp; echo a > t.txt ); cat > repo.txt') }, work);
    assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny',
      'the second write is back in the repo once the subshell closes');
  });

  step('a cd after the write does not excuse it', () => {
    const res = run({ hook_event_name: 'PreToolUse', ...bash('echo hi > tracked.txt; cd /tmp') }, work);
    assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
  });

  step('an escaped > comparison is allowed on master', () => {
    for (const cmd of ['[ "$c" \\> 0 ] && echo yes', 'test 3 \\> 2', 'expr 4 \\> 5']) {
      assert.equal(run({ hook_event_name: 'PreToolUse', ...bash(cmd) }, work), null, cmd);
    }
  });

  step('a quoted redirect target is still denied', () => {
    for (const cmd of [`cat > "${join(work, 'q.txt')}"`, `cat > '${join(work, 'q2.txt')}'`]) {
      assert.equal(run({ hook_event_name: 'PreToolUse', ...bash(cmd) }, work)
        ?.hookSpecificOutput?.permissionDecision, 'deny', cmd);
    }
  });

  step('a copy into the repo root directory is still denied', () => {
    const res = run({ hook_event_name: 'PreToolUse', ...bash(`cp /tmp/x.txt ${work}`) }, work);
    assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny',
      'the target IS the repo dir, so its parent must not be what gets judged');
  });

  step('fd-prefixed redirects into the repo are denied', () => {
    for (const cmd of [`echo hi 1> ${join(work, 'n.txt')}`, `make 2> ${join(work, 'e.log')}`]) {
      assert.equal(run({ hook_event_name: 'PreToolUse', ...bash(cmd) }, work)
        ?.hookSpecificOutput?.permissionDecision, 'deny', cmd);
    }
  });

  step('the escape hatch also covers Bash writes', () => {
    const res = run({ hook_event_name: 'PreToolUse', ...bash(`cat > ${join(work, 'a.txt')}`) },
      work, { BENCH_ALLOW_BASE_EDITS: '1' });
    assert.equal(res, null);
  });

  step('escape hatch unblocks master', () => {
    G(['checkout', 'master'], work);
    const res = run({ hook_event_name: 'PreToolUse', ...write('Edit', join(work, 'a.txt')) }, work,
      { BENCH_ALLOW_BASE_EDITS: '1' });
    assert.equal(res, null);
  });

  // additionalContext is documented for SessionStart, not PostCompact, so the
  // re-injection rides SessionStart with matcher "compact".
  step('SessionStart(compact) emits additionalContext', () => {
    const res = run({ hook_event_name: 'SessionStart', source: 'compact' }, work);
    assert.equal(res.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(res.hookSpecificOutput.additionalContext, /git-per-task/);
  });

  step('SessionStart with any other source stays silent', () => {
    for (const source of ['startup', 'resume', 'clear']) {
      assert.equal(run({ hook_event_name: 'SessionStart', source }, work), null, source);
    }
  });

  step('fails open on malformed stdin', () => {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf8', input: '{bad', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.equal(out.trim(), '');
  });

  step('fails open outside a repo', () => {
    const plain = join(temps[0], 'not-a-repo');
    assert.equal(run({ hook_event_name: 'PreToolUse', ...write('Edit', '/x/a.js') }, plain), null);
  });
} finally {
  for (const d of temps) await rm(d, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
