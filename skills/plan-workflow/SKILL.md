---
name: plan-workflow
description: Structured planning for non-trivial implementation tasks. TRIGGER when the user asks for a plan, says "plan this", mentions designing an approach, or when a task is large enough that starting without alignment risks wasted work (multi-file refactors, new features, architectural decisions). SKIP for typo fixes, single-line edits, or tasks with explicit step-by-step instructions from the user.
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

## Phase 3 — Review

- Read the critical files the Plan agents cited. Confirm they exist and behave as described.
- Use `AskUserQuestion` to clarify requirements or choose between approaches. Never ask "is the plan okay?" — that's `ExitPlanMode`'s job.

## Phase 4 — Final plan

Write the plan to the plan file (the only file allowed to edit in plan mode). Structure:

- **Context** — why this change is being made, what prompted it, intended outcome
- **Approach** — only the recommended one, not alternatives
- **Critical files** — paths of files to modify
- **Reusable existing code** — functions and utilities to leverage, with paths
- **Verification** — how to test end-to-end

Keep the plan scannable. If it's over one screen, it's probably too detailed for planning.

## Phase 5 — Exit

Call `ExitPlanMode` when the plan file is ready. The turn ends with either `AskUserQuestion` (clarification) or `ExitPlanMode` (approval request) — no text prompts asking "does this look good?"

## Post-approval

Once the user approves, start executing immediately. Track tasks with `TaskCreate`. Follow the `execution-style` rule: act, don't re-deliberate.
