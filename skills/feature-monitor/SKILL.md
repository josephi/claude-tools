---
name: feature-monitor
description: >-
  Verify a SPECIFIC feature works correctly in production after a release — no regressions — and measure
  the metric it was built to move. Instruments the feature with resolution anchors, runs a correctness
  signal-sweep (fail-loud invariant, contract integrity, round-trip persistence, mechanism effectiveness,
  adjacent-path parity, edge warnings), compares resolved VALUES pre-vs-post using whatever pre-change
  ground truth exists, and quantifies the goal metric normalized per unit of work against a same-time-of-day
  baseline. TRIGGER when the user asks to monitor/verify a specific feature after release, confirm a feature
  still behaves as it did before a change, prove a feature has no behavioral regression, or measure a
  feature's intended impact (request/latency/cost reduction, hit-ratio, throughput). SKIP for whole-release
  rollout health (use post-deploy-monitor), local runs, or one-off single-metric lookups.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# Feature monitor (generic)

A method for proving that **one feature** behaves correctly in production after it ships: it resolves the
same values it did before, its invariants hold, its mechanism (cache/index/pipeline) actually engages, and
it moved the metric it was built to move. This is the **framework**; the feature owner supplies the
specifics below. Sibling skill `post-deploy-monitor` watches a whole release across services — this one
goes narrow and deep on a single feature's correctness and goal metric. Run both when a release centers on
one feature.

## What the feature owner must provide

