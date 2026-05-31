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
| Skills | 18 | github-issues, github-context, gcloud-auth, chrome-debug, deploy-status, personal-projects |
| Agents | 6 | code-reviewer, senior-developer, solution-architect, qa-automation |
| MCP servers | 1 | chrome-devtools (`.mcp.json`) |
| Bin helpers | 2 | `project-key`, `project-cfg` |

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
bin/                shell helpers installed to ~/bin (project-key, project-cfg)
pending-adaptation/ staging area for items pulled from the work repo
CLAUDE.md           compiled plugin context (generated from rules/)
.claude-plugin/     plugin manifest (plugin.json)
.mcp.json           MCP servers shipped by the plugin
```

## Per-project context — `~/.claude-personal/settings.local.json`

Several skills (`personal-projects`, `github-context`, `gcloud-auth`, `chrome-debug`, `deploy-status`) share a project registry under the `projects` key. One entry per project, keyed by short slug:

```jsonc
{
  "projects": {
    "<key>": {
      "match":       ["<repo-basename-glob>", ...],
      "displayName": "Human-readable name",
      "gcloud":      { "projectId", "account", "region", "zone", "billingAccount", "orgId" },
      "github":      { "owner", "repo", "nameWithOwner", "defaultBranch", "developmentBranch",
                       "authAccount", "authHost", "protectedBranches", "prTargetBranch" },
      "chrome":      { "profile", "wrapper", "accountEmail" },
      "app":         { "localUrl", "stagingUrl", "prodUrl", "healthPath", "healthCheck" },
      "deploy":      { "platform", "prod": {...}, "staging": {...} },
      "supabase":    { "projectRef", "url", "jwksUrl", "anonKey", "secrets": {...} }
    }
  }
}
```

- **Writer:** `personal-projects` skill — add, list, show, validate, update.
- **Readers:** the rest. Resolution goes through two shell helpers in `bin/` (installed to `~/bin/`):
  - `project-key` — cwd basename → matching key (exact, then `match[]` globs).
  - `project-cfg <key> <topic> [<field>…]` — read any value (scalars raw, arrays space-joined, objects pretty JSON).

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
