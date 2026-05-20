---
name: task-completion
description: Close out a task — run tests, open PR as draft, wait for OK, publish, announce on Discord/GitHub Discussions, close the issue on merge. Then watch the PR hourly for review feedback or merge. TRIGGER when the implementation is complete and the user signals wrap-up ("we're done", "ship it", "close this task", or after the final commit of a task). SKIP during ongoing implementation or for PRs that are not yet commit-complete.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# Task completion

Close out a task as one atomic unit. Do not stop mid-flow and ask for re-approval at each step unless something actually fails.

## 1. Run tests

- Changed tests — the files directly affected by this task.
- Full suite when feasible — catches regressions in areas you didn't think you touched.
- See `testing-conventions` skill for stack-specific guidance.

If a test fails, fix it. Don't open the PR.

## 2. Commit and push

Follow `git-per-task` rule: stage → review staged diff when non-trivial → commit → `git pull --rebase` → `git push`.

Commit message: Conventional Commits with the issue ref in the body:

```
feat(<scope>): <short description>

Closes #<issue>
```

`scope` is the technical area (e.g. `queue`, `api`), not the issue number. See `git-conventions` skill.

## 3. Open the PR as a draft

- Use `gh pr create --draft`.
- Title matches the commit style: `feat(<scope>): description`. No `[TICKET-123]` brackets.
- Description summarizes what changed and why, includes a test plan, and uses `Closes #<issue>` so GitHub auto-links and auto-closes on merge.
- Run `deslop` skill on the PR body before submitting.

Ping the user to review the draft. Wait for an explicit OK before publishing.

## 4. Publish the PR

On OK, mark the draft as ready:

```sh
gh pr ready <num>
```

Same turn:

- Send PR announcement to the project's Discord channel or GitHub Discussions thread (whichever the repo's config points to). Use the canonical PR-announcement template from the `chat-formatting` rule (three-line header: emoji headline, 🎫 issue URL, 🔗 PR URL, blank line, one-paragraph description). Run `deslop` on the description before posting.
- Add the `in review` label (or whatever the repo's review-state label is) via `gh issue edit <issue> --add-label "in review"`.
- Kick off the watch loop automatically — invoke `/loop 1h` with a prompt that re-enters step 5 of this skill on each tick. Don't ask the user "should I set up a loop?" — proactive loop setup is the established pattern when the next step depends on an external event (reviewer activity, merge).

## 5. Watch the published PR (hourly, auto-set)

Each tick of the loop kicked off at the end of step 4 fetches PR state via `gh pr view <num> --json state,mergeable,reviews,reviewDecision,comments` and branches:

- **New reviewer comments** (change requests or questions): surface each comment with file/line/quote and the reviewer's login. Do not auto-address — published-PR comments may be intentional discussion the user wants to triage. Ask how to handle each: fix, defer, or push back.
- **Approved with no open comments** (`reviewDecision: APPROVED`): notify the user that the PR is approved. Propose completing the merge; on user confirmation, run `gh pr merge <num> --squash --delete-branch` (or `--merge` / `--rebase` per repo preference). Continue the loop until merge succeeds.
- **Merged** (`state: MERGED`): stop the loop and run step 6 immediately. Don't ask first — auto-progression is the established workflow.
- **Closed without merge** (`state: CLOSED`): stop the loop and report. Wait for user direction.
- **No change since last tick**: silent, exit the tick.

Stop conditions: PR merged, PR closed, or the user stops the loop manually.

## 6. After merge (auto-triggered)

- The linked issue auto-closes via the `Closes #<num>` in the PR body. Verify with `gh issue view <num> --json state`.
- If the implementation deviated from the original design, add a comment on the issue explaining the deviation. Post a brief follow-up to the project's general/announcements channel summarizing the change.
- Delete the local branch: `git switch main && git pull && git branch -d <branch>` (the remote branch was deleted by `gh pr merge --delete-branch`).

## What not to do

- Don't open a PR without running tests.
- Don't publish the draft without user approval.
- Don't batch steps — each step happens in sequence, but the sequence happens as one flow, not with a user-approval gate between every step.
- Don't auto-merge on approval without explicit user confirmation. Merging is shared-state and gets a gate.
- Don't auto-address review comments. The reviewer is asking the human; the human decides the response.
- Don't `gh pr merge` without `--delete-branch` — leftover remote branches accumulate fast.
