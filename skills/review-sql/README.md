# review-sql

Code review checklist for SQL scripts and database migrations — used by the `code-reviewer` agent.

## When to use

PR contains `.sql` files or migration scripts.

## Checklist highlights

- Column size mismatches between variable declarations and table definitions
- Index impact: will new queries cause full table scans?
- Rollback safety: can the migration be reversed without data loss?
- Multi-statement changes wrapped in transactions
- Migrations are idempotent (`IF NOT EXISTS` guards)
- No hardcoded environment-specific values (server names, connection strings)

## Files

| Path | Description |
|------|-------------|
| `SKILL.md` | Full checklist and anti-patterns |
