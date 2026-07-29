---
name: gcloud-auth
description: Re-authenticate gcloud for the current project, opening Chrome in the right profile automatically. TRIGGER when gcloud commands fail with "Reauthentication failed" or "your credentials are expired", or when the user asks to "log in to gcloud" / "reauth gcloud" / "refresh gcloud credentials". SKIP if gcloud calls are succeeding — auth is fine.
model: haiku
tags: [audience/personal, portable/verbatim]
---

# gcloud auth

Re-authenticate the right GCP account for the current project, opening Chrome in the correct profile so the SSO consent screen appears immediately.

## Project config

Per-project context lives in `~/.claude-personal/settings.local.json` under the `projects` key:

```jsonc
{
  "projects": {
    "<key>": {
      "match":   ["<repo-dir-glob>", ...],     // optional; defaults to key match
      "displayName": "...",
      "gcloud":  {
        "projectId": "...",                    // GCP project ID
        "account":   "user@domain",            // login email
        "region":    "us-central1",            // optional
        "zone":      "us-central1-a"           // optional
      },
      "github":  { "owner": "...", "repo": "...", "defaultBranch": "main" },
      "chrome":  {
        "profile":      "profile__<key>",      // Chrome --profile-directory value
        "wrapper":      "~/bin/chrome-<key>",  // BROWSER wrapper path
        "accountEmail": "user@domain"
      }
    }
  }
}
```

Other skills (chrome-debug, gh-context, etc.) read from `projects.<key>.<topic>` — keep that schema stable.

## Steps

1. **Resolve the project key.**
   - If user passed a key as args, use it.
   - Else: `KEY=$(git rev-parse --show-toplevel 2>/dev/null | xargs -I{} basename {})` and look up by:
     - exact match against `projects.<name>`
     - any `projects.<name>.match` glob that matches the repo basename
   - If nothing matches: list available keys to the user and ask which one (or to add a new entry).

2. **Read the project config.** Pull `gcloud.projectId`, `gcloud.account`, and `chrome.wrapper` out of `~/.claude-personal/settings.local.json`. Expand `~/` in the wrapper path before using it.

3. **Verify wrapper exists.** `test -x "$WRAPPER"` — if missing, instruct the user to create it (see the `chrome.wrapper` value):
   ```sh
   cat > "$WRAPPER" <<EOF
   #!/bin/sh
   exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --profile-directory="<chrome.profile>" \
     "\$@"
   EOF
   chmod +x "$WRAPPER"
   ```
   Then stop and ask the user to confirm the Chrome profile is signed into the right account.

4. **Run the auth command.**
   ```sh
   BROWSER="$WRAPPER" gcloud auth login --account "$ACCOUNT" --update-adc
   ```
   This opens Chrome in the configured profile. The user clicks Allow once. `--update-adc` refreshes Application Default Credentials so SDKs (boto3, google-auth) keep working.

5. **Pin the active project.**
   ```sh
   gcloud config set project "$PROJECT_ID"
   gcloud config set account "$ACCOUNT"
   ```
   Idempotent — safe to run every time.

6. **Smoke test.** One cheap read call to confirm auth + project are good:
   ```sh
   gcloud projects describe "$PROJECT_ID" --format='value(name)' >/dev/null && echo "✅ gcloud ready: $ACCOUNT @ $PROJECT_ID"
   ```

## When auth has *just* failed in the same session

Don't show the wrapper-creation instructions or smoke-test prose to the user — just run steps 4–6 and report success in one line. The minimum-friction recovery is what they want.

## Reading the config from a shell

Use this one-liner to extract a value safely:

```sh
python3 -c '
import json, os, sys
p = os.path.expanduser("~/.claude-personal/settings.local.json")
d = json.load(open(p))
print(d["projects"][sys.argv[1]][sys.argv[2]][sys.argv[3]])
' aclim gcloud projectId
```

For Bash convenience, source a small extractor:

```sh
gcloud_cfg() { python3 -c '
import json,os,sys
d=json.load(open(os.path.expanduser("~/.claude-personal/settings.local.json")))
keys=sys.argv[1:]
v=d
for k in keys: v=v[k]
print(v)
' "$@"; }
KEY=aclim
PROJECT_ID=$(gcloud_cfg projects "$KEY" gcloud projectId)
ACCOUNT=$(gcloud_cfg projects "$KEY" gcloud account)
WRAPPER=$(eval echo "$(gcloud_cfg projects "$KEY" chrome wrapper)")
```

## What not to do

- Don't run plain `gcloud auth login` without `BROWSER=$WRAPPER` — that opens the default profile and triggers the "you have another account" conflict.
- Don't suggest creating SA keys to skip reauth — `sadotproj.co.il` org policy blocks SA key creation.
- Don't grant roles to consumer-Gmail accounts on `sadotproj.co.il` projects — `iam.allowedPolicyMemberDomains` blocks it.
- Don't write config under arbitrary keys in `settings.local.json` — stick to `projects.<key>.{gcloud,github,chrome}` so other skills can rely on the schema.

## Adding a new project

When the user starts working on a new GCP project, prompt them for:
1. **Key** (short, lowercase, e.g. `aclim`) — used for lookup
2. **gcloud projectId** (e.g. `refreshing-well-496818-u3`)
3. **gcloud account** (the login email)
4. **Chrome profile dir** — find via `python3 -c 'import json,os;d=json.load(open(os.path.expanduser("~/Library/Application Support/Google/Chrome/Local State")))["profile"]["info_cache"];[print(f"{k:20} {v.get(\"user_name\")}") for k,v in d.items()]'`

Then write the entry into `settings.local.json` and create the wrapper at `~/bin/chrome-<key>`.
