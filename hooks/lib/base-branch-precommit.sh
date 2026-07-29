#!/bin/sh
# bench: refuse a commit on a base branch.
#
# The PreToolUse guard stops the WRITE, which means it has to understand what a
# command is about to do — and shell being what it is, that understanding is never
# complete. This hook stops the COMMIT instead, which needs no understanding at all:
# by the time it runs, git already knows what branch you are on.
#
# So the two are not redundant. The guard is the early, specific, explain-it-now
# signal that catches the ordinary cases; this is the backstop that holds regardless
# of how the file got written — a heredoc, a nested interpreter, an editor, anything.
#
# Escape hatch matches the guard's: BENCH_ALLOW_BASE_EDITS=1. `git commit
# --no-verify` also bypasses it, which is fine — that is an explicit, deliberate act,
# not an accident.
#
# Installed by /bench:setup, removed by /bench:uninstall.

[ "${BENCH_ALLOW_BASE_EDITS}" = "1" ] && exit 0

# symbolic-ref, not `rev-parse --abbrev-ref`: the latter fails on an unborn branch,
# so in a repo with no commits yet the hook exited 0 and protected nothing.
branch=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0

# A detached HEAD is not a base branch, and the very first commit of a repo has to
# land somewhere — neither is what this protects against.
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

case "$branch" in
    master|main|dev|develop) ;;
    *) exit 0 ;;
esac

cat >&2 <<EOF
bench: refusing to commit on "$branch" — it is a base branch.

  git-per-task: work happens on a task branch, never directly on a base branch.

To move this commit onto a branch, keeping the staged changes:

  git checkout -b <type>/<task-id>_<short-goal>
  git commit

If this commit genuinely belongs on $branch, either set
BENCH_ALLOW_BASE_EDITS=1 or pass --no-verify.
EOF

exit 1
