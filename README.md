# ai-tools-personal

Personal AI IDE configuration — rules, skills, agents, commands, and MCP definitions that reflect how I work as a developer / architect / team lead, independent of any employer.

This repo is the personal counterpart to a work-specific repo (`.ai-tools`). The two share workflow shape but differ on integrations:

| Concern | Work | Personal |
|---|---|---|
| Issue tracker | Jira | Linear / GitHub Projects |
| Code host | TFS / Azure DevOps | GitHub |
| Chat | Tipalti Slack | personal Slack / Discord |

Items are pulled from the work repo when their `audience` frontmatter is `personal` or `both`. Items marked `portable: adapt` land in `pending-adaptation/` and need their integrations rewired before promotion to the live tree.

## Layout

```
rules/      .mdc rules with frontmatter — concatenated into per-IDE prompt files
skills/     <name>/SKILL.md + optional references/ and scripts/
agents/     persona files
commands/   slash command prompts
mcp/        MCP server definitions referencing ${ENV_VAR} placeholders
```

## Pull from the work repo

```bash
node import.mjs              # pull personal-classified items
node import.mjs --dry-run    # show what would happen, no writes
node import.mjs --source <path>  # override source (default: ~/repos/.ai-tools)
node import.mjs --force      # overwrite adapt items already in pending or live tree
```

`import.mjs` reads the `tags` frontmatter (`audience/*`, `portable/*`) on every rule, skill, and agent in the source repo:

| Routing | Destination |
|---|---|
| `audience/work` | skipped |
| `audience/personal` or `audience/both` + `portable/verbatim` | copied/overwritten to live tree on every run |
| `audience/personal` or `audience/both` + `portable/adapt` | dropped into `pending-adaptation/<kind>/<name>` on first import only — manually rewire integrations (Jira → Linear, TFS → GitHub, Slack channels), then move to live tree |
| `internal: true` | skipped |

Re-running is safe: `verbatim` items track upstream; `adapt` items aren't clobbered once they live anywhere in this repo.

## Sync

TBD — `sync.mjs` will install into Cursor / Claude Code / Gemini CLI configs the same way the work repo does.
