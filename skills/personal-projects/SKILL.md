---
name: personal-projects
description: Manage entries in ~/.claude-personal/settings.local.json under `projects.<key>` — add a new project with all its topics (gcloud, github, chrome, app, deploy), list existing projects, show one, validate that the config matches reality, or update a single field. TRIGGER when the user says "add a new project", "register this project", "show my projects", "validate the X project config", "what's in my project config", "update the project's <field>", or when another skill needs project metadata that doesn't exist yet. SKIP for routine project work that just *reads* config — that's the sibling skills' job.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# personal-projects

Authoritative manager for `~/.claude-personal/settings.local.json` → `projects.<key>`. All sibling skills (`gcloud-auth`, `github-context`, `chrome-debug`, `deploy-status`, …) **read** from this schema; this skill is the only one that **writes** to it.

## Schema (canonical)

```jsonc
{
  "projects": {
    "<key>": {
      "match":       ["A-clim-v2", "A-clim-v2-*"],   // optional dir-basename globs
      "displayName": "Human-readable name",

      "gcloud": {
        "projectId":      "...",                     // GCP project ID
        "displayName":    "...",                     // optional
        "account":        "user@domain",             // primary login
        "region":         "us-central1",
        "zone":           "us-central1-a",
        "billingAccount": "user@domain",             // optional, informational
        "orgId":          "785965843512"             // optional
      },

      "github": {
        "owner":             "...",
        "repo":              "...",
        "nameWithOwner":     "owner/repo",
        "defaultBranch":     "main",
        "developmentBranch": "refactor",             // optional integration branch
        "prTargetBranch":    "refactor",             // where PRs land now
        "authAccount":       "josephi",              // gh-authenticated user
        "authHost":          "github.com",
        "protectedBranches": ["main"]
      },

      "chrome": {
        "profile":      "profile__<key>",            // Chrome --profile-directory
        "wrapper":      "~/bin/chrome-<key>",        // BROWSER wrapper path
        "accountEmail": "user@domain"
      },

      "app": {
        "localUrl":    "http://localhost:5173",
        "stagingUrl":  "http://<ip-or-host>",
        "prodUrl":     "http://<ip-or-host>",
        "healthPath":  "/api/health",
        "healthCheck": "json"                        // "json", "html", or "status"
      },

      "deploy": {
        "platform": "gce-vm",                        // gce-vm | cloud-run | docker | other
        "prod":    { "name", "ip", "machineType", "zone", "branch", "containerName" },
        "staging": { "name", "ip", "machineType", "zone", "branch", "containerName" }
      },

      "supabase": {
        "projectRef":      "xyphcamidjwcujscjvqf",   // dashboard project ref
        "url":             "https://<ref>.supabase.co",
        "jwksUrl":         "https://<ref>.supabase.co/auth/v1/.well-known/jwks.json",
        "anonKey":         "sb_publishable_...",     // browser-safe publishable key
        "authAlgorithm":   "ES256",                  // "ES256" (new asymmetric) or "HS256" (legacy symmetric)
        "authMode":        "jwks",                   // "jwks" (asymmetric — backend fetches JWKS) or "secret" (legacy HS256)
        "needsJwtSecret":  false,                    // true only if authMode == "secret"
        "secrets": {                                 // sensitive — never echo to chat
          "dbPassword":               "...",
          "databaseUrlNote":          "free-form note on dashboard location",
          "databaseUrlPoolerTemplate":"postgresql://postgres.<ref>:<pwd>@<region>.pooler.supabase.com:6543/postgres",
          "databaseUrlDirectTemplate":"postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres",
          "jwtSecret":                "..."          // only when authMode == "secret"
        }
      }
    }
  }
}
```

Topics are **optional** — a project may have only `github` if it's a static site, or only `gcloud` + `deploy` for a backend service. Don't invent fields outside this schema without updating the docs here.

## Resolver helpers (shared across skills)

Two scripts at `~/bin/`:

- `project-key [<target>]` — prints the project key for the current cwd (or a given path/basename). Exits non-zero if no match.
- `project-cfg <key> <topic> [<field> ...]` — prints a value from the schema. Lists become space-joined, dicts pretty-printed JSON, scalars literal.

Examples:

```sh
KEY=$(project-key)
PROJECT_ID=$(project-cfg "$KEY" gcloud projectId)
NWO=$(project-cfg "$KEY" github nameWithOwner)
WRAPPER=$(eval echo "$(project-cfg "$KEY" chrome wrapper)")    # expands ~
```

Skills must use these helpers rather than inlining JSON parsing.

## Operations

### list

```sh
python3 -c '
import json, os
d = json.load(open(os.path.expanduser("~/.claude-personal/settings.local.json")))
for key, body in d.get("projects", {}).items():
    topics = ", ".join(t for t in ("gcloud","github","chrome","app","deploy") if t in body)
    print(f"{key:15} {body.get(\"displayName\",\"\"):40} [{topics}]")
'
```

