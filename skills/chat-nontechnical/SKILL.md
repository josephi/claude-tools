---
name: chat-nontechnical
description: Rewrite or draft chat messages (Discord, GitHub Discussions) for non-technical readers (clients, stakeholders, PMs, community members, non-engineering collaborators) — short, jargon-free, framed around bottom-line, risk, resources, and timeline, not implementation detail. TRIGGER when drafting a message, update, or status report to a non-technical stakeholder, or when the user says "write this for the client / for a non-technical audience". When the recipient's role isn't clear from the request, ask. SKIP for messages to fellow engineers or purely technical threads.
tags: [audience/personal, portable/verbatim]
---

# Chat messages to non-technical readers

Non-technical readers don't need the technical story — they need the **decision-relevant** story. This skill rewrites or drafts a chat message so a client, stakeholder, or non-engineering collaborator can act on it in seconds.

## When to apply

Any Discord message, GitHub Discussions post, thread reply, or status update addressed to a non-technical reader:

- A **client or project stakeholder**.
- A **product-minded collaborator** or other **non-engineering reader** (support, finance, ops, community).
- Whenever the user says "write this for the client / for <name>, they're not technical".

## Determine the audience first (when it's unclear)

If the request doesn't make the recipient's role clear — you can't tell whether they're a technical peer or a non-technical stakeholder — resolve it **before** drafting:

1. Check the conversation and the project's chat config (`.ai-tools/discord.json` or similar) for hints about who the channel serves.
2. If still ambiguous, **ask the user** who the recipient is and their role — don't guess the register.
3. Software engineer / technical IC → this skill likely does **not** apply; write to them normally (or SKIP).

## Core rule

Every message answers, in this order:

1. **Bottom line first** — the status, or what you need from them, in one line.
2. **Risk** — what could go wrong, the impact, and the mitigation (or "none").
3. **Resources** — do we have what we need? Any dependency or ask (people, budget, access).
4. **Timeline** — dates, not "soon". On track, at risk, or delayed — and by how much.

For a reader who just needs to understand status, keep step 1 and the style rules; risk / resources / timeline are optional.

## Style rules

- **Short** — 3–6 lines for an update. If it needs more, use a thread or link a doc.
- **Clear** — plain language; no jargon or acronyms that need decoding.
- **No implementation details** — no stack traces, class names, query plans, or code. Link out if needed.
- **One clear ask** — if a decision or action is needed, state it explicitly and put it first or last, never buried.
- **Status words** — use **On track / At risk / Delayed / Blocked**, not vague phrasing.
- **Formatting** — follow the `chat-formatting` skill for links, emoji, and layout (URL wrapping on Discord, markdown links on GitHub, no em dashes).

## Template

```
[Topic]: [On track / At risk / Delayed / Blocked]
Bottom line: [one sentence]
Risk: [impact + mitigation, or "none"]
Resources: [ask, or "covered"]
Timeline: [date / delta vs. plan]
Ask: [decision or action needed, if any]
```

## Example

Before (technical):

> Hey, we found the sync worker keeps retrying because the upstream API returns 429s under load, we added exponential backoff and are refactoring the queue consumer, still debugging the dedup logic in the batch processor...

After (stakeholder-ready):

> **Data sync degradation:** At risk
> Bottom line: sync delays for ~15 users; fix in progress.
> Risk: if not resolved by Thu, delays become visible to the biggest accounts — mitigation ready (manual re-sync).
> Resources: covered, no ask.
> Timeline: fix live by Thu EOD; will confirm Wed.

## Related

`chat-formatting` (links, emojis, message layout); `deslop` (prose quality). Pair with `github-issues`/observability skills when the underlying status comes from an issue or a dashboard.
