---
name: review-sql
description: Code review checklist for SQL scripts and database migrations. TRIGGER when a PR, diff, or file review touches .sql files, migration scripts, or schema changes. SKIP for non-SQL source. Usually invoked by the code-reviewer agent but safe to call standalone.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# SQL / migrations review checklist

Language-specific review for SQL scripts and database migrations. Loaded by the **code-reviewer** agent when a PR contains `.sql` files or migration scripts.

## Checklist

- [ ] **Column size mismatches**: Do variable declarations match table column definitions?
- [ ] **Index impact**: Will new columns or queries cause full table scans?
- [ ] **Rollback safety**: Can this migration be reversed without data loss?
- [ ] **Transaction boundaries**: Are multi-statement changes wrapped in transactions?
- [ ] **Data type consistency**: Are types consistent across related tables and variables?
- [ ] **Idempotency**: Is the migration safe to re-run? (`IF NOT EXISTS` guards, etc.)
- [ ] **Naming**: Do columns, variables, and constraints follow existing conventions?

## Anti-Patterns to Flag

- Variable declared as `NVARCHAR(X)` when the target column is `NVARCHAR(Y)` with X > Y — silent truncation or runtime error
- `IF NOT EXISTS` matching on long free-text strings — fragile idempotency guard
- Missing `GO` batch separators between independent statements (SQL Server)
- DDL + DML in the same transaction without testing rollback
- Hardcoded environment-specific values (server names, connection strings)
- Missing index on columns used in `WHERE`/`JOIN` for large tables
- Inconsistent indentation across repeated blocks — makes reviews harder
- Variable names that don't match the column they map to (e.g. `@displayMessageText` for column `displayMessageTemplate`)
