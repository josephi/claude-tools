---
description: Route all PR reviews through the code-reviewer agent rather than doing ad-hoc reviews in chat. The agent enforces the full review workflow and the right checklist for the stack.
tags: [audience/personal, portable/verbatim]
---

# PR reviews go through the code-reviewer agent

When asked to review a PR, delegate to the `code-reviewer` agent. Do not review ad-hoc in chat.

The agent:

- Pulls the PR and changed files
- Picks the right language checklist (`review-javascript`, `review-dotnet`, `review-sql`, …)
- Produces the standard severity-graded finding format
- Posts inline and summary comments
- DMs the author on Slack

Ad-hoc chat reviews skip these steps and almost always miss findings the checklists catch.

Exception: the user asks specifically for a quick read ("glance at this diff", "sanity-check this change") and doesn't want formal comments posted. In that case, answer in chat and mention the agent exists if they want a full review.

## Standalone vs integration PRs

Every PR is either **standalone** (merges independently) or **integration** (part of a coordinated multi-milestone refactor where several PRs land together into an integration branch).

**For standalone PRs**: pass nothing extra — the agent reviews in full isolation. "X doesn't exist" is a critical.

**For integration PRs**: pass the integration context in the agent prompt so it can distinguish real bugs from planned gaps:

```
STANDALONE: no
BUNDLE MATES: <list other PRs that merge in the same window>
PRECEDING MILESTONES: <what already exists when this PR lands>
INTENTIONALLY ABSENT: <things that arrive in later milestones>
TARGET BRANCH: <integration branch, e.g. refactor>
```

Without this context, the agent flags design decisions as criticals and generates noise. With it, it focuses on genuine bugs (SQL injection, wrong library API, build failures) rather than gaps that are resolved by bundle mates or later milestones.

After the review, resolve GitHub comment threads reclassified as design decisions — they clutter the PR and mislead future reviewers.
