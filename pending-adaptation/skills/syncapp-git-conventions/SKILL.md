---
name: syncapp-git-conventions
description: Applies branch and commit naming conventions. Use when creating branches, writing commit messages, or when the user mentions git workflow, branch naming, Conventional Commits, or task branches. Project and task ID context come from the repo's service.json.
model: haiku
tags: [audience/personal, portable/adapt]
---

# Git Conventions (project-agnostic)

Use these conventions for branch and commit hygiene. **Task ID and project context** come from the repo's **service.json** (see **service-json-context** rule): use `jiraProjectKey` or project convention for the task ID prefix (e.g. SYNC → `sync-25891`).

## Branch Naming

Format:
`<type>/<task-id-lowercase>_<short-clear-goal>`

Example (when project is SYNC):
`refactor/sync-25891_create-rabbitmq-producer-package`

Rules:
- Use lowercase only.
- Keep the goal short and explicit.
- Use hyphens inside the goal segment.
- One Jira task per branch.
- Task ID prefix from service.json (`jiraProjectKey` in lowercase, e.g. SYNC → sync).

## Allowed Branch Types

- `feature`
- `refactor`
- `fix`
- `chore`
- `test`
- `docs`

## Working Rules

- Create a dedicated branch per Jira task.
- Do not mix unrelated task changes in one branch.
- Keep commits scoped and descriptive for the task.
- Commit messages must follow Conventional Commits.

## Commit Message Convention

Use Conventional Commits format:
`<type>(<task-id-lowercase>/<scope>): <short description>`

Scope is mandatory and must include:
- Jira task ID in lowercase (from service.json project key, e.g. `sync-25891` for SYNC)
- a clear technical scope (e.g. `queue`, `sync`, `message-bus`)

Examples (SYNC project):
- `feat(sync-25891/queue): add retry strategy for dead-letter flow`
- `fix(sync-25891/sync): handle null metadata in upload initiator`
- `refactor(sync-25891/message-bus): extract publisher factory`

## Protected Branches

- Never perform changes directly on `dev`.
- Never perform changes directly on `master`.
- Always create and work from a task branch.
