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

## Sync

TBD — `sync.mjs` will install into Cursor / Claude Code / Gemini CLI configs the same way the work repo does.

## Pull from the work repo

TBD — `import.mjs` walks the work repo, reads `audience` and `portable` frontmatter, and pulls items classified as personal.
