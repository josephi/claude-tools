---
name: setup
model: sonnet
description: >-
  The single setup command for the claude-tools plugin. Writes the managed rules
  block into CLAUDE.md, collects Jira/Confluence/AWS/Coralogix/Slack env vars,
  offers the deny-list and statusline, removes any leftover sync.mjs install, and
  records the version in a guard file. Idempotent. TRIGGER after `/plugin
  install`, when the SessionStart hook says setup is incomplete or the plugin was
  updated, or when the user says "set up claude-tools". SKIP when the guard version
  already matches the installed version and the user has not asked to re-run.
tags: [audience/work, portable/none]
---

# Tip-sync setup

The one command that makes a claude-tools install complete. `/plugin install` lands the files; nothing else happens until this runs — rules are absent from `CLAUDE.md`, MCP servers have no credentials, and the `SessionStart` hook keeps nagging.

This is the only setup entry point. The former `/claude-tools-init`, `/claude-tools-rules-install`, and the `/setup` command alias were all folded in here.

## When to run

- Right after `/plugin install claude-tools@josephi-claude-tools` on a new machine.
- When the `SessionStart` hook injects context saying setup is incomplete or the plugin was updated. The hook has already shown the user the changelog; act on it.
- When the user says "set up claude-tools", "finish claude-tools install", or "configure claude-tools credentials".
- After `/plugin marketplace update` — idempotent, so it only changes what's new.

## Steps

### 0. Resolve paths (cross-platform)

Must work on macOS, Linux, **and Windows** — don't assume a POSIX shell (a colleague may be on PowerShell, not Git Bash) or `python3`.

- **CONFIG_DIR** — `CLAUDE_CONFIG_DIR` if set, else `~/.claude` (macOS/Linux) or `%USERPROFILE%\.claude` (Windows). Every `~/.claude/…` path below means `CONFIG_DIR/…`.
- **PLUGIN_ROOT** — `CLAUDE_PLUGIN_ROOT` if set, else the newest version directory under `CONFIG_DIR/plugins/cache/*/claude-tools/*/`. The plugin installs into a **version-namespaced cache**, not `CONFIG_DIR/plugins/claude-tools/`.

```sh
node -e "const os=require('os'),fs=require('fs'),P=require('path');const cfg=process.env.CLAUDE_CONFIG_DIR||P.join(os.homedir(),'.claude');let r=process.env.CLAUDE_PLUGIN_ROOT||'';if(r===''){try{const c=P.join(cfg,'plugins','cache');const v=[];for(const m of fs.readdirSync(c)){try{for(const x of fs.readdirSync(P.join(c,m,'claude-tools')))v.push([x,P.join(c,m,'claude-tools',x)]);}catch{}}v.sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));r=v.length?v[v.length-1][1]:'';}catch{}}console.log('CONFIG_DIR='+cfg);console.log('PLUGIN_ROOT='+r);"
```

Use the printed values for every path below, via the Read/Write/Edit tools. If `PLUGIN_ROOT` is empty or `PLUGIN_ROOT/.claude-plugin/plugin.json` is missing, the plugin isn't installed — stop and direct the user to `/plugin marketplace add` then `/plugin install claude-tools@josephi-claude-tools`.

### 1. Decide whether to run

Read the guard file: `CLAUDE_PLUGIN_DATA/.initialized`, falling back to `CONFIG_DIR/plugins/data/claude-tools-josephi-claude-tools/.initialized` (the same path the `SessionStart` hook checks). Its contents are the plugin version last set up here.

- **Matches the installed version** → already done. Ask whether to re-run; exit cleanly if they decline.
- **Differs** → the plugin was updated. Proceed; step 10 reports what changed.
- **Absent** → first run. Proceed.

### 2. Remove any leftover `sync.mjs` install

Before the plugin existed, `sync.mjs` copied skills, agents, and commands into `CONFIG_DIR`. Anyone who ran it is loading **every skill twice** — once as `jira`, once as `claude-tools:jira` — which roughly doubles the routing context in every conversation and lets two copies of the same skill disagree. Deletions never propagated either.

Check first, in dry-run:

