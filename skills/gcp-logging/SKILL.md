---
name: gcp-logging
description: Query Google Cloud Logging for the current project — recent errors, a request trace, logs around a deploy, or a search for a specific message. Personal-stack replacement for the work Coralogix skill. TRIGGER when the user says "check the logs", "what errors are in prod", "search the logs for X", "why did that request fail", "logs around the deploy". SKIP for local-dev logs (read the terminal) and for whether a service is up at all — that is deploy-status.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# gcp-logging

Log search for the current project's GCP deployments. Read-only: every command here is a `gcloud logging read` or a `docker logs` over SSH. Nothing writes.

This is the personal-stack counterpart to the work `coralogix-dashboards` skill. The query language is different (Cloud Logging filters, not Lucene/DataPrime) but the discipline is the same: narrow by resource and time before you narrow by text, or you pay for a full scan and still miss the entry.

## Reading the context

```sh
KEY=$("${CLAUDE_SKILL_DIR}/../../bin/project-key")
PROJECT=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg" "$KEY" gcloud projectId)
PLATFORM=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg" "$KEY" deploy platform)
PROD_NAME=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg" "$KEY" deploy prod name    2>/dev/null || true)
STG_NAME=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg"  "$KEY" deploy staging name 2>/dev/null || true)
PROD_ZONE=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg" "$KEY" deploy prod zone    2>/dev/null || true)
PROD_CTR=$("${CLAUDE_SKILL_DIR}/../../bin/project-cfg"  "$KEY" deploy prod containerName 2>/dev/null || true)
```

If `gcloud.projectId` is missing, defer to `personal-projects` to add it. If a `gcloud` call returns a reauth error, use `gcloud-auth` — do not retry the same command.

## Order of attack

1. **Scope to the resource first.** `resource.type` plus the instance or service name. An unscoped read across a project with several services returns mostly noise.
2. **Then the time window.** Always pass `--freshness`; the default is the last 24h but being explicit keeps the query reproducible when you paste it back to the user.
3. **Then severity.** `severity>=ERROR` is the usual opening move.
4. **Only then text.** Free-text matching is the most expensive filter, so it goes last.

## Recipes

### Recent errors

```sh
gcloud logging read \
  "resource.type=gce_instance AND resource.labels.instance_id!=\"\" AND severity>=ERROR" \
  --project="$PROJECT" --freshness=1h --limit=50 \
  --format='table(timestamp, resource.labels.instance_id, severity, textPayload, jsonPayload.message)'
```

For Cloud Run instead of a VM, swap the resource clause for `resource.type=cloud_run_revision AND resource.labels.service_name="<service>"`.

### Search for a message

Put the text filter last and keep the window tight:

```sh
gcloud logging read \
  "resource.type=gce_instance AND severity>=WARNING AND \"connection refused\"" \
  --project="$PROJECT" --freshness=6h --limit=30 \
  --format='value(timestamp, textPayload)'
```

A bare quoted string matches across the whole entry. To match a structured field, name it: `jsonPayload.message:"connection refused"` (`:` is "contains", `=` is exact).

### Logs around a deploy

Get the deploy time from `deploy-status` (or the container's start time), then bracket it:

```sh
gcloud logging read \
  "resource.type=gce_instance AND timestamp>=\"2026-07-29T09:00:00Z\" AND timestamp<=\"2026-07-29T09:15:00Z\"" \
  --project="$PROJECT" --limit=200 --order=asc \
  --format='value(timestamp, severity, textPayload)'
```

`--order=asc` matters here: you want to read forward through a startup sequence, not backward.

### Container logs directly

Cloud Logging only sees what the container ships to it. When the app logs to stdout and nothing is configured to forward, go to the container:

```sh
gcloud compute ssh "$PROD_NAME" --zone="$PROD_ZONE" \
  --command="sudo docker logs --tail 200 --timestamps '$PROD_CTR' 2>&1"
```

This is also the fastest path when you already know the entry is in the last few minutes.

## Reading the output

Match what you find against the `log-standards` rule. Logs written to that standard have a static lowercase message and put every dynamic value in structured metadata, so:

- Filter on `jsonPayload.message="records synced"` to find one operation across all its invocations.
- The identifiers to pivot on (request id, correlation id, record id) are fields, not substrings — use `jsonPayload.<field>=`, which is indexed, rather than a free-text match.

If the logs you are reading are interpolated strings instead, that is a finding worth reporting: it is exactly what `log-standards` exists to prevent, and it is why the search was harder than it should have been.

## What this skill does not do

- Does not create sinks, metrics, or alerts. Those are `gcp-monitoring`.
- Does not tell you whether a service is running — that is `deploy-status`.
- Does not write, delete, or export logs.