### show <key>

```sh
project-cfg <key> gcloud     # or any topic
# or full dump:
python3 -c '
import json, os, sys
d = json.load(open(os.path.expanduser("~/.claude-personal/settings.local.json")))
print(json.dumps(d["projects"][sys.argv[1]], indent=2))
' <key>
```

### add <key> — interactive flow

When the user says "add a new project", run this flow (use `AskUserQuestion` for each prompt):

1. **Key** — short, lowercase, hyphens (e.g. `aclim`, `myapp`). Validate it doesn't exist already.
2. **Match globs** — default `["<repo-name>", "<repo-name>-*"]` if the user is currently inside a git repo; allow override. The `*` glob handles worktrees.
3. **Topics to include** — multi-select `gcloud / github / chrome / app / deploy`.
4. For each selected topic, collect fields:
   - **gcloud**: `projectId`, `account`. Then verify by running `gcloud projects describe <id> --format='value(name)'` (will need fresh auth — defer to the `gcloud-auth` skill if it errors).
   - **github**:
     - If cwd is a repo, autodetect via `gh repo view --json owner,name,nameWithOwner,defaultBranchRef`.
     - Ask the user to confirm/override `prTargetBranch` (often the same as default; for the aclim project it's `refactor`).
     - Detect the gh-active account via `gh api user --jq .login` and propose it as `authAccount`.
     - Default `protectedBranches: ["main"]`.
   - **chrome**:
     - List available Chrome profiles by reading `~/Library/Application Support/Google/Chrome/Local State` (`profile.info_cache`).
     - Ask the user to either pick an existing profile or sign into a new one first.
     - Default `profile: "profile__<key>"` and `wrapper: "~/bin/chrome-<key>"`.
     - Create the wrapper script:
       ```sh
       cat > ~/bin/chrome-<key> <<EOF
       #!/bin/sh
       exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         --profile-directory="<profile>" \
         "\$@"
       EOF
       chmod +x ~/bin/chrome-<key>
       ```
   - **app**: ask for `localUrl`, `stagingUrl`, `prodUrl`, `healthPath`, `healthCheck` (json/html/status).
   - **deploy**: ask for `platform` (gce-vm/cloud-run/docker/other), then platform-appropriate fields.

5. **Write atomically** — read the JSON, merge the new entry, write back via a temp file:
   ```sh
   python3 - <<'PY'
   import json, os, tempfile
   p = os.path.expanduser("~/.claude-personal/settings.local.json")
   d = json.load(open(p)) if os.path.isfile(p) else {}
   d.setdefault("projects", {})
   # ... merge ...
   tmp = tempfile.NamedTemporaryFile(mode="w", dir=os.path.dirname(p), delete=False)
   json.dump(d, tmp, indent=2); tmp.write("\n"); tmp.close()
   os.replace(tmp.name, p)
   PY
   ```

6. **Validate immediately** after writing (see `validate <key>` below).

### update <key> <topic>.<field> <value>

Single-field edit. Atomic write same as `add`. Don't allow overwriting `key`.

### validate <key>

Run each check, report pass/fail. Don't block on a failed check — print the remediation.

| Check | Pass when | Remediation |
|---|---|---|
| Schema present | the key exists in projects | run `add` |
| `chrome.wrapper` file | `test -x` returns true | recreate via add flow |
| `chrome.profile` dir | exists in `~/Library/Application Support/Google/Chrome/<profile>` | sign in to that profile in Chrome |
| `gcloud.projectId` reachable | `gcloud projects describe <id>` succeeds | invoke `gcloud-auth` skill |
| `github.nameWithOwner` reachable | `gh repo view <nwo>` succeeds | check owner/repo, run `gh auth switch -u <authAccount>` |
| `app.healthPath` responds | curl returns expected shape | check deploy status |

## Adding a new topic to the schema

When a future skill needs a new topic (say `supabase`):

1. Decide the topic key. Use lowercase. Don't reuse `gcloud`/`github`/`chrome`/`app`/`deploy`.
2. Update **this skill's schema section** with the new topic's fields (this file is authoritative).
3. Update the `add` flow above to prompt for the new topic.
4. Update existing project entries to include the new topic where applicable.
5. Reference the new topic in the consuming skill's SKILL.md.

## What not to do

- Don't write project metadata to anywhere except `~/.claude-personal/settings.local.json`. No skill-local copies.
- Don't expose secrets in this file — `account` is an email, not a token. Tokens stay in `~/.claude-personal/.claude.json` env or in OS keychains.
- Don't update Claude's own top-level settings keys (`permissions`, `env`, `hooks`, `model`, etc.) from this skill. `personal-projects` only manages the `projects` key.
- Don't accept arbitrary topic names in `add` — restrict to the documented set unless the schema itself is being extended (see "Adding a new topic" above).
- Don't write the file non-atomically (`open(p, "w")` directly) — use a temp file + `os.replace`. Crash mid-write would corrupt all projects.