```sh
node <PLUGIN_ROOT>/skills/setup/scripts/uninstall-legacy.mjs --json
```

If `manifestPresent` is false, skip to step 3 — this machine never used the legacy path.

Otherwise show the user the counts and ask before removing. Then:

```sh
node <PLUGIN_ROOT>/skills/setup/scripts/uninstall-legacy.mjs --apply
```

The script only deletes paths recorded in `.ai-tools-manifest.json`, so anything the user added to `CONFIG_DIR` themselves is untouched. If `manifestMalformed` is true it removes nothing — say so and let the user clean up by hand rather than guessing at ownership.

It deliberately does **not** edit `CLAUDE.md`; step 3 rewrites that file anyway. Carry the reported `legacyRulesSection` into step 3.

### 3. Install the rules block into `CLAUDE.md`

Read every `PLUGIN_ROOT/rules/*.md`, strip the YAML frontmatter from each (the leading `---` through the closing `---`, plus the blank line that usually follows), sort by filename `a-z`, and join the bodies with one blank line between. That is the **inner block content**.

Then open `CONFIG_DIR/CLAUDE.md`, creating it with a `# Global Principles` header if absent.

**First, remove any legacy `sync.mjs` rules section.** Users migrating from `sync.mjs` have a `# Rules` section it concatenated in. Left in place, the managed block lands below it and every rule appears twice (~25 KB of bloat, and it trips the `/doctor` large-CLAUDE.md warning).

- Find a line matching `^# Rules$` exactly, searching only *above* `<!-- BEGIN claude-tools rules -->` if that marker exists, else the whole file.
- Remove from that heading through the line before the marker, or through end-of-file if there's no marker. Leave a preceding `---` and blank line — they're the structural separator.
- Collapse any run of three or more blank lines to one.
- Personal content the user put "above the auto-generated section" sits above `# Rules`, so it survives untouched.

**Then write the managed block.** If the marker pair exists, replace everything between and including the markers; otherwise append with one blank line before it:

```
<!-- BEGIN claude-tools rules -->
<!-- Managed by the claude-tools plugin. Do not edit by hand — run /claude-tools:setup to refresh. -->
<!-- plugin-version: 0.6.8  installed-at: 2026-07-28T09:15:00Z -->

<inner block content>

<!-- END claude-tools rules -->
```

Use the real `version` from `PLUGIN_ROOT/.claude-plugin/plugin.json` and the current ISO-8601 UTC timestamp.

**Conflict safety:** if the existing block contains anything that doesn't look generated — the user added prose between the markers — show a diff and confirm before overwriting. Don't silently destroy hand-edits.

### 4. Collect env vars

Read `PLUGIN_ROOT/install-questions.json`. Each entry:

```json
{
  "name": "JIRA_PERSONAL_TOKEN",
  "prompt": "Jira personal access token",
  "default": "<value>",
  "allowed": ["a", "b"],
  "multiple": true,
  "secret": true,
  "optional": true
}
```

Read `CONFIG_DIR/settings.local.json` (treat a missing file as `{ "env": {} }`). A key needs prompting when it is absent from `env`, empty, or still a placeholder like `<your-token>`. Skip keys that already hold real values.

Prompt with `AskUserQuestion`, honoring:

- `default` — offer it first, labelled `(default: <value>)`.
- `allowed` — a single-choice list.
- `multiple: true` — ask with `multiSelect: true` and store the chosen values **comma-joined** (`dev,master`); consumers split on comma. Preserve `allowed` order, drop duplicates. Used by `CLAUDE_PRUNE_BASE`, where someone whose repos use both `dev` and `master` selects both, so the worktree auto-prune treats a branch merged into *either* as prunable.
- `secret: true` — accept the value but never echo it into output, later prompts, or the summary.
- `optional: true` — offer "Skip"; if chosen, don't write the key.

Merge into the `env` block: add new keys, overwrite placeholders, and preserve every other top-level key and unrelated env entry.

**Confirm with the user before prompting for the first secret.** The `SessionStart` hook can send you here unattended, and a wall of credential prompts nobody asked for is not acceptable.

### 5. Offer the recommended deny-list

