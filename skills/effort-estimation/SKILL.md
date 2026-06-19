---
name: effort-estimation
description: Calibrate and estimate dev effort from real GitHub Issue cycle times. Records cycle/lead times and PR-review signals when an issue closes, and uses the accumulated history to ground estimates for new issues. TRIGGER when closing out a GitHub Issue (after merge), when estimating a new issue ("how long will this take", size labels, day estimates, T-shirt sizing), or when breaking an epic into estimated issues. SKIP for non-GitHub work or when the user gives an explicit estimate to use as-is.
model: haiku
tags: [audience/personal, portable/adapt]
---

# Effort estimation

All tasks run through Claude Code, so historical cycle times are the best predictor of future ones. This skill maintains a calibration history from GitHub Issues and applies it.

The CLI (no dependencies, auth from the `gh` CLI):

```bash
node <skill-dir>/scripts/effort.mjs record <issue-number...> [--repo owner/name]
node <skill-dir>/scripts/effort.mjs estimate [--type T] [--size S]
node <skill-dir>/scripts/effort.mjs backfill [--days N] [--assignee @me] [--repo owner/name]
```

Repo resolution: `--repo owner/name`, else `EFFORT_GH_REPO`, else the repo in the current directory. History lives in `~/.claude-personal/data/effort-estimation/history.jsonl` (machine-local, upserted by `<repo>#<number>` — re-recording is safe). Weekends (Sat+Sun) are excluded from all durations; override with `EFFORT_WEEKEND` (JS `getDay` numbers, e.g. `"5,6"` for Fri+Sat).

## 1. Record — at every task completion

When an issue is closed (the `task-completion` flow, after merge), run:

```bash
node <skill-dir>/scripts/effort.mjs record 42 --repo josephi/claude-tools
```

GitHub Issues have no Jira-style workflow states, so the script derives timing from the issue timeline and linked PRs:

- **cycleDays** — work start → closed. Work start is the earliest real signal: a start label applied (default `in-progress`, override with `EFFORT_START_LABEL`), first assignment, or the first linked PR opened. Falls back to created (so cycle == lead) when none exist. The chosen basis is printed and stored as `startBasis`.
- **leadDays** — created → closed.

It also enriches each record with **PR-review interaction signals** from `gh pr` for every PR linked to the issue (via timeline cross-references / `Closes #n`): PR count, review rounds, commit count (rework proxy), changes-requested review count (rejections), and publish→merge business days.

Do this for every closed issue, even tiny ones — small samples are what skew estimates.

## 2. Estimate — before committing a number

When estimating a new issue (size labels, day estimates, epic breakdowns, T-shirt sizing):

1. Run `estimate` filtered to the closest comparable slice (`--type feat`, `--size M`).
2. Anchor on the **median cycleDays** of the comparable slice; mention p75 as the risk band when the task has unknowns.
3. Factor in the PR-review interaction stats — review rounds and publish→merge wait are elapsed cost the implementation estimate alone misses; a task type that historically draws many review rounds deserves the p75, not the median.
4. Adjust for scope judgment (number of files, test surface, rollout/flag work) — the history is the prior, not the verdict.
5. State the basis in the issue: `~Xd (median of N comparable tasks)`.

With fewer than ~10 finished records, fall back to the standing prior for agent-executed tasks — **0.5d implementation + ~1d tests & code review per task** — and say the history is still thin.

## 3. Backfill — first use

If `estimate` reports no data, seed it once:

```bash
node <skill-dir>/scripts/effort.mjs backfill --repo josephi/claude-tools   # @me, closed last 120d
```

Pass `--days` to widen the window, `--assignee` to seed someone else's (or `--assignee ""` for all).

## Notes

- Durations count wall-clock business days between the timeline anchors, not focused work time — waiting in review is real elapsed cost and belongs in the estimate.
- Open issues are recorded for reference but excluded from `estimate` stats.
- `record` and `backfill` shell out to `gh`; make sure `gh auth status` is green for the repo's account first.

## Test

```bash
node <skill-dir>/scripts/test.mjs
```

Covers CLI parsing and the offline `estimate` path over a seeded fixture (no network).
