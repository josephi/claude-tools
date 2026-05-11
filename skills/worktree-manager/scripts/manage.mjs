#!/usr/bin/env node
// Manage Claude Code worktrees: rename to branch-based names, init dependencies,
// and keep editor workspace files (.code-workspace + Zed launcher) in sync.
//
// Usage:
//   node manage.mjs scan
//   node manage.mjs sync-workspace
//   node manage.mjs rename [--worktree <path>]
//   node manage.mjs init [--worktree <path>]
//   node manage.mjs find-task <task-id>
//   node manage.mjs all
//   node manage.mjs prune-merged [--base <branch>] [--apply]

import { execSync } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { argv, exit, cwd, platform } from 'node:process';

const IS_WIN = platform === 'win32';
const toForwardSlashes = (p) => p.replace(/\\/g, '/');

const ARGS = argv.slice(2);
const CMD = ARGS[0];
const FLAGS = parseFlags(ARGS.slice(1));

function parseFlags(rest) {
    const out = { _: [] };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith('--')) {
            const k = a.slice(2);
            const next = rest[i + 1];
            if (next && !next.startsWith('--')) { out[k] = next; i++; }
            else { out[k] = true; }
        } else {
            out._.push(a);
        }
    }
    return out;
}

function git(cmd, opts = {}) {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function run(cmd, opts = {}) {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function listWorktrees() {
    const raw = git('worktree list --porcelain');
    const blocks = raw.split('\n\n').filter(Boolean);
    return blocks.map((b) => {
        const out = { branch: null, head: null, path: null, detached: false };
        for (const line of b.split('\n')) {
            if (line.startsWith('worktree ')) out.path = line.slice('worktree '.length);
            else if (line.startsWith('HEAD ')) out.head = line.slice('HEAD '.length);
            else if (line.startsWith('branch ')) out.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
            else if (line === 'detached') out.detached = true;
        }
        return out;
    });
}

function findMain(worktrees) {
    return worktrees[0];
}

function expectedDirNameForBranch(branch) {
    if (!branch) return null;
    return branch.replace(/\//g, '__');
}

function isAgentNamed(dirName) {
    return /^worktree-/.test(dirName) || /^[a-z]+-[a-z]+-[a-z]+$/.test(dirName);
}

function deriveTaskId(branch) {
    if (!branch) return null;
    const m = branch.match(/([a-z]+-\d+(?:-\d+)*)/i);
    return m ? m[1].toLowerCase() : null;
}

function workspaceFolderName(wt, mainPath) {
    if (wt.path === mainPath) {
        const repo = basename(mainPath);
        const head = wt.branch || (wt.detached ? 'detached' : '?');
        return `${repo} (main: ${head})`;
    }
    const taskId = deriveTaskId(wt.branch);
    const tag = taskId || basename(wt.path);
    const branch = wt.branch || (wt.detached ? 'detached' : '?');
    return `${tag} [${branch}]`;
}

function projectName(mainPath) {
    return basename(mainPath);
}

function workspaceFilePath(mainPath) {
    return join(mainPath, `${projectName(mainPath)}.code-workspace`);
}

function zedLauncherPaths(mainPath) {
    return {
        sh: join(mainPath, '.claude', 'open-in-zed.sh'),
        cmd: join(mainPath, '.claude', 'open-in-zed.cmd'),
        ps1: join(mainPath, '.claude', 'open-in-zed.ps1'),
    };
}

async function ensureGitignore(mainPath) {
    const gi = join(mainPath, '.gitignore');
    if (!existsSync(gi)) return { status: 'no-gitignore' };
    const raw = await readFile(gi, 'utf8');
    const want = [
        '*.code-workspace',
        '.claude/open-in-zed.sh',
        '.claude/open-in-zed.cmd',
        '.claude/open-in-zed.ps1',
    ];
    const lines = raw.split(/\r?\n/);
    const missing = want.filter((w) => !lines.includes(w));
    if (!missing.length) return { status: 'ok' };
    const append = `\n# managed by worktree-manager skill\n${missing.join('\n')}\n`;
    await writeFile(gi, raw + append);
    return { status: 'updated', added: missing };
}

async function syncWorkspace() {
    const wts = listWorktrees();
    const main = findMain(wts);
    const mainPath = main.path;

    const folders = wts.map((wt) => ({
        name: workspaceFolderName(wt, mainPath),
        path: wt.path === mainPath ? '.' : toForwardSlashes(relative(mainPath, wt.path)),
    }));

    const ws = {
        folders,
        settings: {
            'search.exclude': {
                '**/.claude/worktrees/**': true,
                '**/node_modules/**': true,
                '**/dist/**': true,
            },
            'files.watcherExclude': {
                '**/.claude/worktrees/**': true,
                '**/node_modules/**': true,
            },
        },
    };

    const wsPath = workspaceFilePath(mainPath);
    await writeFile(wsPath, `${JSON.stringify(ws, null, 4)}\n`);

    const zed = zedLauncherPaths(mainPath);
    await mkdir(dirname(zed.sh), { recursive: true });

    const shArgs = wts.map((w) => `"${toForwardSlashes(w.path)}"`).join(' ');
    const sh = `#!/usr/bin/env bash
# managed by worktree-manager skill — opens main + every worktree in Zed
set -e
exec zed ${shArgs}
`;
    await writeFile(zed.sh, sh);
    if (!IS_WIN) {
        try { run(`chmod +x "${zed.sh}"`); } catch { /* best-effort */ }
    }

    const cmdArgs = wts.map((w) => `"${w.path}"`).join(' ');
    const cmdScript = `@echo off\r\nREM managed by worktree-manager skill — opens main + every worktree in Zed\r\nzed ${cmdArgs}\r\n`;
    await writeFile(zed.cmd, cmdScript);

    const ps1Args = wts.map((w) => `'${w.path.replace(/'/g, "''")}'`).join(' ');
    const ps1 = `# managed by worktree-manager skill — opens main + every worktree in Zed\r\nzed ${ps1Args}\r\n`;
    await writeFile(zed.ps1, ps1);

    const gi = await ensureGitignore(mainPath);

    return { wsPath, zedPaths: zed, count: folders.length, gitignore: gi };
}

function moveWorktree(oldPath, newPath, mainPath) {
    git(`-C "${mainPath}" worktree move "${oldPath}" "${newPath}"`);
}

function renameWorktrees(only) {
    const wts = listWorktrees();
    const main = findMain(wts);
    const mainPath = main.path;
    const results = [];

    for (const wt of wts) {
        if (wt.path === mainPath) continue;
        if (only && resolve(wt.path) !== resolve(only)) continue;
        if (!wt.branch) { results.push({ path: wt.path, status: 'skip-detached' }); continue; }

        const expected = expectedDirNameForBranch(wt.branch);
        const currentName = basename(wt.path);
        if (currentName === expected) { results.push({ path: wt.path, status: 'ok' }); continue; }

        const newPath = join(dirname(wt.path), expected);
        if (existsSync(newPath)) { results.push({ path: wt.path, status: 'skip-target-exists', target: newPath }); continue; }

        try {
            const myCwd = toForwardSlashes(resolve(cwd()));
            const wtAbs = toForwardSlashes(resolve(wt.path));
            const cmpCwd = IS_WIN ? myCwd.toLowerCase() : myCwd;
            const cmpWt = IS_WIN ? wtAbs.toLowerCase() : wtAbs;
            if (cmpCwd === cmpWt || cmpCwd.startsWith(`${cmpWt}/`)) {
                results.push({ path: wt.path, status: 'skip-cwd-inside', hint: 'run from main checkout' });
                continue;
            }
            moveWorktree(wt.path, newPath, mainPath);
            results.push({ path: wt.path, status: 'renamed', newPath });
        } catch (e) {
            results.push({ path: wt.path, status: 'error', error: e.message });
        }
    }
    return results;
}

function isInitialized(worktreePath) {
    const nm = join(worktreePath, 'node_modules');
    if (!existsSync(nm)) return false;
    try {
        const stat = lstatSync(nm);
        if (stat.isSymbolicLink()) return true;
        if (stat.isDirectory()) return true;
    } catch { /* ignore */ }
    return false;
}

function initWorktree(worktreePath) {
    const initScript = join(worktreePath, 'init-worktree.mjs');
    if (!existsSync(initScript)) return { status: 'skip-no-script' };
    if (isInitialized(worktreePath)) return { status: 'skip-already-initialized' };
    try {
        run(`npm run init-worktree`, { cwd: worktreePath, stdio: 'inherit' });
        return { status: 'initialized' };
    } catch (e) {
        return { status: 'error', error: e.message };
    }
}

function scan() {
    const wts = listWorktrees();
    const main = findMain(wts);
    const mainPath = main.path;

    return wts.map((wt) => {
        const isMain = wt.path === mainPath;
        const expected = isMain ? null : expectedDirNameForBranch(wt.branch);
        const dirName = basename(wt.path);
        return {
            path: wt.path,
            isMain,
            branch: wt.branch || (wt.detached ? '(detached)' : null),
            dirName,
            expectedDirName: expected,
            mismatch: expected ? expected !== dirName : false,
            initialized: isMain ? true : isInitialized(wt.path),
            taskId: deriveTaskId(wt.branch),
            agentNamed: isAgentNamed(dirName),
        };
    });
}

function findTask(taskId) {
    const target = String(taskId).toLowerCase();
    return scan().find((wt) => wt.taskId === target) || null;
}

function pruneMerged(base, apply) {
    const wts = listWorktrees();
    const main = findMain(wts);
    const mainPath = main.path;
    const baseRef = base || 'dev';

    const results = [];
    for (const wt of wts) {
        if (wt.path === mainPath) continue;
        if (!wt.branch) { results.push({ path: wt.path, status: 'skip-detached' }); continue; }
        let merged = false;
        try {
            const out = git(`-C "${mainPath}" branch --merged ${baseRef} --list "${wt.branch}"`);
            merged = out.trim().length > 0;
        } catch { /* base may not exist locally */ }
        if (!merged) { results.push({ path: wt.path, branch: wt.branch, status: 'not-merged' }); continue; }
        if (!apply) { results.push({ path: wt.path, branch: wt.branch, status: 'would-prune' }); continue; }
        try {
            git(`-C "${mainPath}" worktree remove --force "${wt.path}"`);
            git(`-C "${mainPath}" branch -D "${wt.branch}"`);
            results.push({ path: wt.path, branch: wt.branch, status: 'pruned' });
        } catch (e) {
            results.push({ path: wt.path, branch: wt.branch, status: 'error', error: e.message });
        }
    }
    return results;
}

function pretty(label, data) {
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(data, null, 2));
}

async function main() {
    if (!CMD) {
        console.error('usage: node manage.mjs <scan|sync-workspace|rename|init|find-task|all|prune-merged>');
        exit(2);
    }

    if (CMD === 'scan') {
        pretty('worktrees', scan());
        return;
    }

    if (CMD === 'sync-workspace') {
        const out = await syncWorkspace();
        pretty('sync-workspace', out);
        return;
    }

    if (CMD === 'rename') {
        const out = renameWorktrees(FLAGS.worktree);
        pretty('rename', out);
        return;
    }

    if (CMD === 'init') {
        const target = FLAGS.worktree || git('rev-parse --show-toplevel');
        const out = initWorktree(target);
        pretty('init', { target, ...out });
        return;
    }

    if (CMD === 'find-task') {
        const taskId = FLAGS._[0];
        if (!taskId) { console.error('usage: find-task <task-id>'); exit(2); }
        const out = findTask(taskId);
        pretty('find-task', out || { found: false, taskId });
        return;
    }

    if (CMD === 'prune-merged') {
        const out = pruneMerged(FLAGS.base, !!FLAGS.apply);
        pretty('prune-merged', out);
        return;
    }

    if (CMD === 'all') {
        const myCwd = resolve(cwd());
        const wts = listWorktrees();
        const main = findMain(wts);
        const inMain = myCwd === resolve(main.path);

        let renameOut = null;
        if (inMain) renameOut = renameWorktrees();

        const initTarget = inMain ? null : git('rev-parse --show-toplevel');
        const initOut = initTarget ? initWorktree(initTarget) : { status: 'skip-not-in-worktree' };

        const wsOut = await syncWorkspace();

        pretty('all', { renameOut, initOut, wsOut });
        return;
    }

    console.error(`unknown command: ${CMD}`);
    exit(2);
}

main().catch((err) => { console.error(err); exit(1); });
