---
name: task-completion
description: Close out a task — run tests, open PR as draft, wait for OK, publish, announce on Slack, transition Jira. TRIGGER when the implementation is complete and the user signals wrap-up ("we're done", "ship it", "close this task", or after the final commit of a task). SKIP during ongoing implementation or for PRs that are not yet commit-complete.
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

## 5. After merge

- Transition Jira to **Deployed to Production** (transition ID from `service.json` or `jira-context`).
- If the implementation deviated from the original design, update the Jira description, add a comment explaining the deviation, and post to the team's general channel (`slackChannel.openChannelId`).

## What not to do

- Don't open a PR without running tests.
- Don't publish the draft without user approval.
- Don't batch steps — each step happens in sequence, but the sequence happens as one flow, not with a user-approval gate between every step.
