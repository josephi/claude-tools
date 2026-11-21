---
description: At the start of any task, check for a matching bench skill or agent before falling back to generic execution. Prefer the specialized tool; use ad-hoc behavior only after concluding none fits, and say why.
tags: [audience/personal, portable/adapt]
---

# bench tools first

The bench plugin ships task-specific skills and agents, and their names and descriptions are in context every turn. So the question is never awareness — only choice. Default to the specialized tool.

The `route` hook already nudges toward the right tool when a prompt matches its table, but the table is deliberately narrow: it only fires on high-confidence patterns, and caps at two routes per prompt. This rule covers everything the table does not.

## At the start of every task

1. Match the task against the available bench skills and agents — read their `description` / TRIGGER lines, not just their names.
2. If one fits, use it: invoke the skill or delegate to the agent. Don't hand-roll what a tool already does.
3. Fall back to generic execution only after concluding no bench tool fits — and when you do, say so in one line (e.g. "no skill covers X, doing it directly").

## Expected routing

- PR review → `code-reviewer` agent (see `pr-review-via-agent`), never an ad-hoc chat review.
- Starting an issue → `task-start` before any code change.
- Implementing a non-trivial issue, feature or refactor → `implement-flow` (the session coordinates architect, scrutinizer, tester, developer and reviewer; it does not code itself).
- GitHub Issue creation / breakdown → `scrum-master` agent, or `business-analyst` from a PRD.
- Writing tests → `qa-automation`, following `testing-conventions`.
- Backend implementation / refactor → `senior-developer`.
- System design, service boundaries, schema and caching → `solution-architect`.
- A mapping/lookup/parse that "has surely been done before" → apply `prior-art-first`.
- Which repo / branch / gh account am I on → `github-context`.
- Is staging up, what commit is live → `deploy-status`; if gcloud auth fails, `gcloud-auth`.
- Anything needing a project's config → the `projects.<key>` registry, via `personal-projects`.

The list is illustrative, not exhaustive — scan what's actually installed each time, since the plugin evolves.

## What this is not

- Not a mandate to force-fit a skill onto an unrelated task. If nothing matches, generic execution is the correct outcome — just reach it as a conclusion, not a default.
- Not a mid-task override. This governs the initial tool choice; once inside a skill or agent, follow that tool's own steps.
