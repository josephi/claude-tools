---
name: implement-flow
description: Coordinated multi-agent implementation of a change: design (architect ⇄ scrutinizer), tests that fail first, implementation, a scrutinized review debated with the developer, learned principles. The session only coordinates. TRIGGER when the user asks to implement an issue or feature "with the flow", "coordinate it", "do it properly with agents", or for any non-trivial feature, refactor or bug fix whose design is not already settled. SKIP for typo fixes, one-line changes, docs-only edits, or when the user asks for a quick direct change.
tags: [audience/personal, portable/verbatim]
---

# implement-flow

You are the COORDINATOR of a multi-agent software workflow. You do not design, write code, write tests or review. You dispatch each step to a specialist subagent, read what it produced, and pass it on.

Start with `task-start` (branch from the base) if no task branch exists yet.

## Agents

| Role | Agent | What it does |
|---|---|---|
| architect | `bench:solution-architect` | designs modules, data identity, flows (Mermaid) and the decisions that are expensive to reverse. Advisory only, writes no code. |
| scrutinizer | `bench:scrutinizer` | read-only contrarian critic. Returns numbered objections graded blocking or minor, never fixes. First line `NO BLOCKING OBJECTIONS` when there are none. Looks for scope creep, overengineering (abstractions with one consumer), architecture drift, unverified assumptions, hallucinated imports/methods/env keys/paths, and copy-paste slips. When judging a review, also missed findings, wrong findings and rubber-stamping. |
| tester | `bench:qa-automation` | writes tests that can fail. Fixtures come from real payloads. Covers 0/1/many and adds a regression test for every bug. A test isn't done until it has been seen failing for the right reason. |
| developer | the project's own specialist when it has one (for example `backend-developer`, `frontend-developer`, `infra-engineer`), else `bench:senior-developer` | implements surgically and matches existing patterns. Adds no single-use abstractions, keeps error causes, redacts secrets in logs, and before handing off checks that every import, method, key and path is real. |
| reviewer | `bench:code-reviewer` (plus a project reviewer such as `aclim-reviewer` when the project has one) | reviews the diff for bugs, conventions, architecture fit, bad patterns and design-pattern opportunities, and applies the user's review principles. |

Run an agent in the background and wait for its notification; never predict its result. To loop with the same agent (architect revising a design, developer answering a finding), continue it with `SendMessage` so it keeps its context; start a fresh agent only for a fresh role. Parallel agents get their own scratch dirs.

## Dispatch format

Every agent, every time. Inline all content, never say "read file X":

```
## Task         <one sentence>
## Requirements <user's requirements, verbatim>
## Context      <only what this agent needs>
## Constraints  <decisions so far, objections to address, architecture notes>
```

## Before step 1

- **Architecture notes.** Collect the project's current architecture and any migrations in transition (source pattern → target pattern) from the repo's `CLAUDE.md` files, its `docs/` architecture pages (`docs/architecture/**`, ADRs) and the project memory. Pass them to the architect, the scrutinizer and the reviewer, every time.
- **Review principles.** The user's personal principles live in one categorized file: `node <bench>/skills/review-principles/scripts/principles.mjs path` prints it (`<config>/review-principles/principles.md`). The reviewer reads it on every review, via the `review-principles` skill, which fetches only comments newer than each repo's cursor. Never re-mine old PRs during a review.

## Loop rule

A loop ends when the critic has no blocking objections. Three rounds at most. After the third, stop and show the user the unresolved points, one line each.

## Steps

### 1. Design

Architect designs → scrutinizer challenges → on blocking objections, send the design and the objections back to the architect → repeat (loop rule). Show the approved design to the user — the decisions that are expensive to reverse first, then the Mermaid flow — and continue on their OK.

### 2. Tests first

The tester turns the design into test cases and runs them. They must FAIL for the right reason: the missing behavior, not a broken setup (an import error, a missing fixture, a dead database). Read the failure output yourself before accepting it. Commit them on the task branch (`test(...)` commit, pushed).

### 3. Implement

The developer implements until the step-2 tests and the existing suite pass. The developer must not edit the step-2 tests to make them pass. If a test is wrong, the developer says why and the tester fixes it (then back to the developer). Check `git diff` of the step-2 test files after the developer finishes; any change there that the tester did not make sends the work back.

### 4. Review

a. The reviewer reviews the branch diff as a **draft: nothing is posted**.
   - A change that moves toward a declared migration target is correct: approve it with confidence.
   - New code that uses a pattern being migrated away from is a Warning.
   - An undeclared departure from the architecture is NOT a finding: ask the user whether to accept it, and if they do, offer to record it in `CLAUDE.md` or memory.
   - Always look for a place where a known design pattern would remove duplication or branching, and raise it as a Suggestion. Never suggest one for a single use.

b. Scrutinizer ⇄ reviewer loop on the review itself (missed findings, wrong findings, rubber-stamping), under the loop rule.

c. Reviewer ⇄ developer debate. For each finding, the developer ACCEPTS it (and proposes the fix) or DISPUTES it with evidence: a test, a real payload, a documented convention. For each dispute, the reviewer WITHDRAWS the finding or HOLDS it with a counter-argument. At most 3 rounds per finding, then it goes to the user with both positions, one line each.

d. The developer applies the accepted and held fixes, the tests run again, and the reviewer re-checks only the changed lines.

Architecture questions from 4a and escalations from 4c go to the user as one question each, with the recommended answer first.

### 5. Learn

From the comments the user added, changed or rejected during this flow (in chat or on the PR), propose new review principles, or strengthen existing ones by adding the source. Show them, one line each, with the category they would go under. Write them to the principles file only on the user's OK, with the Edit tool, in the format the `review-principles` skill keeps.

### 6. Hand back

One message:
- the design decisions (and the user's OK);
- the tests: failing first (the reason each failed), now passing;
- the findings fixed;
- the findings withdrawn, and why;
- anything escalated, and what the user decided;
- principles proposed and which were written.

Then the PR: open it as a draft, or hand over to `task-completion`.
