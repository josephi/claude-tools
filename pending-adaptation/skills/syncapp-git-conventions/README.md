# syncapp-git-conventions

Branch naming and Conventional Commit message conventions. Project and task ID context come from `service.json`.

## When to use

Creating branches, writing commit messages, or any mention of git workflow, branch naming, or Conventional Commits.

## Branch format

```
<type>/<task-id-lowercase>_<short-clear-goal>
```

Example: `refactor/sync-25891_create-rabbitmq-producer-package`

**Allowed types:** `feature`, `refactor`, `fix`, `chore`, `test`, `docs`

## Commit format

```
<type>(<task-id-lowercase>/<scope>): <short description>
```

Examples:
- `feat(sync-25891/queue): add retry strategy for dead-letter flow`
- `fix(sync-25891/sync): handle null metadata in upload initiator`

## Rules

- Task ID prefix from `service.json` (`jiraProjectKey` lowercased, e.g. SYNC → `sync`)
- One Jira task per branch
- Never commit directly to `dev` or `master`

## Files

| Path | Description |
|------|-------------|
| `SKILL.md` | Full conventions, allowed types, and protected branch rules |
