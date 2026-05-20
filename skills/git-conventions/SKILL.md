---
name: git-conventions
description: Branch and commit naming conventions for personal projects on GitHub. Use when creating branches, writing commit messages, or when the user mentions git workflow, Conventional Commits, or task branches. Issue number comes from the GitHub Issue the work is for.
model: haiku
tags: [audience/personal, portable/verbatim]
---

# Git Conventions

For personal repos on GitHub. **Issue number** is the GitHub Issue this work closes (e.g. `#42` → `42` for the branch, `#42` in commit/PR body).

## Branch Naming

Format:
`<type>/<issue-number>_<short-clear-goal>`

Example:
`refactor/42_extract-rabbitmq-producer`

Rules:
- Lowercase only.
- Goal segment is short and explicit; use hyphens inside it.
- One issue per branch. If the work spans multiple issues, that's a sign the issues should be merged or the branch split.
- Drop the `#`. Branch names with `#` are awkward in URLs and some tools.

## Allowed Branch Types

- `feat`
- `refactor`
- `fix`
- `chore`
- `test`
- `docs`
- `perf`
- `ci`

(Same set as Conventional Commits — branch type and commit type stay aligned.)

## Working Rules

- Create a dedicated branch per issue.
- Do not mix unrelated changes in one branch.
- Keep commits scoped and descriptive.

## Commit Message Convention

Conventional Commits:
`<type>(<scope>): <short description>`

- `type` — same set as branch type.
- `scope` — technical area (e.g. `queue`, `api`, `auth`), not the issue number. Optional but encouraged when the change is localized.
- Body — explain the *why* when non-obvious. Link the issue with `Closes #42` or `Refs #42` so GitHub auto-links and auto-closes on merge.

Examples:
- `feat(queue): add retry strategy for dead-letter flow`
  ```
  Closes #42
  ```
- `fix(sync): handle null metadata in upload initiator`
  ```
  Refs #57 — partial fix; null branch only.
  ```
- `refactor(message-bus): extract publisher factory`

## Protected Branches

- Never edit `main` (or `master`, `dev` if the repo still uses one) directly.
- Always work from a task branch.
- Never force-push to a protected branch. On feature branches, only `--force-with-lease` and only when the rebase is yours.