1. **The invariant** — the one property that must always hold ("a flag is definitively ON / OFF / FETCH-
   FAILED, never silently wrong"; "every record gets exactly one owner"; "amounts round-trip to the cent").
2. **Resolution anchors** — the log/metric lines that expose, per resolution: the resolved VALUE, its
   provenance (live source vs cache/derived), and a **reliable discriminator** (see Instrumentation).
3. **The contract shape** — the fixed set the feature ranges over (catalog size, enum, key count) so drift
   is detectable.
4. **The goal metric** — what the feature was built to change, and the unit of work to normalize by
   (per job / per request / per record).
5. **Pre-change ground truth** — what signal captured the feature's values/behavior *before* the change
   (an old audit log, an HTTP-client log, a prior metric). The new anchors usually don't exist pre-deploy,
   so alignment leans on this.
6. **Baselines, channels, escalation owner** — or how to establish them at deploy time.

## Instrumentation (design the anchors before you ship)

The monitor is only as good as the log line it reads. When adding the feature, emit a **static-message**
resolution log carrying the value + provenance in structured metadata (per `log-standards`), and make it
**readable without the confounds below**:

- **Pick a discriminator only YOUR log sets.** Distinguish live-fetch vs cache-hit (or computed vs
  defaulted) by a field the emitting line owns exclusively — e.g. a `catalogSize`/`sourceCount` present
  only on the live path — NOT a generic `source`/`type` field. Shared logging context (CLS / MDC /
  AsyncLocalStorage `addMetadata`) merges over per-call metadata in many loggers, so a generic field name
  gets **clobbered by an unrelated code path** and reads as the wrong value. If you must keep a human
  `source` label, namespace it (`myFeatureSource`) so nothing else writes that key.
- **Emit one line per resolution**, both on hit and miss, so hit-ratio is countable.
- **Log the value in a stable, parseable form** (a sorted `key:bool` join) so pre/post maps diff cleanly.
- **Fail loud**: the invariant's failure paths (bad upstream shape, unknown key, missing id) must each log
  a distinct static message and throw — never resolve to a silent default.

## Procedure

1. **Confirm anchors are live and find the deploy boundary.** Query the new resolution log; take the
   **first-appearance timestamp** as the real "version serving" moment (rollout often starts before/after
   the CI build's clock). Everything after is the post window; a like-length, same-time-of-day window well
   before is the baseline.
2. **Run the correctness sweep** (below) over post vs baseline. Fan out one analyzer per signal for
   thoroughness (a `Workflow`/agent fan-out keeps the large query outputs out of your context); hand each
   analyzer the **field contract** (message field, the reliable discriminator, "do NOT key on the bled
   field") so they don't each rediscover it.
3. **Prove pre/post VALUE alignment** (below) — the heart of "no regression."
4. **Measure the goal metric** (below), normalized per unit of work, same-time-of-day baseline.
5. **Report**; **escalate only confirmed, feature-attributable problems.**

For minor reversible choices — window length, which same-time-of-day baseline, which pod/dimension
breakdown — pick a reasonable option, note it in the report, and proceed; do not pause to ask.

## The correctness sweep (adapt each signal to the feature)

Each signal maps to a specific way the feature could be wrong:

- **Fail-loud surfacing** — count every invariant-failure message. Expected **zero**; any occurrence is the
  feature silently degrading. Confirm the happy path is also firing (a control count) so "zero" means clean,
  not a dead filter.
- **Contract integrity** — the fixed shape holds on every resolution (`catalogSize == N` everywhere; enum
  in range). A single off value = registry/schema drift.
- **Round-trip persistence** — the cached/derived value equals the source value: group by entity, assert one
  distinct resolved value per entity across live and cache reads. Divergence = serialization/cache
  corruption. (Legit changes mid-window look like divergence — judge systematic vs isolated.)
- **Mechanism effectiveness** — the cache/index/batch actually engages: hit-ratio = hits / (hits + misses).
  ~1:1 (all misses) means the mechanism isn't wired in the hot path (context-loss regression); high ratio =
  working. Break down by service/pod so you see where it does and doesn't engage.
- **Adjacent-path parity** — the feature's other half (the write side, the sibling resolver, the downstream
  consumer) is also flowing and quiet.
- **Edge / malformed** — no keys ending `-undefined`/`-null`, no "missing identifier" warnings at volume
  (they signal cache misses / broken scoping even when nothing errors).
- **Deploy error-rate regression** — post per-minute error rate vs baseline, **attributable to the feature**:
  bucket by message, and confirm any new/elevated signature actually names the feature. A rate bump made
  entirely of pre-existing, unrelated signatures (upstream noise, restart churn) is **not** this
  feature's regression — say so explicitly.

## Pre/post value alignment (the "no regression" proof)

The new resolution log rarely exists pre-deploy, so anchor "before" on the pre-change ground truth (the old
audit / HTTP-client log / prior metric the owner named). Then:

1. Take entities present in **both** the pre-change signal and the post resolution log.
2. Reduce the pre signal to the feature's contract (e.g. which of the N catalog keys were enabled) and diff
   key-by-key against the post resolved value.
3. **Systematic mismatch** (same key flips across many entities, or everything off) → real regression.
   **Isolated one-offs** on varied keys/entities → almost always legit toggles/config changes in the window
   or a name/scope nuance, not a code bug. Report counts and let the pattern speak.
4. State the overlap honestly: entities that appear only post (no pre anchor) are excluded, not counted as
   matches.

## Goal-metric measurement

Measure what the feature was built to move, and defend the number:

- **Normalize per unit of work.** Raw counts move with load; "calls per job", "ms per request", "bytes per
  record" isolate the feature. Report raw only alongside comparable denominators.
- **Same-time-of-day baseline**, ideally same weekday; if not, per-unit normalization absorbs the load
  difference — say which you relied on.
- **Count the true quantity, not a proxy that a release also changed.** If the feature's deploy also changed
  *logging* of the thing you're counting (e.g. "audit only on failure"), the log count craters for a reason
  unrelated to traffic — count actual work from an unaffected source (cache-miss/live-fetch anchors, or APM)
  instead.
- Give the reduction as **% and multiplier**, with the residual uncertainty as a stated range.

## Confounds and self-checks (this is where monitoring goes wrong)

Before believing any result — especially a surprising one, and **especially one a subagent returns** —
verify the measurement, not just the value:

- **Wrong window.** Confirm your "current" window is actually *after* the deploy boundary (first-appearance
  of the new log). A window that's mostly pre-deploy measures the OLD version and will "prove" the feature
  did nothing. This is the single most common error.
- **Logging change at the boundary.** A step-change exactly at deploy can be an emission-policy change
  (log-on-failure-only, renamed field, dedup), not behavior. Cross-check with an exact-identifier query.
- **Clobbered / union-typed fields.** A field written by shared logging context is unreliable and often
  polymorphic (object|string) — equality on it throws in some query engines. Use a field your line owns; cast
  when grouping.
- **Retention limits.** Raw traces/spans are typically retained ~15 days; use **trace metrics** (retained
  months) for any months-old comparison. Logs vary — confirm the old window actually has data before
  trusting a zero.
- **Partial trailing bucket** reads as a dip; exclude the in-progress bucket.
- **Attribution.** Scope error/volume counts to the feature and its services; exclude co-located but
  separately-deployed services and pre-existing unrelated signatures.
- **Adversarial default.** A failing/surprising signal is real until proven otherwise — but a *surprising
  agent conclusion* is a measurement error until proven otherwise. Re-query independently before you relay
  it or escalate.

## Escalation

The confirmed-and-attributable filter governs **only the DM/page decision** — not what gets measured or
recorded. DM the owner on Discord **only for a confirmed, feature-attributable problem**: an
invariant-failure message > 0, a systematic value mismatch, contract drift, hit-ratio collapse, malformed
keys, or a new error signature that names the feature. Routine "green" and load-driven noise from unrelated
paths stay out of the DM — but they still go in the report. Verify twice before paging.

**Record every sweep signal in the report** with an explicit confidence and severity — including the
green/routine results that don't clear the escalation bar. The escalation gate is separate from the report's
coverage: a signal that comes back clean, or a rate bump that's real but not feature-attributable, is a
recorded finding (confidence + severity noted), not a dropped one. Suppress it from the DM, never from the
report.

## Worked example (reference)

A feature-flag cache in a sync service: invariant = "flag is ON/OFF/FETCH-FAILED, never silent-OFF";
anchor = `features resolved` with `enabledFromApi` (live) vs absent (cache) as the discriminator (the
generic `source` field was clobbered by a shared-context `addMetadata` in another service — the exact
bled-field trap above); contract = `catalogSize == 8`; goal metric = flag-provider HTTP calls per sync
job. Result: fail-loud 0, catalogSize 8 everywhere, 100% value alignment on the flag side (424 entities),
~74% cache-hit, ~12–17× fewer provider calls/job vs a same-time-of-day baseline two months prior. A first
pass wrongly concluded "no reduction" because its "current" window sat ~91% *before* the deploy boundary —
the wrong-window confound.

## Related

`post-deploy-monitor` (release-wide rollout health — run alongside); `log-standards` (anchor design);
`deploy-status` and the project's observability recipes (cloud logs / APM queries); `chat-formatting` +
`artifact-design` (output); `plan-workflow`/`Workflow` (parallel sweep + adversarial verification).
