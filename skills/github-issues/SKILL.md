---
name: github-issues
description: Handle GitHub Issues for personal projects — create, query, comment, label, link, close. Uses the gh CLI; falls back to REST when gh doesn't cover an op.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# GitHub Issues

Workflows for creating and querying GitHub Issues. The default transport is the `gh` CLI; switch to REST (also via `gh api`) only when `gh` doesn't expose the operation.

## Preflight

Run before any issue write:

| # | Check | How | On failure |
|---|-------|-----|------------|
| 1 | `gh` installed | `gh --version` | install `gh` and `gh auth login` |
| 2 | Authenticated | `gh auth status` | `gh auth login` (use HTTPS, web flow) |
| 3 | Repo resolves | `gh repo view --json nameWithOwner` | `cd` to the repo or pass `--repo owner/name` |
| 4 | Target issue exists (when updating) | `gh issue view <num>` | report `issue_not_found` |

If the user provides only an issue number (no repo), default to the current repo. If they provide a full URL, parse `owner/repo#number` out of it.

## Core operations (gh CLI)

| Operation | Command |
|---|---|
| Create issue | `gh issue create --title "..." --body "..." --label bug --assignee @me` |
| View issue | `gh issue view <num> --json number,title,body,state,labels,assignees,comments` |
| List issues | `gh issue list --search "label:bug state:open"` |
| Add comment | `gh issue comment <num> --body "..."` |
| Edit issue | `gh issue edit <num> --add-label feature --remove-label triage` |
| Close issue | `gh issue close <num> --reason completed` (or `not planned`) |
| Reopen | `gh issue reopen <num>` |
| Link to PR | Put `Closes #<num>` in the PR body; GitHub links and auto-closes on merge |
| Search across repos | `gh search issues "user:<me> is:open" --limit 30` |

Pass bodies via heredoc when they span multiple lines:

```sh
gh issue create --title "feat: retry strategy" --body "$(cat <<'EOF'
## Context
...

## Acceptance criteria
- [ ] ...
EOF
)"
```

## REST fallback (`gh api`)

When gh doesn't cover an op (custom field on Projects v2, fine-grained timeline events, GraphQL-only fields):

```sh
gh api -X POST /repos/<owner>/<repo>/issues/<num>/labels -f labels[]=bug
gh api graphql -f query='query { repository(owner:"...", name:"...") { issue(number:42) { projectItems(first:5) { nodes { id } } } } }'
```

`gh api` reuses `gh auth` — no extra token wiring.

## Writing issues

- **Title**: imperative, short, no `[TICKET-id]` brackets. Prefix with Conventional-Commits type when scope is clear: `feat: add retry strategy`, `bug: null metadata on upload`.
- **Body**: GitHub Flavored Markdown. Open with one-sentence summary, then sections.
- **Bugs**: `## Steps to reproduce`, `## Expected`, `## Actual`. Include version/commit when applicable.
- **Features**: `## Why`, `## Acceptance criteria` (checkboxes). Skip "As a user, I would like to…" — write the problem and the test.
- **Labels**: pick from existing labels. Create new ones sparingly. Standard set: `bug`, `feat`, `chore`, `docs`, `refactor`, `good first issue`, `help wanted`, `blocked`.

Run all issue prose through the `deslop` skill before posting.

## Linking issues

- **PR closes an issue**: `Closes #<num>` in PR body (auto-closes on merge).
- **Issue depends on another**: free-form `Blocked by #<num>` in description; or use a tracking issue with checkboxes.
- **Epic / parent**: track as a tracking issue with a checklist of child issues, or use Projects v2 with a parent field.

See [references/api_examples.md](references/api_examples.md) for worked `gh` and `gh api` snippets.

## Search recipes

- **My open issues across all repos**: `gh search issues "assignee:@me state:open"`
- **Issues by label**: `gh issue list --label bug --state open`
- **Stale issues**: `gh issue list --search "no:assignee state:open updated:<2026-02-01"`
- **Open PRs blocking issues**: `gh pr list --search "linked:issue state:open"`

## What not to do

- Don't hand-write `Authorization: token …` headers. `gh` already handles auth.
- Don't paste secrets, tokens, or PII into issue bodies (or anywhere).
- Don't create labels on the fly during automation — pick from existing labels or ask first.
