---
name: task-start
description: Bootstrap a new task — check for an existing branch, create one from the base branch if needed, switch to it before any code change. TRIGGER when the user assigns a GitHub Issue, asks to start work on issue #<n>, or says "let's work on X". SKIP for questions, ad-hoc exploration, or fixes on the current branch.
model: haiku
tags: [audience/personal, portable/verbatim]
---

# Task start

Before any code change for a new task, set up the branch. No exceptions.

## Steps

1. **Resolve the issue.** From the user's prompt extract the issue number (or URL). `gh issue view <num> --json number,title,labels` to confirm it exists and pull the title.
2. **Pick the type prefix.** Use the issue label when present (`bug` → `fix`, `feat` → `feat`, `chore` → `chore`, etc.). Fall back to inferring from the title verb.
3. **Determine the base branch.** Usually `main`. Confirm with `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
4. **Check for an existing branch** for this issue:
   - `git branch --list "*_${ISSUE}_*" "*/${ISSUE}_*"` (local)
   - `git ls-remote --heads origin "*_${ISSUE}_*" "*/${ISSUE}_*"` (remote)
5. **Create from base if none exists.** Follow the `git-conventions` skill: `<type>/<issue-number>_<short-goal>`. Derive the goal from the issue title — short, hyphenated.
6. **Switch to the branch** before making any file edits.

## Branch naming

`<type>/<issue-number>_<short-goal>` — see the `git-conventions` skill.

Examples:
- `feat/42_add-retry-strategy`
- `fix/57_null-metadata`
- `refactor/103_extract-publisher-factory`

## What not to do

- Don't start editing before the branch exists.
- Don't reuse a branch from another issue.
- Don't branch off a feature branch for unrelated work — branch from the base.
- Don't guess the issue number from the title — resolve it via `gh issue view` first.
