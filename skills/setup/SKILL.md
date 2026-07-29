---
name: setup
model: sonnet
description: >-
  The single setup command for the bench plugin. Writes the managed rules
  block into CLAUDE.md, collects the worktree prune-base setting, offers the
  deny-list, the statusline and the base-branch commit backstop, and records the
  version in a guard file. Idempotent. TRIGGER after `/plugin install`, when the
  SessionStart hook says setup is incomplete or the plugin was updated, or when
  the user says "set up bench". SKIP when the guard version already
  matches the installed version and the user has not asked to re-run.
tags: [audience/personal, portable/adapt]
---

# bench setup

The one command that makes a bench install complete. `/plugin install` lands the files; nothing else happens until this runs — rules are absent from `CLAUDE.md`, the statusline is unwired, and the `SessionStart` hook keeps nagging.

This is the only setup entry point.

## When to run

- Right after `/plugin install bench@josephi-bench` on a new machine.
- When the `SessionStart` hook injects context saying setup is incomplete or the plugin was updated. The hook has already shown the user the changelog; act on it.
- When the user says "set up bench" or "finish the bench install".
- After `/plugin marketplace update` — idempotent, so it only changes what's new.

## Steps

### 0. Resolve paths (cross-platform)

Must work on macOS, Linux, **and Windows** — don't assume a POSIX shell or `python3`.

- **CONFIG_DIR** — `CLAUDE_CONFIG_DIR` if set, else `~/.claude` (macOS/Linux) or `%USERPROFILE%\.claude` (Windows). This profile normally runs with `CLAUDE_CONFIG_DIR=~/.claude-personal`, so **never hardcode `~/.claude`** — read the variable.
- **PLUGIN_ROOT** — `CLAUDE_PLUGIN_ROOT` if set, else the newest version directory under `CONFIG_DIR/plugins/cache/*/bench/*/`. The plugin installs into a **version-namespaced cache**, not `CONFIG_DIR/plugins/bench/`.

```sh
node -e "const os=require('os'),fs=require('fs'),P=require('path');const cfg=process.env.CLAUDE_CONFIG_DIR||P.join(os.homedir(),'.claude');let r=process.env.CLAUDE_PLUGIN_ROOT||'';if(r===''){try{const c=P.join(cfg,'plugins','cache');const v=[];for(const m of fs.readdirSync(c)){try{for(const x of fs.readdirSync(P.join(c,m,'bench')))v.push([x,P.join(c,m,'bench',x)]);}catch{}}v.sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));r=v.length?v[v.length-1][1]:'';}catch{}}console.log('CONFIG_DIR='+cfg);console.log('PLUGIN_ROOT='+r);"
```

Use the printed values for every path below, via the Read/Write/Edit tools. If `PLUGIN_ROOT` is empty or `PLUGIN_ROOT/.claude-plugin/plugin.json` is missing, the plugin isn't installed — stop and direct the user to `/plugin marketplace add josephi/claude-tools` then `/plugin install bench@josephi-bench`.

### 1. Decide whether to run

Read the guard file: `CLAUDE_PLUGIN_DATA/.initialized`, falling back to `CONFIG_DIR/plugins/data/bench-josephi-bench/.initialized` (the same path the `SessionStart` hook checks). Its contents are the plugin version last set up here.

- **Matches the installed version** → already done. Ask whether to re-run; exit cleanly if they decline.
- **Differs** → the plugin was updated. Proceed; step 8 reports what changed.
- **Absent** → first run. Proceed.

### 2. Install the rules block into `CLAUDE.md`

Read every `PLUGIN_ROOT/rules/*.md`, strip the YAML frontmatter from each (the leading `---` through the closing `---`, plus the blank line that usually follows), sort by filename `a-z`, and join the bodies with one blank line between. That is the **inner block content**. This is the same compilation `generate-claude-md.mjs` performs for the repo's own `CLAUDE.md`.

Then open `CONFIG_DIR/CLAUDE.md`, creating it with a `# Global Principles` header if absent.

If the marker pair exists, replace everything between and including the markers; otherwise append with one blank line before it:

```
<!-- BEGIN bench rules -->
<!-- Managed by the bench plugin. Do not edit by hand — run /bench:setup to refresh. -->
<!-- plugin-version: 1.1.0  installed-at: 2026-07-29T09:15:00Z -->

<inner block content>

<!-- END bench rules -->
```

Use the real `version` from `PLUGIN_ROOT/.claude-plugin/plugin.json` and the current ISO-8601 UTC timestamp.

Personal content the user keeps "above the auto-generated section" sits above the markers, so it survives untouched.

**Conflict safety:** if the existing block contains anything that doesn't look generated — the user added prose between the markers — show a diff and confirm before overwriting. Don't silently destroy hand-edits.

### 3. Collect env vars

Read `PLUGIN_ROOT/install-questions.json`. Each entry:

```json
{
  "name": "CLAUDE_PRUNE_BASE",
  "prompt": "Base branch(es) for git worktrees",
  "default": "main",
  "allowed": ["main", "master"],
  "multiple": true,
  "secret": false,
  "optional": false
}
```

