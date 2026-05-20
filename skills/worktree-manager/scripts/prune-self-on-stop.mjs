#!/usr/bin/env node
// Claude Code Stop-hook: if the session ran inside a worktree whose branch is
// already merged into origin/<base>, prune the worktree + branch + dir.
//
// Conservative: never touches main, never prunes unmerged or dirty branches,
// silent on every guardrail miss so it's safe on every Stop event.
//
// Wired via ~/.claude/settings.json:
//   "hooks": {
//     "Stop": [
//       { "hooks": [{ "type": "command", "command": "node ~/.claude/skills/worktree-manager/scripts/prune-self-on-stop.mjs" }] }
//     ]
//   }
//
// Env vars:
//   CLAUDE_PROJECT_DIR  the session's primary working directory (set by harness)
//   CLAUDE_PRUNE_BASE   override base branch (default: dev)

import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, exit } from 'node:process';

const PROJECT_DIR = env.CLAUDE_PROJECT_DIR;
const BASE = env.CLAUDE_PRUNE_BASE || 'dev';
const REGEN_PREFIXES = ['.husky/_', 'node_modules'];

if (!PROJECT_DIR || !existsSync(PROJECT_DIR)) exit(0);

function git(args, opts = {}) {
    try {
        return execSync(`git ${args}`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            ...opts,
        }).trim();
    } catch {
        return null;
    }
}

// Resolve the main repo from inside the worktree. For a linked worktree,
// `git rev-parse --git-common-dir` points at <main>/.git (or just .git);
// its parent is the main repo path.
const commonDir = git(`-C "${PROJECT_DIR}" rev-parse --path-format=absolute --git-common-dir`);
if (!commonDir) exit(0);
const mainPath = resolve(commonDir, '..');

// Skip if PROJECT_DIR is the main checkout itself.
if (resolve(PROJECT_DIR) === mainPath) exit(0);

// Branch must be a real ref, not detached.
const branch = git(`-C "${PROJECT_DIR}" symbolic-ref --short HEAD`);
if (!branch) exit(0);

// Confirm PROJECT_DIR is a tracked worktree of mainPath.
const wtList = git(`-C "${mainPath}" worktree list --porcelain`);
if (!wtList || !wtList.split('\n').includes(`worktree ${PROJECT_DIR}`)) exit(0);

// Working tree must be clean ignoring known regen artifacts.
const status = git(`-C "${PROJECT_DIR}" status --porcelain`);
if (status) {
    const dirty = status.split('\n').filter((line) => {
        const path = line.slice(3); // strip "XY " prefix
        return !REGEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
    });
    if (dirty.length > 0) exit(0);
}

// Refresh the base ref. Non-fatal if offline.
git(`-C "${mainPath}" fetch --quiet origin ${BASE}`);

// Squash-merge-aware merge check via `git cherry`:
//   '+' lines are commits whose patch is NOT in base → still unmerged.
//   '-' lines are commits whose patch IS in base.
const cherry = git(`-C "${mainPath}" cherry origin/${BASE} ${branch}`);
if (cherry === null) exit(0);
const unmerged = cherry.split('\n').filter((line) => line.trim().startsWith('+'));
if (unmerged.length > 0) exit(0);

// All guardrails passed — prune.
console.error(`[claude-stop-hook] pruning merged worktree: ${PROJECT_DIR} (branch ${branch})`);
const removed = git(`-C "${mainPath}" worktree remove --force "${PROJECT_DIR}"`);
if (removed === null) {
    console.error(`[claude-stop-hook] worktree remove failed; leaving on disk`);
    exit(0);
}
git(`-C "${mainPath}" branch -D "${branch}"`);
if (existsSync(PROJECT_DIR)) {
    try {
        rmSync(PROJECT_DIR, { recursive: true, force: true });
    } catch (e) {
        console.error(`[claude-stop-hook] rmdir leftover failed: ${e.message}`);
    }
}
console.error(`[claude-stop-hook] pruned ${branch}`);
