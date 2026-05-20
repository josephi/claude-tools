# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Content, not a runtime. It holds rules, skills, agents, and MCP definitions that get installed into an IDE's prompt context (Claude Code, Cursor, etc.). No build, no test suite, no lint. The single "command" is `import.mjs`, which pulls personal-tagged content out of a parallel work repo.

## Common commands

```bash
node import.mjs                          # pull personal-classified items from the work repo
node import.mjs --dry-run                # show what would happen, no writes
node import.mjs --source <path>          # override source repo
node import.mjs --force                  # refresh adapt items that already sit in pending-adaptation/
```

The default source is `$AI_TOOLS_WORK` or `~/repos/.ai-tools`. **The actual location on this machine is `~/repos/sync-group-tools/ai-tools/`** — pass it with `--source` or export `AI_TOOLS_WORK`. The user's `~/.claude/CLAUDE.md` says the same: source of truth for the work repo is `sync-group-tools/ai-tools`.

There is no `sync.mjs` yet — the README lists it as TBD. Installing the content into `~/.claude/`, Cursor, or Gemini configs is currently a manual step (or done from the work repo's own sync script).

## How the routing actually works

`import.mjs` reads the `tags:` frontmatter line on every file in the source repo and classifies it:

| Source tag | Behavior |
|---|---|
| `audience/work` | Never pulled |
| `audience/personal` or `audience/both`, `portable/verbatim` | Copied to live tree (`rules/`, `skills/`, `agents/`); re-import overwrites on upstream drift |
| `audience/personal` or `audience/both`, `portable/adapt` | First import → `pending-adaptation/<kind>/<name>/`; once you move it to the live tree it is never re-clobbered |
| `internal: true` | Skipped |

Drift detection uses sha256 over file contents (or, for directories, a sorted hash of every file inside). The macOS finder junk (`.DS_Store`, `Icon\r`) is filtered out of both copy and hash.

### Renames

When you adapt-and-rename an item (e.g. `skills/jira` → `skills/github-issues`), add an entry to `RENAMED_ADAPTATIONS` near the top of `import.mjs`. Without it the importer can't infer the rename from frontmatter and re-queues the upstream original into `pending-adaptation/` every run. The current map:

- `rules/slack-formatting.md` → `rules/chat-formatting.md`
- `skills/jira` → `skills/github-issues`
- `skills/syncapp-git-conventions` → `skills/git-conventions`

## Layout

- `rules/` — `.md` rules with frontmatter. Each is a standalone principle the assistant should follow.
- `skills/<name>/SKILL.md` (+ optional `references/`, `scripts/`) — triggered workflows.
- `agents/*.md` — persona definitions.
- `commands/`, `mcp/` — placeholders today (only `.gitkeep`). Slash commands and MCP server definitions go here as they get added.
- `pending-adaptation/` — staging area for `portable/adapt` items pulled from the work repo. The README's contract: items live here only until they're rewired (Jira → GitHub Issues, TFS → GitHub PRs, Tipalti Slack → Discord/GitHub Discussions) and promoted to the live tree.

## Personal-flow conventions (what "adapted" means)

The live tree targets:

- **Issue tracker:** GitHub Issues (`gh` CLI)
- **Code host:** GitHub (`gh pr`)
- **Chat:** Discord + GitHub Discussions

When adapting a work item, rewrite Jira references to `gh issue`, TFS PR URLs to `gh pr`, and Slack channels to Discord channels or GitHub Discussions categories. Conventional Commits with `Closes #<n>` in the body (not in the scope) is the commit shape — see `skills/git-conventions/SKILL.md`.

## Editing rules/skills/agents

Every file in the live tree carries `tags: [audience/personal, portable/verbatim]` after adaptation. Keep that shape. Frontmatter is parsed line-by-line by `import.mjs` (`parseFrontmatter`) — keep it as `key: value` pairs, no nested YAML. Tags use the inline-array form `tags: [a, b]`.

## When the source repo has a tag mismatch

`import.mjs` warns on these and skips:

- `portable/none` with `audience/personal` — contradiction; the source item is paired-down for work-only use even though tagged personal.
- No `audience/` or `portable/` tag — item won't be classified.

These warnings need fixing in the work repo (`sync-group-tools/ai-tools`), not here.
