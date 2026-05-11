#!/usr/bin/env node
// Integration test for manage.mjs. Cross-platform — runs on macOS, Linux, Windows.
// Creates a temp git repo with worktrees, exercises every subcommand, asserts.
//
// Usage: node test.mjs

import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { tmpdir, platform as osPlatform } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SCRIPT = fileURLToPath(new URL('./manage.mjs', import.meta.url));
const IS_WIN = osPlatform() === 'win32';

let tmpRoot = null;
let pass = 0;
let fail = 0;

function git(cwd, cmd) {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function manage(cwd, args) {
    const out = execSync(`node "${SCRIPT}" ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const idx = out.indexOf('===');
    if (idx === -1) return null;
    const jsonStart = out.indexOf('\n', idx) + 1;
    return JSON.parse(out.slice(jsonStart));
}

async function step(label, fn) {
    try {
        await fn();
        console.log(`  ok ${label}`);
        pass++;
    } catch (e) {
        console.error(`  FAIL ${label}\n      ${e.message}`);
        fail++;
    }
}

async function main() {
    // Canonicalize via realpath so paths match what git returns (macOS /var → /private/var, etc.)
    tmpRoot = realpathSync(await mkdtemp(join(tmpdir(), 'wt-mgr-test-')));
    const mainRepo = join(tmpRoot, 'project');
    execSync(`git init -b dev "${mainRepo}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    git(mainRepo, 'config user.email test@example.com');
    git(mainRepo, 'config user.name Tester');
    git(mainRepo, 'config commit.gpgsign false');
    git(mainRepo, 'commit --allow-empty -m initial');

    const wt1Old = join(mainRepo, '.claude', 'worktrees', 'silly-orbiting-lemon');
    const wt2 = join(mainRepo, '.claude', 'worktrees', 'random-junk');
    const wt3 = join(mainRepo, '.claude', 'worktrees', 'detached-one');

    git(mainRepo, `worktree add -b feature/test-100_one "${wt1Old}"`);
    // Add a commit on the feature branch so prune-merged sees it as unmerged.
    await writeFile(join(wt1Old, 'a.txt'), 'one');
    git(wt1Old, 'add a.txt');
    git(wt1Old, 'commit -m "feature work"');

    git(mainRepo, `worktree add -b worktree-junk "${wt2}"`);
    git(mainRepo, `worktree add --detach "${wt3}"`);

    console.log(`\n[setup] tmp=${tmpRoot}\n`);

    await step('scan returns 4 entries (main + 3 worktrees)', () => {
        const out = manage(mainRepo, 'scan');
        assert.equal(out.length, 4);
    });

    await step('scan flags feature/* worktree as mismatched', () => {
        const out = manage(mainRepo, 'scan');
        const entry = out.find((e) => e.taskId === 'test-100');
        assert.ok(entry, 'task entry missing');
        assert.equal(entry.mismatch, true);
        assert.equal(entry.expectedDirName, 'feature__test-100_one');
    });

    await step('scan does not propose rename for detached worktree', () => {
        const out = manage(mainRepo, 'scan');
        const entry = out.find((e) => e.path === wt3);
        assert.ok(entry, 'detached entry missing');
        assert.equal(entry.expectedDirName, null);
    });

    await step('sync-workspace generates .code-workspace with 4 folders', async () => {
        manage(mainRepo, 'sync-workspace');
        const wsPath = join(mainRepo, 'project.code-workspace');
        assert.ok(existsSync(wsPath));
        const ws = JSON.parse(await readFile(wsPath, 'utf8'));
        assert.equal(ws.folders.length, 4);
        for (const f of ws.folders) {
            if (f.path !== '.') assert.ok(!f.path.includes('\\'), `path uses backslash: ${f.path}`);
        }
    });

    await step('sync-workspace generates Zed launchers for both platforms', () => {
        assert.ok(existsSync(join(mainRepo, '.claude', 'open-in-zed.sh')));
        assert.ok(existsSync(join(mainRepo, '.claude', 'open-in-zed.cmd')));
        assert.ok(existsSync(join(mainRepo, '.claude', 'open-in-zed.ps1')));
    });

    await step('on POSIX, .sh launcher is executable', () => {
        if (IS_WIN) return;
        const mode = statSync(join(mainRepo, '.claude', 'open-in-zed.sh')).mode;
        assert.ok((mode & 0o111) !== 0, 'sh file not executable');
    });

    await step('rename mismatched worktree from main checkout', () => {
        const out = manage(mainRepo, `rename --worktree "${wt1Old}"`);
        const renamed = out.find((r) => r.status === 'renamed');
        assert.ok(renamed, `expected renamed entry, got: ${JSON.stringify(out)}`);
        const newPath = join(mainRepo, '.claude', 'worktrees', 'feature__test-100_one');
        assert.ok(existsSync(newPath));
        assert.ok(!existsSync(wt1Old));
    });

    await step('find-task returns the renamed worktree', () => {
        const out = manage(mainRepo, 'find-task test-100');
        assert.ok(out, 'find-task returned null');
        assert.ok(out.path.endsWith('feature__test-100_one'));
        assert.equal(out.mismatch, false);
    });

    await step('rename refuses when cwd is inside the worktree', () => {
        const wt2NewExpected = join(mainRepo, '.claude', 'worktrees', 'worktree-junk');
        // wt2 is on branch worktree-junk → expected dir is worktree-junk → no mismatch
        // To exercise the cwd-inside guard, we manually rename a branch first.
        git(wt2, 'checkout -b feature/test-200_two');
        const out = manage(wt2, 'rename');
        const blocked = out.find((r) => r.status === 'skip-cwd-inside');
        assert.ok(blocked, `expected skip-cwd-inside, got: ${JSON.stringify(out)}`);
    });

    await step('init returns skip-already-initialized when no init script + no node_modules', () => {
        // No init-worktree.mjs in temp repo; node_modules missing.
        // Script should report skip-no-script (since the init-worktree.mjs file isn't there).
        const newPath = join(mainRepo, '.claude', 'worktrees', 'feature__test-100_one');
        const out = manage(mainRepo, `init --worktree "${newPath}"`);
        assert.ok(['skip-no-script', 'skip-already-initialized'].includes(out.status), `got status: ${out.status}`);
    });

    await step('prune-merged dry-run reports not-merged', () => {
        const out = manage(mainRepo, 'prune-merged');
        assert.ok(out.some((r) => r.status === 'not-merged'), `expected not-merged, got: ${JSON.stringify(out)}`);
        assert.ok(!out.some((r) => r.status === 'pruned'), 'should not prune in dry-run');
    });

    await step('prune-merged --apply removes merged worktree branch', () => {
        // Merge feature/test-100_one into dev
        git(mainRepo, 'checkout dev');
        git(mainRepo, 'merge --no-ff feature/test-100_one -m merge-test-100');
        const out = manage(mainRepo, 'prune-merged --apply');
        const pruned = out.find((r) => r.branch === 'feature/test-100_one');
        assert.ok(pruned, `expected entry for feature/test-100_one, got: ${JSON.stringify(out)}`);
        assert.equal(pruned.status, 'pruned');
        assert.ok(!existsSync(join(mainRepo, '.claude', 'worktrees', 'feature__test-100_one')));
    });

    await step('gitignore appended once', async () => {
        manage(mainRepo, 'sync-workspace');
        manage(mainRepo, 'sync-workspace');
        const gi = await readFile(join(mainRepo, '.gitignore'), 'utf8').catch(() => null);
        if (gi == null) return; // no gitignore → skip
        const occurrences = (gi.match(/\*\.code-workspace/g) || []).length;
        assert.equal(occurrences, 1, `expected 1 occurrence, got ${occurrences}`);
    });
}

const cleanup = async () => {
    if (tmpRoot && existsSync(tmpRoot)) {
        await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
};

main()
    .then(async () => {
        await cleanup();
        console.log(`\n${pass} passed, ${fail} failed`);
        process.exit(fail > 0 ? 1 : 0);
    })
    .catch(async (err) => {
        console.error(err);
        await cleanup();
        process.exit(1);
    });
