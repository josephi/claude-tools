---
name: scrum-master-playbook
description: Extended playbook for the scrum-master agent — per-repo overrides for labels and milestones, search recipes, and examples of repo-specific extensions. TRIGGER when extending the scrum-master agent for a specific repo, or when the base scrum-master agent refers to this playbook. SKIP for routine issue creation — the base scrum-master agent itself has enough.
model: opus
tags: [audience/personal, portable/verbatim]
---

# Scrum master playbook

Material that supports the `scrum-master` agent but doesn't need to load every time the agent runs.

## Extending the agent (per-repo)

The base `scrum-master` agent is repo-agnostic. Individual repos extend it by adding `.claude/agents/scrum-master.md` (or the equivalent for your IDE) that inherits the global behavior and adds local context.

### How inheritance works

1. **Global agent** (`~/.claude/agents/scrum-master.md`): universal workflow — preflight, `gh` usage, common operations.
2. **Repo agent** (`.claude/agents/scrum-master.md` in the repo): repo-specific overrides — label conventions, milestone cadence, Projects v2 board IDs, default assignees.

Repo-level agents should reference the global agent's behavior and only define what's different.

### Repo-level template

```markdown
---
name: scrum-master
description: Scrum Master for [RepoName]. Extends the global scrum-master agent with repo-specific GitHub configuration.
model: opus
---

# Scrum Master — [RepoName]

Extends the global scrum-master agent. Follow all global workflow steps and apply these repo-specific overrides.

## Repo context
- Default repo: `<owner>/<name>`
- Default branch: `main`
- Default assignee on new bugs: `@me`

## Label conventions
| Label | Meaning |
|---|---|
| `bug` | Confirmed bug |
| `feat` | New feature |
| `chore` | Maintenance |
| `good first issue` | Easy onboarding |
| `blocked` | Waiting on an external dep |
| `in review` | PR open for this issue |

## Milestones
Sprint-style milestones, two-week cadence. Current milestone: `2026-Q2-sprint-3`.

## Projects v2 board
- Project number: `4` (under owner `<me>`)
- Status field options: `Triage`, `In progress`, `In review`, `Done`

## Extra search recipes
- This sprint, my open issues:
  `gh issue list --milestone "2026-Q2-sprint-3" --assignee @me --state open`
- Stale bugs (>30d no activity):
  `gh issue list --label bug --state open --search "updated:<2026-04-20"`
```

### What belongs in the repo agent

- Label conventions and milestone cadence specific to the repo
- Projects v2 board number, field IDs, option IDs
- Repo-specific workflow rules (e.g. "all bugs must include a repro commit")
- Frequently-used search filters

### What does NOT belong in the repo agent

- `gh` invocation patterns — defined in the global agent + `github-issues` skill
- Preflight checklist — defined globally
- General Conventional-Commits / branch-naming rules — in `git-conventions`

## Standard search recipes

| Need | Command |
|---|---|
| My open issues across all my repos | `gh search issues "assignee:@me state:open"` |
| Stale issues in this repo | `gh issue list --search "no:assignee state:open updated:<$(date -v-30d +%Y-%m-%d)"` |
| Issues blocked on external work | `gh issue list --label blocked --state open` |
| Issues with open PRs | `gh issue list --search "linked:pr state:open"` |
| Issues missing labels | `gh issue list --search "no:label state:open"` |

## Writing repo-specific labels

When introducing a new label, prefer the standard set (`bug`, `feat`, `chore`, `docs`, `refactor`, `perf`, `test`, `ci`). Add scope-suffix variants only when the repo has clear domains:

- `bug:auth`, `bug:queue` — fine if the repo has stable subsystems.
- `priority:p1`, `priority:p2` — only if you actually triage by priority.

Avoid synonym labels (`enhancement` + `feat`, `wontfix` + `not planned`). Pick one and stick to it.

## Triage workflow

For a fresh issue with no label or assignee:

1. Read the body. If it's a bug, look for repro steps and expected/actual. If missing, comment asking for them; label `needs-info`.
2. If it's a feature, look for acceptance criteria. If missing, comment with a draft AC list and ask the reporter to confirm.
3. Apply the type label (`bug`, `feat`, etc.).
4. If the repo has milestones, add to the current sprint or the next backlog milestone — never both.
5. Assign if it's yours; otherwise leave unassigned for self-claim.

## What not to do

- Don't auto-close issues that look like duplicates without commenting which issue supersedes them.
- Don't add labels the repo hasn't defined. List labels first: `gh label list`.
- Don't use Projects v2 status if the repo uses milestones for the same purpose. Pick one source of truth per repo.