If `settings.local.json` has no `permissions.deny`, offer to merge the list from `PLUGIN_ROOT/claude/settings.json`'s `permissions.deny`. Ask before applying.

If a `permissions.deny` block already exists, **do not touch it** — the user has their own. Show what's recommended and let them merge by hand.

### 6. Offer the statusline

The statusline shows task context and — critically — whether claude-tools's hooks are live. That warning can't come from a hook: with `disableAllHooks: true` no hook runs to report it. The statusline is a separate subsystem that still renders, so it's the only channel that can report its own absence.

Ask first. If yes, install the launcher:

```sh
node <PLUGIN_ROOT>/skills/setup/scripts/install-launcher.mjs
```

It writes `CONFIG_DIR/claude-tools-statusline.mjs` and prints the exact `statusLine` command to use. Then write into `CONFIG_DIR/settings.local.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<CONFIG_DIR>/claude-tools-statusline.mjs\""
  }
}
```

**Point it at the launcher, never at the plugin cache directly.** The cache is version-namespaced (`plugins/cache/<marketplace>/claude-tools/<version>/`), so a direct path bakes a version into the user's settings and the statusline breaks on the next update. The launcher resolves the newest installed version at run time, so this line is written once and never needs revisiting. It also prints nothing when the plugin is uninstalled, leaving a blank statusline rather than an error.

Do **not** write `${CLAUDE_PLUGIN_ROOT}` either — that expands for hook commands, not for `statusLine`.

If an existing `statusLine` already points at a `claude-tools/<version>/` path from an older setup, replace it with the launcher. If it points at something that isn't claude-tools, leave it alone and show the user the command instead.

Output looks like:

```
SYNC-26478 | feature/sync-26478_ns-account-nightly | <- master | pushed
master | no task | ! hooks OFF (disableAllHooks in settings.json)
```

### 7. Offer the base-branch commit backstop

The `PreToolUse` guard blocks *writes* on a base branch, which means it has to work out what a shell command is about to do. Review has repeatedly shown that reading a shell line is not a solved problem — `$'…'`, quoted command substitutions, heredocs — so the guard is best-effort and bypassable through quoting.

A `pre-commit` hook needs none of that. By the time it runs, git already knows the branch, so it holds no matter how the file was written — heredoc, nested interpreter, an editor outside Claude entirely. It also catches the failure that actually matters: a *commit* landing on `master`, rather than a modified working tree.

Ask, then install per repository the user names (it is a repo-local file, so there is no global switch):

```sh
cp "<PLUGIN_ROOT>/hooks/lib/base-branch-precommit.sh" <repo>/.git/hooks/pre-commit
chmod +x <repo>/.git/hooks/pre-commit
```

If a `pre-commit` hook already exists, do **not** overwrite it — show the user the two files and let them decide. Their existing hook may be the project's lint or test gate.

Same escape hatch as the guard (`CLAUDE_TOOLS_ALLOW_BASE_EDITS=1`), plus `git commit --no-verify`. Record each installed path so uninstall can remove it, and note that `.git/hooks/` is not covered by the `settings.local.json` record.

### 8. Record what you wrote

Uninstall has to leave the user with exactly what they had, which means knowing which entries in `settings.local.json` are ours. JSON forbids comments, and the alternatives are worse: a `"$comment"` key inside `env` gets exported as an environment variable, and a sentinel string inside `permissions.deny` would sit in a security-relevant list pretending to be a rule. Neither can express per-key ownership anyway.

So record it in a side-car at `CLAUDE_PLUGIN_DATA/installed.json` — the same approach as `.ai-tools-manifest.json`, which is what let the legacy cleanup remove 41 paths without touching skills the user added.

