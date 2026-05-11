---
name: task-start
description: Bootstrap a new task — check for an existing branch, create one from the base branch if needed, switch to it before any code change. TRIGGER when the user assigns a Jira task, asks to start work on a ticket, or says "let's work on X". SKIP for questions, ad-hoc exploration, or fixes on the current branch.
model: haiku
tags: [audience/personal, portable/adapt]
---

# Task start

Before any code change for a new task, set up the branch. No exceptions.

## Steps

1. **Read project context from `service.json`** — `jiraProjectKey`, `teamName`, `groupName`. See the `service-json-context` rule.
2. **Determine the base branch** — usually `dev` or `master`. Check the repo's default or ask if unclear.
3. **Check for an existing branch** for this task:
   - `git branch --list "*<task-id>*"`
   - `git ls-remote --heads origin "*<task-id>*"` (remote)
4. **Create from base if none exists.** Follow the naming convention in `syncapp-git-conventions` (or the project's equivalent): `<type>/<task-id-lowercase>_<short-goal>`.
5. **Switch to the branch** before making any file edits.

## Branch naming

`<type>/<task-id-lowercase>_<short-goal>`

- `type`: `feature`, `refactor`, `fix`, `chore`, `test`, `docs`
- `task-id`: lowercase project key + number (e.g. `sync-25891`)
- `goal`: short, hyphenated, specific

Examples:
- `feature/sync-25891_add-retry-strategy`
- `fix/sync-26003_null-metadata`

## What not to do

- Don't start editing before the branch exists.
- Don't reuse a branch from another task.
- Don't branch off a feature branch for unrelated work — branch from the base.
