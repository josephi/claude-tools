---
name: task-completion
description: Close out a task — run tests, open PR as draft, wait for OK, publish, announce on Slack, transition Jira, then watch the PR hourly for review feedback or merge. TRIGGER when the implementation is complete and the user signals wrap-up ("we're done", "ship it", "close this task", or after the final commit of a task). SKIP during ongoing implementation or for PRs that are not yet commit-complete.
model: sonnet
tags: [audience/personal, portable/adapt]
---

# Task completion

Close out a task as one atomic unit. Do not stop mid-flow and ask for re-approval at each step unless something actually fails.

## 1. Run tests

- Changed tests — the files directly affected by this task.
- Full suite when feasible — catches regressions in areas you didn't think you touched.
- Docker is available locally for real DB/Redis dependencies. See `testing-conventions` skill.

If a test fails, fix it. Don't open the PR.

## 2. Commit and push

Follow `git-per-task` rule: stage → review staged diff when non-trivial → commit → `git pull --rebase` → `git push`.

Commit message: Conventional Commits with the task ID in scope:

```
feat(<task-id-lowercase>/<scope>): <short description>
```

## 3. Open the PR as a draft

- Title matches the commit style: `feat(<task-id>/scope): description`. No `[TICKET-123]` brackets.
- Description summarizes what changed and why, includes a test plan, and links the Jira ticket.
- Run `deslop` on the PR body before submitting.

Ping the user to review the draft. Wait for an explicit OK before publishing.

## 4. Publish the PR

On OK, mark the draft as ready. Same turn:

- Send Slack announcement to the team's PR-review channel. Use the canonical PR-announcement template from the `slack-formatting` rule (three-line header: emoji headline, `:ticket:` Jira URL, `:link:` TFS URL, blank line, one-paragraph description). Run `deslop` on the description before posting.
- PR-review channel is **team-scoped** (e.g. `#delorean-pull-request-code-review`), not per-service. Do not use `service.json.notificationsChannelId` — that channel is for pipeline/build alerts, not PR reviews. See `slack-formatting` for known team→channel mappings.
- Transition the Jira task to **Code Review** (transition ID from `service.json` or the `jira-context` skill).
- Ensure the task is in the current sprint and assigned to the user.
- Kick off the watch loop automatically — invoke `/loop 1h` with a prompt that re-enters step 5 of this skill on each tick. Don't ask the user "should I set up a loop?" — proactive loop setup is the established pattern when the next step depends on an external event (reviewer activity, merge).

## 5. Watch the published PR (hourly, auto-set)

Each tick of the loop kicked off at the end of step 4 fetches PR state via `/azure-devops` — pending votes, comments since the last tick, merge status — and branches:

- **New reviewer comments** (change requests or questions): surface each comment with file/line/quote and the reviewer's name. Do not auto-address — published-PR comments may be intentional discussion the user wants to triage. Ask how to handle each: fix, defer, or push back.
- **Approved with no open comments**: notify the user that the PR is approved. Propose completing the merge; on user confirmation, run the merge through `/azure-devops`. Continue the loop until merge succeeds.
- **Merged**: stop the loop and run step 6 immediately. Don't ask first — auto-progression is the established workflow.
- **No change since last tick**: silent, exit the tick.

Stop conditions: PR merged, PR abandoned, or the user stops the loop manually.

## 6. After merge (auto-triggered)

- Transition Jira to **Deployed to Production** (transition ID from `service.json` or `jira-context`).
- If the implementation deviated from the original design, update the Jira description, add a comment explaining the deviation, and post to the team's general channel (`slackChannel.openChannelId`).

## What not to do

- Don't open a PR without running tests.
- Don't publish the draft without user approval.
- Don't batch steps — each step happens in sequence, but the sequence happens as one flow, not with a user-approval gate between every step.
- Don't auto-merge on approval without explicit user confirmation. Merging is shared-state and gets a gate.
- Don't auto-address review comments. The reviewer is asking the human; the human decides the response.
