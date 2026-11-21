---
name: gcp-monitoring
description: Read Google Cloud Monitoring for the current project — CPU/memory/disk on a VM, request latency and error rate, uptime checks, and firing alert policies. Personal-stack replacement for the work Prometheus skill. TRIGGER when the user says "is the VM under load", "what's the error rate", "check CPU on prod", "are any alerts firing", "is it a resource problem". SKIP for log content (that is gcp-logging) and for whether the service is up (that is deploy-status).
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# gcp-monitoring

Metric and alert reading for the current project's GCP deployments. Read-only: `gcloud monitoring` reads and `gcloud compute instances describe`. Nothing here creates or edits a policy.

Personal-stack counterpart to the work `prometheus` skill. PromQL is replaced by Monitoring filters and MQL, but the same rule applies: a metric answers "is it saturated", never "why". When a metric points at a problem, the next step is `gcp-logging`, not a bigger dashboard.

## Reading the context

```sh
KEY=$("${CLAUDE_SKILL_DIR}/../../bin/project-key")
PROJECT=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg" "$KEY" gcloud projectId)
PROD_NAME=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg" "$KEY" deploy prod name 2>/dev/null || true)
PROD_ZONE=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg" "$KEY" deploy prod zone 2>/dev/null || true)
```

If a `gcloud` call returns a reauth error, use `gcloud-auth`. Do not retry the same command first — the failure is not transient.

## What to check, in order

Start at the cheapest signal that could explain the symptom:

1. **Alerts already firing.** If something is wrong, a policy may already say what.
2. **Host resources** — CPU, memory, disk. Cheap, and rules out the boring explanation.
3. **Request-level metrics** — latency, error rate. Only meaningful if the service actually exports them.
4. **Uptime checks** — external reachability over time, which distinguishes "down" from "slow".

### Firing alerts

```sh
gcloud alpha monitoring policies list --project="$PROJECT" \
  --format='table(displayName, enabled, conditions[0].displayName)'
```

An empty list is a real answer: it means nothing is *configured* to alert, not that everything is healthy. Say so rather than reporting "no alerts" as if it were a clean bill of health.

### Host resources on a VM

```sh
gcloud monitoring time-series list \
  --project="$PROJECT" \
  --filter='metric.type="compute.googleapis.com/instance/cpu/utilization"' \
  --format='value(points[0].value.doubleValue)' \
  --interval-end-time="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --interval-start-time="$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"
```

The `date` fallback covers both BSD (macOS) and GNU (Linux) — `-v-1H` is BSD-only and fails on Linux.

Useful metric types:

| Question | `metric.type` |
|---|---|
| CPU | `compute.googleapis.com/instance/cpu/utilization` |
| Memory used | `agent.googleapis.com/memory/percent_used` (needs the Ops Agent) |
| Disk used | `agent.googleapis.com/disk/percent_used` (needs the Ops Agent) |
| Network in/out | `compute.googleapis.com/instance/network/received_bytes_count` |

**Memory and disk need the Ops Agent installed on the VM.** Without it those series simply do not exist, and an empty result reads exactly like "healthy". Check whether the agent is running before reporting a memory figure — or its absence — as fact:

```sh
gcloud compute ssh "$PROD_NAME" --zone="$PROD_ZONE" \
  --command="systemctl is-active google-cloud-ops-agent 2>/dev/null || echo 'ops-agent not installed'"
```

### A quick live read instead

For a one-off "is it under load right now", SSH is faster and needs no agent:

```sh
gcloud compute ssh "$PROD_NAME" --zone="$PROD_ZONE" \
  --command="uptime; free -m; df -h /; sudo docker stats --no-stream 2>/dev/null | head -5"
```

Prefer this when the question is about *now*. Prefer the time series when the question is about a trend or a past incident.

## Reporting

- Give the number and the window it covers. "CPU 34%" is not useful without "averaged over the last hour".
- Distinguish "the metric says fine" from "the metric does not exist". Those look identical in a query result and mean opposite things.
- When a metric is abnormal, stop and hand off to `gcp-logging` for the cause. Do not speculate from the shape of a graph.

## What this skill does not do

- Does not create, edit, or delete alert policies, uptime checks, or dashboards.
- Does not read log content — that is `gcp-logging`.
- Does not restart or resize anything.