Read `CONFIG_DIR/settings.local.json` (treat a missing file as `{ "env": {} }`). A key needs prompting when it is absent from `env`, empty, or still a placeholder like `<your-branch>`. Skip keys that already hold real values.

Prompt with `AskUserQuestion`, honoring:

- `default` — offer it first, labelled `(default: <value>)`.
- `allowed` — a single-choice list.
- `multiple: true` — ask with `multiSelect: true` and store the chosen values **comma-joined** (`main,master`); consumers split on comma. Preserve `allowed` order, drop duplicates. Used by `CLAUDE_PRUNE_BASE`, where someone whose repos use both `main` and `master` selects both, so the worktree auto-prune treats a branch merged into *either* as prunable.
- `secret: true` — accept the value but never echo it into output, later prompts, or the summary.
- `optional: true` — offer "Skip"; if chosen, don't write the key.

Merge into the `env` block: add new keys, overwrite placeholders, and preserve every other top-level key and unrelated env entry. **`projects` is a sibling of `env` in this same file** — the personal-projects registry. Never rewrite the whole file; edit the `env` block in place or you will destroy it.

**Confirm with the user before prompting for the first secret.** The `SessionStart` hook can send you here unattended, and a wall of credential prompts nobody asked for is not acceptable.

There are no API tokens in the default question set: personal projects authenticate through `gh auth login` and `gcloud auth login`, and per-project settings live in `projects.<key>` (see the `personal-projects` skill), not here.

### 4. Offer the recommended deny-list

If `settings.local.json` has no `permissions.deny`, offer to merge the list from `PLUGIN_ROOT/claude/settings.json`'s `permissions.deny`. Ask before applying.

If a `permissions.deny` block already exists, **do not touch it** — the user has their own. Show what's recommended and let them merge by hand.

### 5. Offer the statusline

The statusline shows task context and — critically — whether bench's hooks are live. That warning can't come from a hook: with `disableAllHooks: true` no hook runs to report it. The statusline is a separate subsystem that still renders, so it's the only channel that can report its own absence.

Ask first. If yes, install the launcher:

```sh
node <PLUGIN_ROOT>/skills/setup/scripts/install-launcher.mjs
```

It writes `CONFIG_DIR/bench-statusline.mjs` and prints the exact `statusLine` command to use. Then write into `CONFIG_DIR/settings.local.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<CONFIG_DIR>/bench-statusline.mjs\""
  }
}
```

**Point it at the launcher, never at the plugin cache directly.** The cache is version-namespaced (`plugins/cache/<marketplace>/bench/<version>/`), so a direct path bakes a version into the user's settings and the statusline breaks on the next update. The launcher resolves the newest installed version at run time, so this line is written once and never needs revisiting. It also prints nothing when the plugin is uninstalled, leaving a blank statusline rather than an error.

Do **not** write `${CLAUDE_PLUGIN_ROOT}` either — that expands for hook commands, not for `statusLine`.

If an existing `statusLine` already points at a `bench/<version>/` path from an older setup, replace it with the launcher. If it points at something that isn't bench, leave it alone and show the user the command instead.

Output looks like:

```
#42 | refactor/42_extract-rabbitmq-producer | <- main | pushed
main | no task | ! hooks OFF (disableAllHooks in settings.json)
```

### 6. Offer the base-branch commit backstop

The `PreToolUse` guard blocks *writes* on a base branch, which means it has to work out what a shell command is about to do. Reading a shell line is not a solved problem — `$'…'`, quoted command substitutions, heredocs — so that half is best-effort and bypassable through quoting.

A `pre-commit` hook needs none of that. By the time it runs, git already knows the branch, so it holds no matter how the file was written — heredoc, nested interpreter, an editor outside Claude entirely. It also catches the failure that actually matters: a *commit* landing on `main`, rather than a modified working tree.

Ask, then install per repository the user names (it is a repo-local file, so there is no global switch):

```sh
cp "<PLUGIN_ROOT>/hooks/lib/base-branch-precommit.sh" <repo>/.git/hooks/pre-commit
chmod +x <repo>/.git/hooks/pre-commit
```

If a `pre-commit` hook already exists, do **not** overwrite it — show the user the two files and let them decide. Their existing hook may be the project's lint or test gate.

Same escape hatch as the guard (`BENCH_ALLOW_BASE_EDITS=1`), plus `git commit --no-verify`. Record each installed path so uninstall can remove it, and note that `.git/hooks/` is not covered by the `settings.local.json` record.

### 7. Record what you wrote

Uninstall has to leave the user with exactly what they had, which means knowing which entries in `settings.local.json` are ours. JSON forbids comments, and the alternatives are worse: a `"$comment"` key inside `env` gets exported as an environment variable, and a sentinel string inside `permissions.deny` would sit in a security-relevant list pretending to be a rule. Neither can express per-key ownership anyway.

So record it in a side-car at `CLAUDE_PLUGIN_DATA/installed.json`.

As you go through steps 3 to 6, note for **each** entry which of three states applies:

