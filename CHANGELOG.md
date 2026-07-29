# Changelog

All notable changes to the `claude-tools` plugin.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `SessionStart` hook reads this file and shows every entry between the last-initialized version and the newly installed one. Two things are required of every released version, and `scripts/lint.mjs` fails the build without them:

1. **A `## [x.y.z]` heading.** No section means the post-update report shows nothing.
2. **A `> one-line TL;DR` immediately under that heading.** The report leads with these. A full entry is too long to scan at session start, so the one-liner is what actually gets read; write it for someone who has not seen the diff.

Section headings (`### Added`, `### Fixed`, …) are rendered with an emoji in the report, so keep to the Keep a Changelog set.

## [1.1.0] - 2026-07-29

> The plugin now enforces its own conventions through hooks instead of asking the model to remember them, and the five project-aware skills finally ship.

### Added

- **A hook system, ported from the work plugin and retargeted at this toolchain.** Five hooks, wired through `hooks/hooks.json`:

  `guard` denies `Edit`/`Write`/`MultiEdit`/`NotebookEdit` while HEAD is on a base branch, and reads `Bash` commands for write targets (`>`, `>>`, `tee`, `sed -i`, `cp`/`mv` destinations, `dd of=`) so a redirect into a base-branch checkout is caught too. The shell half is a deterrent rather than a gate — the source says so plainly, because a maintainer who believes otherwise stops checking. The gate is the optional `pre-commit` backstop, which needs no shell parsing because git already knows the branch by then.

  `route` matches the submitted prompt against `hooks/routing.json` and injects a directive naming the skill or agent that should handle it. This exists because the tools-first rule sits in `CLAUDE.md`, the lowest-salience position in the context window, competing with ~40 skill descriptions. `UserPromptSubmit` context lands next to the prompt instead, and only when a route actually matches.

  `nudge` attaches a convention reminder to a tool result at the moment the convention becomes relevant — editing a test file surfaces `testing-conventions`, adding a `logger.info` surfaces `log-standards`, committing surfaces the push half of `git-per-task`.

  `session-identity` names the session and the terminal tab from the branch. `check-init` asks for `setup` after an install or update, and renders this changelog.

- **`issue-ref`, replacing the work plugin's Jira-key detection.** A Jira key (`SYNC-27347`) carries its own signal in the letter prefix; a GitHub issue is a bare number and carries none. So detection is marker-driven — `#42`, `gh-42`, `issue 42` — and a bare number never matches. That drops the entire denylist the work version needed (`utf-8`, `sha-256`, `CVE-2024-1234`) because nothing matches without a marker in the first place.

- **The five project-aware skills**, previously stranded in an unmerged PR: `personal-projects` (the writer) plus `github-context`, `gcloud-auth`, `chrome-debug` and `deploy-status` (the readers), all sharing the `projects.<key>` registry in `<config-dir>/settings.local.json`. `.mcp.json` ships the `chrome-devtools` server alongside them.

- **`setup` and `uninstall` skills**, and a `CHANGELOG.md` the update report can read.

### Changed

- **`task-context` resolves projects from the registry rather than `service.json`.** Work repos carry a `service.json` at the root; personal repos do not. Resolution now mirrors `bin/project-key` (exact key on the repo basename, then `match` globs) but natively, because this runs on every prompt and `project-key` spawns bash plus python3.

- **`worktree-manager` uses `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PLUGIN_ROOT}`** instead of hardcoded `~/.claude/...` paths, which pointed at the wrong tree entirely given this profile lives in `~/.claude-personal`.

- **`deslop` fires when prose is merely requested**, not only when it is being drafted in front of you, and its trigger list names Discord and GitHub Issues rather than Slack and Jira.

- **`git-per-task` protects `develop` too**, and says that routing around the rule with a shell write is the same edit wearing a disguise.

## [1.0.0] - 2026-07-22

> First packaged release — the rules, skills and agents that had been living loose in the config dir, with an importer that pulls portable items from the work repo.

### Added

- Rules compiled into `CLAUDE.md` by `generate-claude-md.mjs`, covering execution style, git-per-task, PR review and comment scope, PR labels, prior-art-first, code comments, chat formatting, node import style, and build/test principles.
- Skills for the personal flow: `task-start`, `task-completion`, `plan-workflow`, `refactor-flow`, `github-issues`, `git-conventions`, `testing-conventions`, `log-standards`, `deslop`, `effort-estimation`, `worktree-manager`, the `review-*` checklists, and the monitor pair.
- Agents: `code-reviewer`, `senior-developer`, `solution-architect`, `qa-automation`, `scrum-master`, `business-analyst`.
- `import.mjs`, which pulls items from the work `ai-tools` repo by their `audience` / `portable` frontmatter, queues adaptations, and protects locally diverged files from being clobbered.
