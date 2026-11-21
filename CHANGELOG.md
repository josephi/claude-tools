# Changelog

All notable changes to the `bench` plugin.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `SessionStart` hook reads this file and shows every entry between the last-initialized version and the newly installed one. Two things are required of every released version, and `scripts/lint.mjs` fails the build without them:

1. **A `## [x.y.z]` heading.** No section means the post-update report shows nothing.
2. **A `> one-line TL;DR` immediately under that heading.** The report leads with these. A full entry is too long to scan at session start, so the one-liner is what actually gets read; write it for someone who has not seen the diff.

Section headings (`### Added`, `### Fixed`, …) are rendered with an emoji in the report, so keep to the Keep a Changelog set.

## [2.2.0] - 2026-11-21

> Bench cleans up after itself: merged worktrees and their Docker stacks go at session end, an open task's stacks stop, and everything works inside the claude-vm container.

### Added

- **Session-end cleanup** (`worktree-manager/scripts/session-end-cleanup.mjs`, replaces `prune-self-on-stop.mjs`). Removes every merged, clean worktree of the repo with its branch, and takes down its Compose stacks (containers, volumes, images they built). Stacks of worktrees this session worked in come down even when the task is still open; the worktree stays. Ownership comes from the compose working-dir label, so another session's stack is never touched. `<repo>/.claude/worktrees/<name>.keep-docker` keeps a worktree and its stack. Squash merges are detected. `--dry-run` shows the plan.
- **task-completion: cleanup after merge.** Stacks, worktree and branch go right after the merge, not only at session end.

### Changed

- **Skills call the plugin's own `bin/` helpers** (`${CLAUDE_SKILL_DIR}/../../bin/project-key`) instead of `~/bin`, which only existed on one Mac.
- **chrome-debug and gcloud-auth have a container path:** headless Chromium through the user-scope DevTools MCP, and `gcloud auth login --no-launch-browser` run by the user.
- **Status line command is home-relative** (`node "$HOME/…/bench-statusline.mjs"`), so one settings file works on a Mac and in a container; the ownership check treats both forms as the same command.
- **Worktree guard expands `~`** instead of letting a `~/…` path through unjudged.

## [2.1.0] - 2026-10-17

> Worktrees now live inside each repo at `.claude/worktrees/<name>`; the guard blocks `git worktree add` anywhere else.

### Added

- **Worktree location guard.** A `git worktree add` whose path is outside `<main-checkout>/.claude/worktrees` is denied, and the denial names the in-repo path to use instead. It applies to every project, including ones whose own docs show a sibling `../<repo>-<name>` path. `BENCH_ALLOW_ANY_WORKTREE_PATH=1` lifts it.
- **`git-per-task` rule: Worktrees section** stating the location.

### Fixed

- **Project lookup from a worktree.** `projectKey`, `bin/project-key`, `github-context` and `gcloud-auth` resolved the project from the checkout's folder name, so `.claude/worktrees/feat-42` matched nothing. They now use the main checkout's name.

## [2.0.0] - 2026-07-29

> Renamed from `claude-tools` to `bench` — the old name said nothing, and it prefixed every skill reference and env var.

### Changed

- **The plugin is now `bench`.** `claude-tools` carried no information: inside Claude Code every plugin is a Claude tool. The name appears constantly as a prefix, so a short, specific one pays for itself — `bench:task-start` rather than `claude-tools:task-start`, `BENCH_ALLOW_BASE_EDITS` rather than `CLAUDE_TOOLS_ALLOW_BASE_EDITS`.

  Everything downstream moved with it: the marketplace is `josephi-bench`, the install id is `bench@josephi-bench`, the plugin-data directory is `bench-josephi-bench`, the statusline launcher is `bench-statusline.mjs`, the managed `CLAUDE.md` block markers are `<!-- BEGIN bench rules -->`, and `rules/claude-tools-tools-first.md` became `rules/bench-tools-first.md`.

  Major rather than minor because the install identifier and all five env vars changed. Nothing had been installed from the old name yet, so there is no migration to perform — but if you did install 1.1.0, remove it with `/plugin uninstall claude-tools@josephi-claude-tools` first, since uninstall keys off the old guard file and marker block.

  The GitHub repository keeps its `josephi/claude-tools` slug, so `/plugin marketplace add josephi/claude-tools` is unchanged.

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
