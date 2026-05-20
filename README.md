# claude-tools

Personal Claude Code plugin — rules, skills, agents, and commands that reflect how I work as a developer / architect / team lead, independent of any employer.

## Install

Add this plugin to your Claude Code personal profile:

```bash
# Register the marketplace (one-time)
# then install from the Claude Code UI or CLI: /plugins install claude-tools@josephi-claude-tools
```

Or add directly to `~/.claude-personal/plugins/known_marketplaces.json`:

```json
{
  "josephi-claude-tools": {
    "source": {
      "source": "github",
      "repo": "josephi/claude-tools"
    }
  }
}
```

## What's included

| Type | Count | Examples |
|---|---|---|
| Rules | 10 | execution-style, git-per-task, log-standards, prior-art-first |
| Skills | 13 | github-issues, git-conventions, deslop, review-javascript, plan-workflow |
| Agents | 6 | code-reviewer, senior-developer, solution-architect, qa-automation |

### Personal-flow conventions

| Concern | Tool |
|---|---|
| Issue tracker | GitHub Issues (`gh issue`) |
| Code host | GitHub (`gh pr`) |
| Chat | Discord + GitHub Discussions |

Commit shape: Conventional Commits with `Closes #<n>` in the body.

---

## Repo structure

```
rules/              source rule files (frontmatter + body)
skills/<name>/      SKILL.md + optional references/ and scripts/
agents/             persona .md files
commands/           slash command prompts (placeholder)
mcp/                MCP server definitions (placeholder)
pending-adaptation/ staging area for items pulled from the work repo
CLAUDE.md           compiled plugin context (generated from rules/)
.claude-plugin/     plugin manifest (plugin.json)
```

## Maintaining rules

Rules live in `rules/*.md`. Each file has YAML frontmatter then a body. After editing, regenerate `CLAUDE.md`:

```bash
node generate-claude-md.mjs
```

## Pulling from the work repo

Items are pulled from `sync-group-tools/ai-tools` when their `audience` frontmatter is `personal` or `both`.

```bash
node import.mjs                          # pull personal-classified items
node import.mjs --dry-run                # show what would happen, no writes
node import.mjs --source <path>          # override source repo
node import.mjs --force                  # refresh adapt items already in pending-adaptation/
```

Default source: `$AI_TOOLS_WORK` or `~/repos/.ai-tools`.
Actual location on this machine: `~/repos/sync-group-tools/ai-tools/`.

### Routing

| Source tag | Behavior |
|---|---|
| `audience/work` | Skipped |
| `audience/personal` or `audience/both` + `portable/verbatim` | Copied to live tree; re-import overwrites on upstream drift |
| `audience/personal` or `audience/both` + `portable/adapt` | Dropped into `pending-adaptation/<kind>/<name>` on first import; manually rewire integrations then move to live tree |
| `internal: true` | Skipped |

### Known renames (import.mjs `RENAMED_ADAPTATIONS`)

- `rules/slack-formatting.md` → `rules/chat-formatting.md`
- `skills/jira` → `skills/github-issues`
- `skills/syncapp-git-conventions` → `skills/git-conventions`
