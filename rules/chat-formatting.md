---
description: Personal-flow chat conventions — PR-announcement template for Discord and GitHub Discussions, emoji guidance, send vs draft.
tags: [audience/personal, portable/verbatim]
---

# Chat formatting

Applies when announcing PRs or activity through Discord or GitHub Discussions.

## Canonical PR-announcement template (Discord)

Use this exact shape for every PR-ready-for-review message:

```
🛡️ PR ready for review — headline goes here
🎫 Issue: <https://github.com/<owner>/<repo>/issues/42>
🔗 PR: <https://github.com/<owner>/<repo>/pull/57>

One-paragraph description: what changed and why.
```

Rules:

1. **Three lines at the top**, in order: headline, issue URL, PR URL. Each line starts with an emoji, then a single space, then the content.
2. **One blank line** between the link block and the description.
3. **Wrap URLs in `<…>` to suppress the embed preview** when posting multiple links — Discord otherwise stacks two big preview cards under your message. The first link (or none) can be left unwrapped if you want one preview.
4. **Use real Unicode emojis** (🛡️ 🎫 🔗 🚀 🐛 ✨ 🔍 📝 🔒 👀 ⚠️ ✅ ❌ 🔥). `:shortcode:` syntax only works for custom server emojis, and a missing custom emoji renders as literal text — Unicode always renders.

Swap the headline emoji to match topic: 🛡️ security/CVE, 🐛 bug fix, ✨ feature, 🚀 deploy, 📝 docs, 🔒 auth, 🔍 investigation.

## Canonical PR-announcement template (GitHub Discussions)

GitHub Discussions render full markdown. Use `[label](url)` links, not bare URLs — GitHub renders a preview card for the first bare URL only and the rest become inline text.

```markdown
### 🛡️ PR ready for review — headline goes here

- 🎫 Issue: [#42 — short title](https://github.com/<owner>/<repo>/issues/42)
- 🔗 PR: [#57 — PR title](https://github.com/<owner>/<repo>/pull/57)

One-paragraph description: what changed and why.
```

## Discord embeds (when richer)

When a plain message isn't enough — release notes, multi-section status — use a Discord embed (via webhook or bot). Keep the embed:

- One `color` per topic (security red, deploy green, bug yellow).
- `title` carries the headline; `url` makes the title clickable.
- `fields` are short (`Issue`, `PR`, `Author`); `value` may be a markdown link.

Don't put more than ~4 fields in an embed. If you need more, post a follow-up.

## Channel targeting

- Discord channels are per-project, named in the project's local config (`.ai-tools/discord.json` or similar). Read from there, don't hardcode.
- GitHub Discussions are repo-scoped — category comes from the post type (Announcements for PR-ready, Q&A for help, General for chatter).

## Send vs draft

Send directly. Don't queue drafts that sit unsent — silent drafts are usually worse than nothing.

The exception is when the user says up front "draft only", "show me first", or "don't send yet". Then stop at draft and wait.

## Message style

See the `deslop` rule for general prose quality. Specifically for chat:

- No em dashes.
- No bold-first bullets.
- Short first line — most clients truncate the preview.
- Direct: what changed, why, link.
