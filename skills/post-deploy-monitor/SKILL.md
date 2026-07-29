---
name: post-deploy-monitor
description: >-
  Monitor a production release deploy end to end for any project. Detects each service rolling out,
  runs per-service health checks against the project's observability stack (logs, APM/metrics, custom
  metrics, infra), announces progress and release notes to Discord / GitHub Discussions, watches for
  anomalies on a cadence and escalates only confirmed ones, and produces a post-deploy health /
  feature-impact report. TRIGGER when the user says a release is deploying or deployed, asks to monitor
  or watch a rollout, do a post-deploy check, or verify release health after a deploy. Pair with the
  `deploy-status` skill and the project's entry in the personal-projects config for the concrete service
  list, deploy-detection, tool query recipes, and channels. SKIP for local runs, one-off single-metric
  lookups, or pre-deploy work.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# Post-deploy monitor (generic)

A project-agnostic method for babysitting a release from deploy through steady state and reporting on it.
This is the **framework**; the project layer supplies the specifics (see "What the project layer must
provide"). For personal projects that layer is the `deploy-status` skill plus the project's entry in the
`personal-projects` config (`projects.<key>.deploy` in `~/.claude-personal/settings.local.json`). If
neither covers it, gather the specifics from the user or the repo's CI config first.

## What the project layer must provide

1. **Release identity** — release id + the merge/commit that defines it.
2. **Deployed services** — the list, and for each: how to detect its prod deploy (CI/CD build id, release
   pipeline, image tag, or cluster rollout) and how to read its live version.
3. **Observability recipes** — the concrete queries for logs, APM/traces, runtime + custom metrics, and
   infra, plus each tool's quirks.
4. **Announce channels** — the project's Discord channel (from `.ai-tools/discord.json` or the project
   config, per `chat-formatting`) and whether a GitHub Discussions post is expected — plus the
   **escalation owner** (who to DM on Discord).
5. **Baselines** — or how to establish them at deploy time.

## Procedure

1. **Establish the release.** Identify the release, the services in it, and each service's release build /
   artifact. Record current prod versions as the **baseline**. Reconcile the release notes against the
   *actual* change set (diff the commit range / merge parents) — notes routinely omit changes merged after
   they were drafted; surface any missing ones and whether they carry runtime impact.
2. **Detect each service's prod deploy.** Track the **specific** release build/artifact per service — not
   "the latest build," which is often the previous release. When a build reaches its terminal success
   state, confirm the new version is actually live (image tag / rollout status), don't assume. Re-queue a
   build that fails on a transient/infra step (registry push, flaky infra) when build+tests passed.
3. **Health sweep per service, as each lands.** Compare a post-deploy window to the pre-deploy baseline
   across five dimensions:
   - **Logs** — error/critical rate vs baseline, and any *new* signature (a rate bump of pre-existing
     errors during a rolling restart is usually noise).
   - **APM / traces** — error-span rate, latency (p50/p95/p99), throughput.
   - **Runtime** — event-loop lag, CPU, GC, heap; check a multi-hour **heap trend** for leaks.
   - **Throughput / duration** — work completed per unit time, and job/request duration (overall + per
     type).
   - **Infra** — pod/instance restarts, OOM, crashloops, and **version drift / unexpected rollback**.
4. **Announce.** Post a per-service update as each goes live; post the release notes once all services are
   live. Use the `chat-formatting` skill for the message shape and channel targeting.
5. **Watch loop.** Run a light check on a short interval plus a deep, multi-perspective sweep on a longer
   one, until the user's end time. See "Loop mechanics" below.
6. **Report.** Produce a health / feature-impact artifact: the five dimensions + a change-by-change impact
   table. Because observability backends retain history, you can build it **retrospectively** over the
   whole window even if live checks had gaps.

**Boundary.** Produce the health/impact report and escalate confirmed problems; do not attempt
remediation, rollback, or config changes unless the user asks.

## Escalation

DM the owner on Discord **only for a confirmed problem**; routine "green" stays in the channel. DM-worthy:
rollback or an unexpected build in prod, instances not ready / crashlooping / OOM, a *new* error signature,
a sustained error-rate or latency spike, a rising heap (leak), a per-type failure spike, or a build that
failed and will not self-recover. Before escalating, **adversarially verify** the anomaly (re-query,
default to "not real / restart-noise / pre-existing") — ideally with independent checks — so a
plausible-but-wrong signal never pages anyone.

This conservative gate governs **paging/DM only**. The **report is the opposite — coverage-first**: it
must list *every* observation across all monitored dimensions with an explicit confidence and severity,
including sub-escalation and pre-existing signals. Filter for what to DM, never for what to record.

## Loop mechanics

- **Cadence:** a cheap snapshot (versions, infra, key custom metrics) every ~15 min, and a deep sweep
  (full multi-dimension, per service, with anomaly verification) every ~1–3 h. Escalate a deep sweep early
  if a cheap tick drifts. Confirm the cadence and end time with the user for long/overnight runs.
- **Run the loop silently** — post to chat only on a per-service go-live, the release-notes announcement,
  or a confirmed escalation. For minor reversible choices (which bucket/window, which query variant), pick
  a reasonable default and note it in the report; do not ask. The cadence/end-time confirmation above is
  the one sanctioned question.
- **Deep sweep = parallel verification.** For thoroughness, fan out one analyzer per service/dimension and
  put each flagged anomaly through an independent skeptic before it counts (a `Workflow`/agent fan-out is
  ideal). One dominant finding beats many unverified ones.
- **Best-effort caveat:** in-session background timers pause when the session/host suspends, so an
  overnight loop is best-effort. State this to the user. Don't rely on the live ticks for completeness —
  the **retrospective report from the backends is the source of truth**.

## Cross-cutting analysis gotchas (apply everywhere)

- **A trailing dip in a time-bucketed chart is usually the in-progress (partial) bucket**, not a real
  drop. Read the rate and exclude the current bucket before alarming.
- **A step-change exactly at deploy time can be a logging/metric change** (dedup, renamed field, changed
  cardinality), not a behavior change. Confirm with exact-identifier queries.
- **Duration percentiles swing with workload mix** — if p50 rises while throughput *also* rises, it's mix,
  not regression.
- **A metric-schema change at the release can break before/after continuity.** If a metric has no
  pre-deploy series, say so and use the window as the new baseline rather than inventing a delta.
- **Distinguish a failure's root cause from its cleanup symptoms.** An error logged in a catch/cleanup path
  is often secondary — trace to the originating error (upstream dependency, external API) before blaming
  the layer that logged it.
- **Cross-environment bleed:** metrics/traces tools may span all environments. A non-prod version tag or
  host in a query is likely a scrape from another env — confirm against a prod-only source.
- **Scope numbers to the released services.** Exclude co-located but separately-deployed services from
  release-attributed volume/error counts.

## Related

`deploy-status` (per-project deploy detection, health endpoints, log recipes); `feature-monitor` (narrow,
single-feature correctness + goal metric — run alongside when a release centers on one feature);
`chat-formatting` and `artifact-design` for output.
