---
description: Every PR gets a type label and, when part of a larger initiative, a project label so reviewers and project boards can filter without reading every title.
tags: [audience/personal, portable/verbatim]
---

# PR labels

Every PR needs at least two labels applied at creation time.

## Type label

Mirrors the Conventional Commit type in the PR title:

| Commit type | Label |
|---|---|
| `feat` | `feat` |
| `fix` | `fix` |
| `chore` / `refactor` | `chore` |
| `infra` | `infra` |
| `test` | `test` |
| `docs` | `docs` |
| `perf` | `perf` |
| `security` | `security` |

Domain labels (`backend`, `frontend`, `dx`, `security`) can be added alongside the type label when they help filtering.

Size labels (`size:XS`, `size:S`, `size:M`, `size:L`) match the issue size estimate and go on PRs too.

## Project label

When the PR is part of a named initiative (multi-milestone refactor, quarterly project, product launch), apply a dedicated initiative label in addition to the type label. Name it after the initiative — e.g. `v3-refactor`, `auth-overhaul`, `q2-perf`. Use a distinct color (purple works well) so it stands out in the PR list.

Create the label once at initiative kick-off: `gh label create "v3-refactor" --color "7928CA" --description "Part of the v3 production refactor"`.

Apply it to every PR opened under that initiative, including fix PRs and chores. The label is the filter that lets you answer "show me all open PRs for this initiative" in one click.

## When to apply

Apply labels at `gh pr create` time — not after. Retroactively labelling a batch of PRs is tedious and error-prone. If using an agent to create PRs, include the `--label` flag in the `gh pr create` command.

## What not to do

- Don't use PR title prefixes as a substitute for labels — they don't filter.
- Don't create one label per milestone — one initiative label covers the whole initiative.
- Don't rely on assignees for initiative tracking — labels are queryable; assignees are not.
