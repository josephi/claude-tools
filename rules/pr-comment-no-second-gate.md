---
description: When a PR review has been presented, post inline comments and the summary in the same turn — do not ask for a second confirmation after findings are already on screen.
tags: [audience/personal, portable/verbatim]
---

# PR comments — no second gate

When reviewing a PR (via the `code-reviewer` agent or otherwise):

1. Present the findings in chat — verdict, summary, each inline finding with location and suggestion.
2. Post the comments in the same turn.

Do **not** pause for a second "want me to post?" confirmation. The author already reviewed the findings when they read them; a second gate just adds friction without adding safety.

Exception: the user says up front "draft only", "show me first", or "don't post yet". In that case, stop at step 1 and wait.

Second exception: **architecture decisions.** When the review finds the PR deviating from the project's architecture, the reviewer returns it as a decision, unposted. Ask the user one question per decision (recommended answer first: keep the architecture, or accept the deviation and record it in the architecture doc), then post according to the answer. Everything else is still posted without a gate.

**Why:** After a review is generated, the next expected action is to post it. Rechecking intent every time is a wasted gate and trains the user to type "yes" without thinking.
