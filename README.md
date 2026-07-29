# bench

Personal Claude Code plugin — rules, skills, agents, and commands that reflect how I work as a developer / architect / team lead, independent of any employer.

## Install

Add this plugin to your Claude Code personal profile:

```
/plugin marketplace add josephi/claude-tools
/plugin install bench@josephi-bench
```

Then run `/bench:setup` once. `/plugin install` only lands the files — setup writes the rules block into `CLAUDE.md`, collects the worktree prune base, and offers the statusline and the base-branch commit backstop. A `SessionStart` hook nags until it has run, and re-fires after an update.

To register the marketplace by hand instead, add to `<config-dir>/plugins/known_marketplaces.json`:

```json
{
  "josephi-bench": {
    "source": { "source": "github", "repo": "josephi/claude-tools" }
  }
}
```

`<config-dir>` is `$CLAUDE_CONFIG_DIR` when set, else `~/.claude`. This profile normally runs with `CLAUDE_CONFIG_DIR=~/.claude-personal`.

## What's included

| Type | Count | Examples |
|---|---|---|
| Rules | 12 | execution-style, git-per-task, pr-labels, prior-art-first, code-comments |
| Skills | 28 | task-start, task-completion, github-issues, deploy-status, gcp-logging, personal-projects |
| Agents | 6 | code-reviewer, senior-developer, solution-architect, qa-automation |
| Hooks | 6 | guard, route, nudge, session-identity, check-init, statusline |
| MCP servers | 1 | chrome-devtools (`.mcp.json`) |
| Bin helpers | 2 | `project-key`, `project-cfg` |

### Hooks

The plugin enforces its own conventions rather than asking the model to remember them.

| Hook | Event | What it does |
|---|---|---|
| `guard` | `PreToolUse`, `SessionStart(compact)` | Denies edits while HEAD is on a base branch, and reads `Bash` commands for write targets so a redirect into a base-branch checkout is caught too. Re-asserts the non-negotiable rules after a compaction. |
| `route` | `UserPromptSubmit` | Matches the prompt against `hooks/routing.json` and names the skill or agent that should handle it. Caps at two routes per prompt. |
| `nudge` | `PostToolUse` | Attaches a convention reminder when it becomes relevant — editing a test file, adding a log call, making a commit. |
| `session-identity` | `SessionStart`, `PostToolUse(Bash)` | Names the session and terminal tab from the branch; warns when you are sitting on a base branch. |
| `check-init` | `SessionStart` | Asks for `setup` after an install or update, and renders the changelog for the range. |
| `statusline` | (via `settings.local.json`) | Shows issue, branch, base and push state — and whether hooks are live at all, which no hook can report about itself. |

The shell-write half of `guard` is a deterrent, not a gate: reading a shell line is not a solved problem. The gate is the optional `pre-commit` backstop that `setup` offers per repo, which needs no shell parsing because git already knows the branch by then.

Escape hatch for both: `BENCH_ALLOW_BASE_EDITS=1`.

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
hooks/              hook scripts + hooks.json wiring, routing.json, nudges.json
hooks/lib/          shared helpers (issue-ref, task-context, shell parsing)
scripts/            test runner, linter, trigger eval
claude/settings.json  recommended permissions setup offers to merge
commands/           slash command prompts (placeholder)
bin/                shell helpers installed to ~/bin (project-key, project-cfg)
pending-adaptation/ staging area for items pulled from the work repo
CLAUDE.md           compiled plugin context (generated from rules/)
CHANGELOG.md        read by check-init to report what changed after an update
install-questions.json  prompts setup asks on first run
.claude-plugin/     plugin + marketplace manifests
.mcp.json           MCP servers shipped by the plugin
```

## Development

```bash
npm test     # every hooks/ and skills/*/scripts/ suite (16 suites)
npm run lint # frontmatter, description length, changelog completeness
npm run build  # regenerate CLAUDE.md from rules/
```

`npm run lint` fails when the version in `plugin.json` has no `## [x.y.z]` section in `CHANGELOG.md`, because the post-update report would then show nothing.

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
- `skills/slack-formatting` → `rules/chat-formatting.md` (upstream promoted the rule to a skill; here it stays a rule)
- `skills/jira` → `skills/github-issues`
- `skills/syncapp-git-conventions` → `skills/git-conventions`
- `skills/slack-nontechnical` → `skills/chat-nontechnical`
- `hooks/lib/jira-key.mjs` → `hooks/lib/issue-ref.mjs` (Jira keys → GitHub issue refs)
- `skills/coralogix-dashboards` → `skills/gcp-logging`
- `skills/prometheus` → `skills/gcp-monitoring`
- `skills/percy` → `skills/visual-testing`

### Locally adapted verbatim items (import.mjs `PROTECTED_LOCAL`)

Verbatim upstream items that carry personal-flow edits here. The importer never overwrites them; it warns when upstream drifts so the change can be re-merged by hand.

- `rules/pr-review-via-agent.md` — keeps the personal "Standalone vs integration" section
- `rules/git-per-task.md` — upstream's enforcement prose is specific to the work plugin
- `skills/plan-workflow` — Jira handoff paragraph rewritten for GitHub Issues
- `skills/deslop` — trigger list names Discord and GitHub Issues
- `skills/worktree-manager` — uses `${CLAUDE_SKILL_DIR}` rather than a hardcoded config dir

### Watched directories (import.mjs `WATCHED_DIRS`)

`hooks/` and `scripts/` carry no frontmatter, so the tag routing above cannot see them — which is how the entire hook system went unnoticed for months after it landed upstream. Every file in them is a hand adaptation, so the importer never copies; it records a hash of the upstream tree and tells you when it moves. Bump the hash in `WATCHED_DIRS` once you have reviewed the diff.
