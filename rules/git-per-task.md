---
description: Branch-per-task and commit hygiene — create a task branch before any code change, stage before commit, pull-rebase and push after every commit, no batching pushes.
tags: [audience/personal, portable/verbatim]
---

# Git per task

## At task start

1. Check whether a branch already exists for this task.
2. If not, create one from the base branch (`dev`, `master`, `main` — whatever the project uses).
3. Switch to the branch **before** making any code change.

## Between implementation and commit

Stage the change, then let the user review the staged diff before the commit when the change is non-trivial. Use `git diff --cached` to review.

## After every commit

`git pull --rebase` and then `git push`. No batching — each commit reaches the remote immediately so feedback is continuous.

Never push `--force` to a protected branch (`dev`, `master`, `main`). On a feature branch, only force-push with lease (`--force-with-lease`) and only when the rebase is yours.

## When force-push is blocked by the sandbox

If `git push --force-with-lease` returns "Permission to use Bash with command ... has been denied," do not retry the command or a variant — the block is on the command shape, not transient. Tell the user to run it themselves with the `!` prefix:

> Force-push was denied — type `! git push --force-with-lease` to run it in this session.

The `!` prefix runs the command at the user level and pipes the output back into the conversation. After it succeeds, continue from where you left off. Don't propose alternatives like "want me to make a follow-up commit instead" unless asked — a clean force-push on a feature branch is usually preferred.

## Protected branches

Never make direct edits on `dev`, `master`, or `main`. Always work from a task branch.