As you go through steps 4 to 7, note for **each** entry which of three states applies:

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
      "JIRA_URL": { "action": "added", "wroteValue": "https://jira.tipalti.com:7000" },
      "CLAUDE_PRUNE_BASE": { "action": "replaced", "previous": "<your-branch>", "wroteValue": "dev,master" },
      "JIRA_PERSONAL_TOKEN": { "action": "added", "wroteHash": "sha256:<hash>" }
    },
    "permissionsDeny": { "action": "appended", "entries": ["Bash(rm -rf*)", "Bash(sudo*)"] },
    "statusLine": { "action": "added", "wroteValue": "node <LAUNCHER_PATH>" }
  },
  "claudeMd": { "action": "markerBlock" }
}' | node <PLUGIN_ROOT>/skills/setup/scripts/ownership.mjs record
```

Include only the sections you actually touched. Omit `permissionsDeny` when the user already had a deny list, and omit `statusLine` when they declined it.

**For every `secret: true` question, use `wroteHash`, never `wroteValue`.** Get the hash without echoing the token:

```sh
node -e "const{createHash}=require('crypto');process.stdout.write('sha256:'+createHash('sha256').update(process.env.V,'utf8').digest('hex'))"
```

passing the value via an env var rather than an argument, so it stays out of the process list and your shell history. Uninstall then still gets its "did the user change this since setup?" guard — a rotated token is left alone instead of deleted — without the plaintext ever being written to disk.

Re-running setup merges into the existing record. `action` and `previous` keep their first observation, so a second run cannot downgrade a `replaced` into an `added`; `wroteValue`/`wroteHash` take the latest, so a key you legitimately rewrote does not later look user-modified to uninstall.

### 9. Write the guard file

Write the **installed version** into the guard file — not an empty touch. `hooks/check-init.mjs` compares it against `plugin.json`, which is what lets the nag re-fire after an update and stay quiet otherwise, and what scopes the changelog range in step 10.

```sh
node -e "const os=require('os'),fs=require('fs'),P=require('path');const cfg=process.env.CLAUDE_CONFIG_DIR||P.join(os.homedir(),'.claude');const data=process.env.CLAUDE_PLUGIN_DATA||P.join(cfg,'plugins','data','claude-tools-josephi-claude-tools');const ver=require(P.join(process.env.CLAUDE_PLUGIN_ROOT||'<PLUGIN_ROOT>','.claude-plugin','plugin.json')).version;fs.mkdirSync(data,{recursive:true});fs.writeFileSync(P.join(data,'.initialized'),ver);console.log('wrote '+P.join(data,'.initialized')+' = '+ver);"
```

Substitute `<PLUGIN_ROOT>` if `CLAUDE_PLUGIN_ROOT` isn't in the environment. **Record the guard version from step 1 before overwriting it** — step 10 needs it.

### 10. Report

Keep it short and specific:

- Rules installed, and whether a legacy `# Rules` section was removed (with its line count).
- Legacy install removed — skills / agents / commands counts — or "none found".
- Env vars set and skipped, **secrets redacted**.
- Deny-list and statusline: applied, declined, or already present.
- Guard file now at v`<installed>`, and the ownership record written so uninstall can undo exactly these changes.

**On an update, summarise what changed.** The `SessionStart` hook already printed the changelog for this range, so don't repeat it — say which versions were applied and call out anything needing user action. To recover the entries yourself:

```sh
node -e "const{pathToFileURL}=require('url');import(pathToFileURL('<PLUGIN_ROOT>/hooks/lib/changelog.mjs').href).then(m=>console.log(m.renderUpdateReport(m.loadChangelog('<PLUGIN_ROOT>/CHANGELOG.md'),'<GUARD_VERSION>','<INSTALLED_VERSION>')??'(no entries)'))"
```

(`pathToFileURL`, not a bare path: `import('C:\…')` is not a valid specifier on Windows, and the backslashes would be eaten inside the quoted `-e` string.)

Then the two things this skill cannot do:

- **Enable the claude.ai-hosted MCP integrations** at https://claude.ai/settings/integrations — **Jira on-prem (Workato)** for `jira` / `jira-context`, **Confluence on-prem (Workato)** for `create-rca`, and **Slack** for `task-completion`'s PR announcements. Per-user OAuth, so the plugin can't ship them.
- **Restart Claude Code** so the guard file, env vars, and statusline take effect.

## What this skill does NOT do

- Install the plugin — that's `/plugin install`.
- Uninstall — that is `/claude-tools:uninstall` plus `/plugin uninstall`.
- Modify `CONFIG_DIR/settings.json` (the non-local one). Everything it writes goes to `settings.local.json`, which the plugin never overwrites.
