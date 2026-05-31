---
name: github-context
description: Resolve the current personal project to its GitHub context (owner, repo, branches, auth account) and run gh commands against the right scope. TRIGGER when about to run `gh` against a specific personal project, when checking which GitHub account / repo is active, when validating that operations target the right branch, or when the user says "switch to the X project" / "use the right gh account" / "open a PR for this project". SKIP for one-off `gh` calls in the current cwd that don't need cross-project context.
model: haiku
tags: [audience/personal, portable/verbatim]
---

# github-context

Project-aware layer for all GitHub work. Reads the per-project schema in `~/.claude-personal/settings.local.json` so other skills (`github-issues`, `task-start`, `task-completion`, `code-review`, etc.) don't have to know the owner/repo/account themselves — they ask this skill.

## Config schema (under `projects.<key>.github`)

```jsonc
{
  "owner": "...",                    // org or user that owns the repo
  "repo": "...",                     // repo name
  "nameWithOwner": "owner/repo",     // convenience — keep in sync with owner+repo
  "defaultBranch": "main",           // GitHub default (usually main)
  "developmentBranch": "refactor",   // long-lived integration branch, if any
  "prTargetBranch": "refactor",      // where PRs land during current phase
  "authAccount": "josephi",          // gh-authenticated GitHub login
  "authHost": "github.com",          // GitHub host (github.com or enterprise)
  "protectedBranches": ["main"]      // never push directly / never edit on
}
```

Keep this schema stable so future GitHub skills can rely on the field names.

## Resolution (which project am I in?)

1. If the caller passed an explicit key, use it.
2. Otherwise: `REPO=$(git rev-parse --show-toplevel 2>/dev/null | xargs -I{} basename {})`
3. Look up in `projects`:
   - exact key match (`projects.<REPO>`)
   - any `projects.<key>.match` glob that matches `$REPO`
4. If nothing matches: list available project keys back to the user and ask which one to use (or to add an entry).

Helper:

```sh
project_key() {
  local repo=${1:-$(git rev-parse --show-toplevel 2>/dev/null | xargs -I{} basename {} 2>/dev/null)}
  python3 - "$repo" <<'PY'
import json, os, sys, fnmatch
cfg = json.load(open(os.path.expanduser("~/.claude-personal/settings.local.json")))
repo = sys.argv[1] or ""
for key, body in cfg.get("projects", {}).items():
    if key == repo:
        print(key); break
    for glob in body.get("match", []):
        if fnmatch.fnmatch(repo, glob):
            print(key); break
    else:
        continue
    break
PY
}
gh_cfg() {
  local key=$1 field=$2
  python3 -c '
import json, os, sys
d = json.load(open(os.path.expanduser("~/.claude-personal/settings.local.json")))
v = d["projects"][sys.argv[1]]["github"][sys.argv[2]]
if isinstance(v, list): print(" ".join(v))
else: print(v)
' "$key" "$field"
}
```

## Preflight (always run before any gh write)

```sh
KEY=$(project_key)
OWNER=$(gh_cfg "$KEY" owner)
REPO=$(gh_cfg "$KEY" repo)
NWO=$(gh_cfg "$KEY" nameWithOwner)
AUTH=$(gh_cfg "$KEY" authAccount)
HOST=$(gh_cfg "$KEY" authHost)

# 1. gh installed
gh --version >/dev/null

# 2. Right account active on the right host
ACTIVE=$(gh auth status --hostname "$HOST" 2>&1 | grep -oE "account [a-zA-Z0-9-]+" | awk '{print $2}' | head -1)
if [ "$ACTIVE" != "$AUTH" ]; then
  gh auth switch --hostname "$HOST" --user "$AUTH"
fi

# 3. Token has the scopes we need (repo, workflow at minimum)
gh auth status --hostname "$HOST" | grep -qE "Token scopes:.*repo" \
  || { echo "missing 'repo' scope — run: gh auth refresh -h $HOST -s repo,workflow,project,read:org"; exit 1; }

# 4. Repo reachable
gh repo view "$NWO" --json nameWithOwner >/dev/null \
  || { echo "cannot reach $NWO as $AUTH"; exit 1; }
```

## Running gh commands

Always pass `--repo "$NWO"` (or `-R "$NWO"`) so the command doesn't depend on cwd. This is the single biggest source of bugs — running `gh issue list` in a worktree that points at a different branch and getting confusing results.

| What you want | Use |
|---|---|
| `gh issue list` | `gh issue list -R "$NWO"` |
| `gh pr create` | `gh pr create -R "$NWO" --base "$(gh_cfg $KEY prTargetBranch)"` |
| `gh workflow run` | `gh workflow run -R "$NWO" <name>` |
| `gh api /repos/...` | `gh api repos/$NWO/...` |

## Protected-branch guard

Before any push, edit, or merge to a branch listed in `protectedBranches`, **stop and confirm with the user**. Defaults: `main` is always protected on personal projects. The aclim project additionally treats `refactor` as a soft-protected integration branch — open PRs to it, don't push directly.

```sh
CURRENT=$(git symbolic-ref --short HEAD 2>/dev/null)
for p in $(gh_cfg "$KEY" protectedBranches); do
  if [ "$CURRENT" = "$p" ]; then
    echo "ERROR: on protected branch '$p' for project '$KEY'. Switch to a feature branch first."
    exit 1
  fi
done
```

## Cross-skill references

- `github-issues` — use this skill's resolver to pick `--repo` and `authAccount` before any issue write.
- `task-start` / `task-completion` — call this skill first to resolve the right `defaultBranch` / `prTargetBranch` for branching and PR-target.
- `gcloud-auth` — sibling skill; same `projects.<key>` schema, different topic key (`gcloud` vs `github`).

## Adding GitHub config for a new project

When the user starts a new personal project, prompt for:

1. **owner** and **repo** (or `nameWithOwner`)
2. **defaultBranch** — confirm with `gh repo view <nwo> --json defaultBranchRef -q .defaultBranchRef.name`
3. **prTargetBranch** — same as default unless there's an active integration branch
4. **authAccount** — which `gh auth` login this repo belongs to; check `gh auth status --hostname github.com`
5. **protectedBranches** — at minimum `["main"]`; add `["main", "<integration>"]` if relevant

Then write the entry under `projects.<key>.github` in `~/.claude-personal/settings.local.json`.

## What not to do

- Don't run `gh issue create` / `gh pr create` without `--repo "$NWO"` — drifts when cwd is a worktree or sibling directory.
- Don't call `gh auth login` without `--hostname github.com` (memory: `feedback_gh_auth_hostname`).
- Don't edit `protectedBranches` directly — push to a feature branch and open a PR.
- Don't assume the gh-active account is correct — always check with `gh auth status --hostname` and switch if needed.
- Don't duplicate the GitHub fields in skill-local config; everything goes under `projects.<key>.github`.
