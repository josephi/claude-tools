---
name: plan-workflow
description: Structured planning for non-trivial implementation tasks. TRIGGER when the user asks for a plan, says "plan this", mentions designing an approach, or when a task is large enough that starting without alignment risks wasted work (multi-file refactors, new features, architectural decisions). SKIP for typo fixes, single-line edits, or tasks with explicit step-by-step instructions from the user, and when the user wants the change implemented end to end with agents (that is implement-flow).
model: opus
tags: [audience/personal, portable/verbatim]
---

# Plan workflow

Structured planning before non-trivial implementation. Optimizes for alignment-first execution: explore → design → user approval → act.

## Phase 1 — Initial understanding

- Use Explore subagents (up to 3 in parallel) for codebase research. Quality over quantity — most tasks need one.
- Target: find existing functions, patterns, and utilities that can be reused. Don't propose new code when existing code fits.
- Give each subagent a narrow focus: one searches for existing implementations, another explores related components, a third investigates testing patterns. Do not duplicate their searches yourself.

## Phase 2 — Design

- Launch a Plan subagent with Phase 1 findings as context (file paths, traced code paths, constraints).
- For complex tasks, launch up to 3 Plan agents with different perspectives: simplicity vs. performance vs. maintainability for features; root cause vs. workaround vs. prevention for bug fixes.

## Phase 3 — Coverage review (architect × QA × business-analyst)

**Scale to the risk first.** For a small, well-understood change, a single combined pass (or skipping straight to Phase 4) is fine — don't spin up three specialist agents by default. Reserve the full three-lens pass for genuinely multi-file, shared-logic, or architecturally-significant work.

Before the plan is finalized, run a coverage pass so the result isn't just *an* approach but a *fully-covered* one. Launch three specialist agents in parallel on the draft design, each with a distinct lens:

- **business-analyst** — are the acceptance criteria complete and testable? Does the approach satisfy every requirement, including the implicit ones? What is explicitly out of scope?
- **qa-automation** — what is the test plan? Enumerate the edge cases (0 / 1 / many, duplicates, nulls, ordering, failure paths) and the regression tests that must fail on the old behavior. Flag anything in the design that can't be tested as written.
- **solution-architect** — does the design hold up at the data-identity and boundary level (composite keys, cache scope/miss policy, concurrency, blast radius)? Which edge cases does the architecture itself introduce?

Then **reconcile** their findings into one agreed set of acceptance criteria and a test / edge-case list. Where they conflict — e.g. the BA wants a criterion QA says is untestable as designed, or the architect's identity model changes what "done" means — surface the tradeoff with `AskUserQuestion` rather than silently picking one. Gaps they find become changes to the design, not afterthoughts.

Keep it to one focused round: the goal is closing coverage gaps before approval, not a design-by-committee loop.

## Phase 4 — Review

- Read the critical files the Plan agents cited. Confirm they exist and behave as described.
- Use `AskUserQuestion` to clarify requirements or choose between approaches. Never ask "is the plan okay?" — that's `ExitPlanMode`'s job.
- Reserve `AskUserQuestion` for genuine tradeoffs and unreconciled specialist conflicts. For minor, reversible design choices, pick a reasonable option, note it in the plan, and move on — don't gate the plan on trivia.

## Phase 5 — Final plan

Write the plan to the plan file (the only file allowed to edit in plan mode). Structure:

- **Context** — why this change is being made, what prompted it, intended outcome
- **Acceptance criteria** — the agreed, testable criteria from Phase 3 (what "done" means)
- **Approach** — only the recommended one, not alternatives
- **Critical files** — paths of files to modify
- **Reusable existing code** — functions and utilities to leverage, with paths
- **Test plan & edge cases** — the cases to cover (0 / 1 / many, failure paths) and the regression tests, from Phase 3
- **Verification** — how to test end-to-end

Keep the plan scannable. If it's over one screen, it's probably too detailed for planning.

## Phase 6 — Exit

Call `ExitPlanMode` when the plan file is ready. The turn ends with either `AskUserQuestion` (clarification) or `ExitPlanMode` (approval request) — no text prompts asking "does this look good?"

## Post-approval

Once the user approves, start executing immediately. Track tasks with `TaskCreate`. Follow the `execution-style` rule: act, don't re-deliberate.

**Record the plan on the GitHub Issue.** Post the approved approach plus the agreed acceptance criteria and test/edge-case list (from Phase 3) as a comment on the issue the work is for, so the plan lives with the issue and not just the conversation. Use the `github-issues` skill (`gh issue comment`) to post it.

**Delegate to the matching specialist agent** so the right discipline is applied (and these agents actually get used):

- Implementation / refactoring → **senior-developer** (validates assumptions against real data, identity-vs-lookup keys, 0/1/many, generalize the bug class).
- Test writing → **qa-automation** (fixtures from real payloads, 0/1/many, a regression test that fails on the old code, minimal mocking).
- System design, modularization, data-identity / caching decisions → **solution-architect**.
- Pre-PR self-review and the formal PR review → **code-reviewer**.

For a small, single-file change you can implement inline; for anything multi-file or touching shared logic, delegate so the specialist checklist is enforced.
