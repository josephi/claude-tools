---
name: deploy-status
description: Report the health and recent activity of the current project's prod and staging deployments — VM running? container up? /api/health responding? what commit is live? recent error logs? TRIGGER when the user says "is staging up", "what's the deploy status", "what commit is live on prod", "tail the staging logs", "did the deploy succeed", "smoke-test the app". SKIP for local-dev questions or pre-deploy verification.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# deploy-status

Health and activity reporting for the current project's deployments. Reads `projects.<key>.deploy` and `projects.<key>.app`; runs read-only commands only (gcloud describe, curl, docker logs via ssh).

## Reading the deploy context

```sh
KEY=$(~/bin/project-key)
PLATFORM=$(~/bin/project-cfg "$KEY" deploy platform)
PROD_NAME=$(~/bin/project-cfg "$KEY" deploy prod name 2>/dev/null || true)
STG_NAME=$(~/bin/project-cfg  "$KEY" deploy staging name 2>/dev/null || true)
PROD_IP=$(~/bin/project-cfg   "$KEY" deploy prod ip      2>/dev/null || true)
STG_IP=$(~/bin/project-cfg    "$KEY" deploy staging ip   2>/dev/null || true)
PROD_ZONE=$(~/bin/project-cfg "$KEY" deploy prod zone    2>/dev/null || true)
STG_ZONE=$(~/bin/project-cfg  "$KEY" deploy staging zone 2>/dev/null || true)
PROD_CTR=$(~/bin/project-cfg  "$KEY" deploy prod containerName    2>/dev/null || true)
STG_CTR=$(~/bin/project-cfg   "$KEY" deploy staging containerName 2>/dev/null || true)
PROD_URL=$(~/bin/project-cfg  "$KEY" app prodUrl    2>/dev/null || true)
STG_URL=$(~/bin/project-cfg   "$KEY" app stagingUrl 2>/dev/null || true)
HEALTH=$(~/bin/project-cfg    "$KEY" app healthPath 2>/dev/null || echo "/api/health")
```

If `deploy` topic is missing, defer to `personal-projects` to add it.

## Per-platform recipes

### `gce-vm`

```sh
report_vm () {
  local label=$1 name=$2 zone=$3 ip=$4 url=$5 container=$6
  echo "=== $label ($name @ $zone) ==="

  # VM status
  gcloud compute instances describe "$name" --zone="$zone" \
    --format='value(status,machineType.basename(),lastStartTimestamp)' 2>&1

  # HTTP health (no auth needed for the SPA shell)
  curl -m 5 -s -o /dev/null -w "HTTP %{http_code} from %{url_effective}\n" "$url$HEALTH" 2>&1

  # Frontend asset hash — proves which build is live
  curl -m 5 -s "$url/" 2>&1 | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1 | xargs -I{} echo "Frontend bundle: {}"

  # Deployed commit SHA + container status (requires gcloud SSH; will hit reauth here)
  if [ -n "$container" ]; then
    gcloud compute ssh "$name" --zone="$zone" \
      --command="cd /opt/aclim 2>/dev/null && sudo git rev-parse HEAD 2>/dev/null; echo '---'; sudo docker ps --filter name='$container' --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'" 2>&1
  fi
  echo
}

[ -n "$PROD_NAME" ] && report_vm prod    "$PROD_NAME" "$PROD_ZONE" "$PROD_IP" "$PROD_URL" "$PROD_CTR"
[ -n "$STG_NAME" ]  && report_vm staging "$STG_NAME"  "$STG_ZONE"  "$STG_IP"  "$STG_URL"  "$STG_CTR"
```

Tail recent error logs on demand only (not in the default report — it's noisy):

```sh
gcloud compute ssh "$STG_NAME" --zone="$STG_ZONE" \
  --command="sudo docker logs --tail 200 '$STG_CTR' 2>&1 | grep -iE 'error|exception|traceback|fatal' | tail -50"
```

### `cloud-run`

```sh
gcloud run services describe "$NAME" --region="$REGION" \
  --format='value(status.url,status.latestReadyRevisionName,status.traffic[0].percent)'
gcloud run revisions list --service="$NAME" --region="$REGION" --limit=3 \
  --format='table(metadata.name,metadata.creationTimestamp,status.conditions[0].status)'
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$NAME AND severity>=WARNING" \
  --limit=20 --format='value(timestamp,severity,jsonPayload.message,textPayload)' --freshness=1h
```

### `docker` (local-only deploys)

```sh
docker ps --filter "name=$CONTAINER" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -m 5 "$LOCAL_URL$HEALTH"
```

## Report format

Default report — one section per environment, concise:

```
=== staging (aclim-staging @ us-central1-a) ===
VM:        RUNNING  e2-small  started 2026-05-28T08:12:14Z
Health:    HTTP 200 from http://35.209.77.147/api/health
Bundle:    index-yiT_wntw.js
Commit:    e6cd9023 (feature/engine-audit-local)
Container: aclim-backend-1  Up 1h  ghcr.io/nadavsade/aclim-backend:e6cd90...
```

If anything is degraded, lead with the failure and suggest the next step (re-deploy, check logs, etc.). Don't bury the bad news under green checkmarks.

## When gcloud reauth fails mid-report

The SSH and `gcloud compute` calls hit the reauth wall first. If you see `Reauthentication failed`, invoke the `gcloud-auth` skill, then resume. Don't ask the user — the recovery is automated.

## What not to do

- Don't run mutating commands here — no `gcloud compute instances stop`, `docker restart`, `gh workflow run`. This skill is read-only. Mutation belongs in deploy/rollback skills (TBD).
- Don't tail full logs by default — that's expensive on the user's terminal. Aggregate (last error count + last 1–3 lines) and link to the gcloud command for deeper inspection.
- Don't trust HTTP 200 alone — a SPA shell returns 200 for any path including `/api/health`. Read the body and confirm it's the JSON `{"status":"ok",…}` shape if `healthCheck=json`.
- Don't assume the staging branch — for `gce-vm` "last push wins", the staging deploy may not match `refactor`. Always read the commit SHA from the live VM, not from GitHub.

## Related skills

- `gcloud-auth` — sibling, handles reauth.
- `personal-projects` — manage `deploy` topic config.
- `chrome-debug` — when the deploy *is* up but the app misbehaves in the browser.
- `github-context` — to cross-reference the live SHA with PR/branch state.
