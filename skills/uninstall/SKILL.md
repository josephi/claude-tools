---
name: uninstall
model: sonnet
disable-model-invocation: true
description: >-
  Undo what `/claude-tools:setup` wrote, leaving the user with what they had before.
  Removes the managed rules block from CLAUDE.md and reverts only the
  settings.local.json entries the plugin recorded as its own, restoring
  placeholders it overwrote. TRIGGER when the user uninstalls the claude-tools plugin
  or asks to remove its rules and settings. SKIP when neither the marker block nor
  the ownership record is present.
tags: [audience/personal, portable/adapt]
---

# claude-tools uninstall

Reverses `/claude-tools:setup`. The goal is not "delete everything claude-tools-shaped" but "leave the user with what they had before setup ran". Those differ wherever the user already had a value, or edited one afterwards.

Run this **before** `/plugin uninstall`, while the plugin files are still on disk.

## What it can and cannot know

`/claude-tools:setup` records every entry it writes to `settings.local.json` in `CLAUDE_PLUGIN_DATA/installed.json`, with one of three states per key:

| State | Meaning | Action here |
|---|---|---|
| `added` | the key did not exist before setup | remove it |
| `replaced` | the key held a placeholder setup overwrote | restore `previous` |
| *unrecorded* | the user already had a real value | never touch it |

Without that record, ownership is unknowable. **Do not guess.** A key named `JIRA_URL` may well have been there before the plugin. When the record is missing, remove the CLAUDE.md block, list what a claude-tools setup would typically have written, and let the user decide by hand.

## Steps

> **Config dir (cross-platform).** `CONFIG_DIR` is `CLAUDE_CONFIG_DIR` if set, else `~/.claude` (macOS/Linux) or `%USERPROFILE%\.claude` (Windows). Every `~/.claude/…` below means `CONFIG_DIR/…`. Resolve `PLUGIN_ROOT` the same way step 0 of `/claude-tools:setup` does.

### 1. Show what would change

```sh
node <PLUGIN_ROOT>/skills/setup/scripts/ownership.mjs plan
```

This changes nothing. It prints the env keys to remove, the ones to restore and to what, the deny rules to remove, whether the statusline goes, and — importantly — everything it is **leaving alone** and why.

Show that to the user and get confirmation before applying. This touches credentials, so it gets a gate.

If it reports no record, skip to step 3 and say plainly that settings entries were left for the user to review.

### 2. Revert the recorded settings

```sh
node <PLUGIN_ROOT>/skills/setup/scripts/ownership.mjs revert --apply
```

Guarantees, all covered by tests:

- Only recorded keys are touched. A key the user already had is never in the record.
- A key whose current value no longer matches what setup wrote is **skipped** — the user edited it since, and removing it would destroy that edit.
- `permissions.deny` entries are removed **by value**, so rules the user added to the same array survive. An array emptied by this is dropped rather than left as `[]`.
- A `statusLine` the user repointed at something else is left alone.
- Every unrelated top-level key in `settings.local.json` is preserved.

The record is deleted only when the settings file was actually rewritten, so a failed revert can be retried rather than losing the ownership information. A successful run makes a second run a safe no-op.

Then delete the plugin's state files from `CLAUDE_PLUGIN_DATA` (fallback: `CONFIG_DIR/plugins/data/claude-tools-josephi-claude-tools/`):

```sh
rm CLAUDE_PLUGIN_DATA/.initialized CLAUDE_PLUGIN_DATA/.changelog-seen
```

They live outside the version-namespaced cache precisely so they survive `/plugin uninstall` — which means leaving them makes a later reinstall look already set up: the `SessionStart` nag stays silent and the statusline reports healthy while the rules block is gone and no env vars are set. Deleting them re-arms the setup nag for the next install. (`installed.json` was already removed by the revert in step 2.)

Then remove the statusline launcher, if setup installed one:

```sh
rm CONFIG_DIR/claude-tools-statusline.mjs
```

It is a tiny generated file owned entirely by the plugin (its header says so), and it is inert once the plugin is gone — it prints nothing when no version is installed. Removing it is tidiness rather than necessity, so skip it if the user has edited it.

### 3. Remove the managed rules block from `CLAUDE.md`

Read `CONFIG_DIR/CLAUDE.md`. If it does not exist, there is nothing to do.

Find everything from `<!-- BEGIN claude-tools rules -->` through `<!-- END claude-tools rules -->`, inclusive, with a non-greedy match. If present:

- Remove the matched block.
- Collapse a resulting double blank line to one.
- Write the file back and report the line count removed.

Surrounding content is preserved exactly, including anything the user wrote above the block. If the markers are absent, say so and leave the file alone.

### 4. Remove the base-branch `pre-commit` hooks

Setup offers to install `hooks/lib/base-branch-precommit.sh` as `<repo>/.git/hooks/pre-commit`, per repository. Those live outside `CONFIG_DIR`, so the `settings.local.json` record does not cover them and they survive `/plugin uninstall` — leaving a repo that refuses commits on `master` with nothing installed to explain why.

For each path recorded in step 2's ownership record, check the file still matches the shipped script before deleting it. If it differs, the user has edited it or a project hook replaced it: leave it and report the path.

```sh
rm <repo>/.git/hooks/pre-commit
```

If no paths were recorded, say so — either setup never installed one, or it was declined.

### 5. Report and hand off

State what was removed, what was restored, and what was deliberately left. Include the reasons: "user-modified since setup" is useful information, not a failure.

Then the parts this cannot do:

- **`/plugin uninstall claude-tools@josephi-claude-tools`** removes the plugin itself, including its hooks. Until that runs, the hooks are still active.
- **`CONFIG_DIR/settings.json`** is not touched. Everything setup wrote went to `settings.local.json`.
- **`projects.<key>`** in `settings.local.json` is the user's own project registry, written by the `personal-projects` skill rather than by setup. Never remove it.
- **The `chrome-devtools` MCP server** is declared in the plugin's `.mcp.json`, so it disappears with `/plugin uninstall`. Nothing to undo by hand.
- **`gh` and `gcloud` credentials** were never written by this plugin. Leave them.
- **Restart Claude Code** so the removals take effect.

## What this skill does NOT do

- Does not remove the plugin — that's `/plugin uninstall`.
- Does not touch anything absent from the ownership record. Silence there means "not ours".
- Does not remove skills, agents, or commands from `CONFIG_DIR`. This plugin never copies any there — they load from the plugin cache, which `/plugin uninstall` clears.
