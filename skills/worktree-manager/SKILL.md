---
name: worktree-manager
description: Manage Claude Code worktrees — rename agent-named dirs to branch-based names, init dependencies, keep editor workspace files (.code-workspace + Zed launcher) in sync, and reuse existing worktrees per task. TRIGGER when entering a worktree session, after task-start switches branches, after `git worktree add`/`remove`, when the user says "sync worktree workspace", "rename worktree", or "open worktrees in editor". SKIP for repos that don't use Claude Code worktrees.
model: haiku
tags: [audience/personal, portable/verbatim]
---

# Worktree manager

Claude Code's worktree feature creates dirs with adjective-style names (`goofy-munching-sunbeam`) on auto-named branches (`worktree-goofy-munching-sunbeam`). Once a real task branch lives in that worktree, the dir name becomes meaningless. This skill keeps everything coherent.

## What it does

1. **Renames worktree dirs** to match their branch — `feature/sync-26571_xyz` → `feature__sync-26571_xyz`.
2. **Runs `init-worktree`** if dependencies haven't been linked.
3. **Generates an editor multi-root workspace file** at `<repo>/<repo-name>.code-workspace` listing main + every worktree.
4. **Generates a Zed launcher script** at `<repo>/.claude/open-in-zed.sh`.
5. **Updates `.gitignore`** to keep the workspace file and zed launcher out of git.
6. **Scans for an existing worktree** before creating a new one for a task.
7. **Prunes worktrees whose branches were merged** (opt-in).

## When to invoke

Run `node ~/.claude/skills/worktree-manager/scripts/manage.mjs <subcommand>` for any of these:

| Situation | Subcommand |
|---|---|
| Inside a fresh agent worktree, just switched to a real branch via `task-start` | `init` then `sync-workspace` (rename happens later from main) |
| Inside the main checkout, want to clean up + sync | `all` |
| Want to know if a worktree already exists for SYNC-26571 | `find-task sync-26571` |
| Just added or removed a worktree manually | `sync-workspace` |
| Want to remove worktrees whose PRs already merged | `prune-merged --apply` |
| Just want to see state | `scan` |

## Integration with other skills

### From `task-start`

Before creating a branch for a task, **scan for an existing worktree first**:

```bash
node ~/.claude/skills/worktree-manager/scripts/manage.mjs find-task <task-id>
```

If it returns a worktree path, tell the user to switch to it instead of starting fresh in the current location. If it returns `{ found: false }`, proceed with normal task-start.

### After `task-start` creates a branch in a worktree

If the current directory is a worktree (not the main checkout):

1. Run `node ~/.claude/skills/worktree-manager/scripts/manage.mjs init` — runs `npm run init-worktree` if dependencies aren't linked. **Always run this — don't just remind the user.**
2. The directory rename has to happen from the **main checkout** because `git worktree move` cannot rename the dir you're standing in. Tell the user: *"your worktree dir is `<old>`; run worktree-manager from the main checkout to rename to `<expected>` and sync the workspace file"*. Don't try to rename from inside the worktree.

### From `task-completion` (after the PR merges)

Suggest `prune-merged --apply` from the main checkout to drop merged worktrees and their branches. Don't run it without confirmation — the user may want to keep some for reference.

## Naming convention

Branch slashes become double-underscores in the dir name:

| Branch | Worktree dir |
|---|---|
| `feature/sync-26571_wizard-api-ts-framework` | `feature__sync-26571_wizard-api-ts-framework` |
| `fix/sync-26548_handle-null` | `fix__sync-26548_handle-null` |
| `chore/sync-26285_nx-spike` | `chore__sync-26285_nx-spike` |

Detached HEADs and worktrees on agent-style branches (`worktree-*`) are left alone.

## Workspace files

**`<repo>/<repo-name>.code-workspace`** — VSCode/Cursor multi-root workspace. Open with "File → Open Workspace from File…". Each worktree appears as a separate root with its own git context in the sidebar. Includes `search.exclude` and `files.watcherExclude` for `.claude/worktrees/**` so the main folder doesn't double-index.

**`<repo>/.claude/open-in-zed.sh`** — bash script that runs `zed <main> <worktree1> <worktree2> …`. Make a shell alias if you use Zed often.

Both files are added to `.gitignore` automatically (the skill appends if missing).

## Cross-platform notes

### macOS / Linux

- `git worktree move` works natively. The renamed dir keeps its inode, so any open editor windows pointing at the old path will break — close before renaming.
- Symlinked `node_modules` (set up by `init-worktree.mjs`) survives the rename because the symlink is relative.

### Windows

- The same script works on Windows with Node 20+. `cmd.exe` and PowerShell both honor the double-quoted paths in the git commands.
- Workspace folder paths in `.code-workspace` are written with forward slashes for portability (VSCode/Cursor accept either).
- `init-worktree.mjs` uses `'junction'` symlinks on `win32` automatically — no admin rights needed.
- Three Zed launchers are written: `.sh` (POSIX/git-bash/WSL), `.cmd` (cmd.exe), and `.ps1` (PowerShell). Pick whichever fits.
- The POSIX `chmod +x` step is skipped on Windows; cmd/ps1 launchers don't need it.

## Testing the skill

A self-contained integration test lives at `scripts/test.mjs`. It builds a throwaway git repo in `os.tmpdir()`, creates worktrees, exercises every subcommand, and asserts the outputs.

```bash
node ~/.claude/skills/worktree-manager/scripts/test.mjs
```

Runs in ~3 seconds, no network or external services. Cross-platform: same test passes on macOS, Linux, and Windows. Run it after editing `manage.mjs`.

## What it does NOT do

- Does not rename the worktree dir from inside that worktree (the cwd would vanish).
- Does not modify the user's editor settings — only generates the workspace file.
- Does not auto-prune worktrees without `--apply` — `prune-merged` is dry-run by default.

## Subcommand reference

```
manage.mjs scan
  → list every worktree with branch, expected dir name, mismatch flag, init status, task id

manage.mjs sync-workspace
  → regenerate .code-workspace + open-in-zed.sh + .gitignore entries

manage.mjs rename [--worktree <path>]
  → rename mismatched worktrees (or one specific worktree). Run from main checkout.

manage.mjs init [--worktree <path>]
  → npm run init-worktree on the worktree (default: current). Skipped if already initialized.

manage.mjs find-task <task-id>
  → returns the worktree for this task id, or { found: false }

manage.mjs prune-merged [--base <branch>] [--apply]
  → list (or remove with --apply) worktrees whose branch is merged into base (default: dev)

manage.mjs all
  → rename (if in main) + init (if in worktree) + sync-workspace
```
