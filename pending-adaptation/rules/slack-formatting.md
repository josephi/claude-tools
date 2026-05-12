---
description: Tipalti Slack conventions — canonical PR-announcement template, verified-emoji list, channel targeting, send vs draft.
tags: [audience/personal, portable/adapt]
---

# Slack formatting

Applies when sending Slack messages through an MCP or integration.

## Canonical PR-announcement template

Use this exact shape for every PR-ready-for-review message:

```
:shield: PR ready for review — headline goes here
:ticket: https://jira.tipalti.com:7000/browse/SYNC-XXXXX
:link: https://tfs01.tipalti.com:8080/tfs/Tipalti/Tipalti/_git/REPO/pullrequest/NNN

One-paragraph description: what changed and why.
```

Rules:

1. **Three lines at the top**, in order: headline line, Jira URL line, TFS URL line. Each line starts with an emoji, then a single space, then the content.
2. **One blank line** between the URL block and the description.
3. **One URL per line.** Never put two URLs on the same line; never put prose before or after a URL on its own line.
4. **Never follow a URL with an undefined emoji.** If the emoji after a URL doesn't exist in the workspace it renders as literal text and can splice into the URL's trailing parse, breaking the unfurl. This is how "the link became broken" bugs happen — verify every emoji.

Swap the headline emoji to match topic: `:shield:` security/CVE, `:bug:` bug fix, `:sparkles:` feature, `:rocket:` deploy, `:memo:` docs, `:lock:` auth, `:mag:` investigation.

## Emojis — verified allow-list

Use only Unicode emojis confirmed to render in the Tipalti workspace:

`:shield:` `:ticket:` `:link:` `:rocket:` `:bug:` `:sparkles:` `:mag:` `:memo:` `:hammer:` `:lock:` `:eyes:` `:warning:` `:white_check_mark:` `:x:` `:fire:`

## Emojis — do-not-use

These are NOT in the Tipalti workspace and render as literal text like `:pr:`:

`:jira:` `:pr:` `:git:` `:github:` `:azure:` `:azuredevops:` `:devops:` `:merge:`

Before introducing any new emoji not on the allow-list, either confirm it renders in a test message or stick to Unicode.

## URL formatting

Include URLs as **plain URLs**, never in `<url|text>` markup. Plain URLs auto-unfurl; angle-bracket markup disables the unfurl.

Examples:

```
https://jira.tipalti.com:7000/browse/SYNC-XXXXX
https://tfs01.tipalti.com:8080/tfs/Tipalti/Tipalti/_git/REPO/pullrequest/NNN
```

Each URL lives on its own line, with an emoji prefix per the template above. Do not end a prose sentence with a URL on the same line; the sentence text will leak into the unfurl preview.

## Channel targeting

The per-service `service.json → slackChannel.*` keys point to **pipeline/ops** channels, not PR-review channels:

- `notificationsChannelId` — pipeline and build alerts (e.g. `#syncapp-pipelines-alerts`).
- `openChannelId` — team general / reception (e.g. `#syncapp-public-reception`).
- `memberIdsToTag` — people to mention when explicit tagging is required.

**PR-review channels are team-scoped** (not per-service) and usually named `#<team>-pull-request-code-review`. They are not listed in `service.json`. Known mappings:

- DeLorean → `#delorean-pull-request-code-review` (`C02K2EF4FF0`).

For unknown teams, discover the channel via `slack_search_channels "<team> pull request"` on first use and cache it in a memory reference.

## Send vs draft

Use `slack_send_message` directly. Do not use `slack_send_message_draft` unless explicitly asked to draft-only. A draft that sits unsent is usually worse than nothing.

## Message style

See the `deslop` skill for general prose quality. Specifically for Slack:

- No em dashes.
- No bold-first bullets.
- Short first line — Slack previews truncate.