| State | When | Uninstall |
|---|---|---|
| `added` | the key did not exist | removes it |
| `replaced` | the key held a placeholder you overwrote | **restores `previous`** |
| *unrecorded* | the user already had a real value, so you skipped it | never touches it |

**Only record what you actually wrote.** A key you skipped because the user already had a good value must not appear in the record, or uninstall will delete something that was never ours.

Also record what you wrote for every entry — `wroteValue` for normal keys, `wroteHash` for secrets (below). Uninstall compares it against the current value and refuses to act when they differ, because that means the user edited it after setup.

Write it by piping JSON into the `record` subcommand:

```sh
echo '{
  "pluginVersion": "<VERSION>",
  "settingsLocal": {
    "env": {
      "CLAUDE_PRUNE_BASE": { "action": "added", "wroteValue": "main,master" }
    },
    "permissionsDeny": { "action": "appended", "entries": ["Bash(rm -rf*)", "Bash(sudo*)"] },
    "statusLine": { "action": "added", "wroteValue": "node <LAUNCHER_PATH>" }
  },
  "claudeMd": { "action": "markerBlock" }
}' | node <PLUGIN_ROOT>/skills/setup/scripts/ownership.mjs record
```

Include only the sections you actually touched. Omit `permissionsDeny` when the user already had a deny list, and omit `statusLine` when they declined it.

**For any `secret: true` question, use `wroteHash`, never `wroteValue`.** Get the hash without echoing the value:

```sh
node -e "const{createHash}=require('crypto');process.stdout.write('sha256:'+createHash('sha256').update(process.env.V,'utf8').digest('hex'))"
```

passing the value via an env var rather than an argument, so it stays out of the process list and shell history. Uninstall then still gets its "did the user change this since setup?" guard — a rotated secret is left alone instead of deleted — without the plaintext ever being written to disk.

Re-running setup merges into the existing record. `action` and `previous` keep their first observation, so a second run cannot downgrade a `replaced` into an `added`; `wroteValue`/`wroteHash` take the latest, so a key you legitimately rewrote does not later look user-modified to uninstall.

### 8. Write the guard file and report

Write the **installed version** into the guard file — not an empty touch. `hooks/check-init.mjs` compares it against `plugin.json`, which is what lets the nag re-fire after an update and stay quiet otherwise, and what scopes the changelog range.

```sh
node -e "const os=require('os'),fs=require('fs'),P=require('path');const cfg=process.env.CLAUDE_CONFIG_DIR||P.join(os.homedir(),'.claude');const data=process.env.CLAUDE_PLUGIN_DATA||P.join(cfg,'plugins','data','bench-josephi-bench');const ver=require(P.join(process.env.CLAUDE_PLUGIN_ROOT||'<PLUGIN_ROOT>','.claude-plugin','plugin.json')).version;fs.mkdirSync(data,{recursive:true});fs.writeFileSync(P.join(data,'.initialized'),ver);console.log('wrote '+P.join(data,'.initialized')+' = '+ver);"
```

Substitute `<PLUGIN_ROOT>` if `CLAUDE_PLUGIN_ROOT` isn't in the environment. **Record the guard version from step 1 before overwriting it** — the report needs it.

Then keep the report short and specific:

- Rules installed into `CONFIG_DIR/CLAUDE.md`.
- Env vars set and skipped, **secrets redacted**.
- Deny-list, statusline and pre-commit backstop: applied, declined, or already present.
- Guard file now at v`<installed>`, and the ownership record written so uninstall can undo exactly these changes.

**On an update, summarise what changed.** The `SessionStart` hook already printed the changelog for this range, so don't repeat it — say which versions were applied and call out anything needing user action. To recover the entries yourself:

```sh
node -e "const{pathToFileURL}=require('url');import(pathToFileURL('<PLUGIN_ROOT>/hooks/lib/changelog.mjs').href).then(m=>console.log(m.renderUpdateReport(m.loadChangelog('<PLUGIN_ROOT>/CHANGELOG.md'),'<GUARD_VERSION>','<INSTALLED_VERSION>')??'(no entries)'))"
```

(`pathToFileURL`, not a bare path: `import('C:\…')` is not a valid specifier on Windows, and the backslashes would be eaten inside the quoted `-e` string.)

Then the things this skill cannot do:

- **Authenticate the CLIs** — `gh auth login` and `gcloud auth login` are interactive and per-user. The `gcloud-auth` skill handles re-auth once the first login exists.
- **Register projects.** The `projects.<key>` registry starts empty; run the `personal-projects` skill to add the first one, which is what `github-context`, `deploy-status`, `chrome-debug` and `gcloud-auth` all read.
- **Restart Claude Code** so the guard file, env vars, and statusline take effect.

## What this skill does NOT do

- Install the plugin — that's `/plugin install`.
- Uninstall — that is `/bench:uninstall` plus `/plugin uninstall`.
- Modify `CONFIG_DIR/settings.json` (the non-local one). Everything it writes goes to `settings.local.json`, which the plugin never overwrites.
