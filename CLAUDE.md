# claude-tools plugin — context

Rules and conventions loaded into every session.
Managed in [josephi/claude-tools](https://github.com/josephi/claude-tools).

---

# Rules

## build-tests-principles


When writing tests follow those rules:
* Keep the original file style/structure; minimal edits to existing tests.
* Do not use proxyquire; load real modules normally.
* Do not delete from require.cache.
* Do not stub core codebase functions; prefer real Redis/DB-backed behavior.
* If you need to observe calls, use spies (not stubs) on codebase functions.
* Do not stub or silence logger calls.
* Only stub external config/flags when necessary and narrowly scoped.
* Avoid overriding code in modules under test; focus on assertions, not rewiring.
* Keep assertions concise: verify key inputs/outputs, order, and side effects without heavy mocking.

## chat-formatting


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

## execution-style


# Execution style

- Act, don't deliberate. Research the blast radius first, flag concrete blockers briefly, then execute.
- Don't push back on design decisions unless there's a hard technical blocker — broken tests, circular dependency, or an impossible invariant. If one exists, state it concisely and ask how to proceed — don't recommend aborting.
- Don't present options unless genuinely stuck. Challenge recommendations with concrete reasoning, not abstract architecture takes.
- Refactor branches come from the **base branch** (`dev`, `master`, `main`), never from a feature branch. After the refactor merges, rebase dependent feature branches onto the new base.

## git-per-task


# Git per task

## At task start

1. Check whether a branch already exists for this task.
2. If not, create one from the base branch (`dev`, `master`, `main` — whatever the project uses).
3. Switch to the branch **before** making any code change.

## Between implementation and commit

Stage the change, then let the user review the staged diff before the commit when the change is non-trivial. Use `git diff --cached` to review.

## After every commit

`git pull --rebase` and then `git push`. No batching — each commit reaches the remote immediately so feedback is continuous.

Never push `--force` to a protected branch (`dev`, `master`, `main`). On a feature branch, only force-push with lease (`--force-with-lease`) and only when the rebase is yours.

## When force-push is blocked by the sandbox

If `git push --force-with-lease` returns "Permission to use Bash with command ... has been denied," do not retry the command or a variant — the block is on the command shape, not transient. Tell the user to run it themselves with the `!` prefix:

> Force-push was denied — type `! git push --force-with-lease` to run it in this session.

The `!` prefix runs the command at the user level and pipes the output back into the conversation. After it succeeds, continue from where you left off. Don't propose alternatives like "want me to make a follow-up commit instead" unless asked — a clean force-push on a feature branch is usually preferred.

## Protected branches

Never make direct edits on `dev`, `master`, or `main`. Always work from a task branch.

## log-standards


# Log Standards

Principles for writing logs that are useful for debugging, operable for oncall, and cheap to index.

## When to log

**Do log:**
- Major process boundaries — `sync job started`, `batch processing finished`, `migration initiated`.
- Every failure point — validation failures, external call errors, unexpected state.
- Transitions between systems — inbound request resolved, outbound call dispatched, message published.

**Don't log:**
- Trivial successes (`connected to database`, `request sent`, `validation passed`).
- Anything inside a hot loop — aggregate after the loop with a summary instead.
- Routine status updates that aren't actionable.

If removing the log wouldn't leave oncall blind, the log isn't needed.

## Message format

The message itself is a **static string** — an identifier, not a sentence. All dynamic values go in the metadata object.

- **Short, lowercase, space-separated.** `sync job finished`, not `"Sync job finished."` and not `syncJobFinished`.
- **No punctuation** in the message. Punctuation breaks indexed search.
- **No interpolation.** Never inject variables into the message string — one message per operation, regardless of values. `logger.info('records synced', { count })`, not ``logger.info(`synced ${count} records`)``.
- **No raw errors.** Don't pass an `Error` or exception as the message. Extract fields you care about (`message`, `stack`, `code`) into metadata.

## Log levels

| Level | When |
|---|---|
| `fatal` | The process cannot continue. Triggers an alert. |
| `error` | Unexpected code error blocking the current flow (thrown exceptions, failed invariants). |
| `warn` | Handled business-logic failure — the flow is interrupted but the failure is expected and recoverable. |
| `info` | Conclusion of a major operation — log the milestone, not the start, unless the start is independently useful. |
| `verbose` / `debug` | Request/response summaries, toggle evaluations, granular flow. |
| `trace` | Local debugging only — never committed. |

Warnings should be actionable. If a warning is routine and never inspected, drop it to `debug` or remove it.

## Metadata

Metadata carries the dynamic context. Rules:

- Prefer structured fields over concatenated strings. `{ recordId, durationMs }`, not `"recordId=123 durationMs=500"`.
- Include identifiers at every layer (request ID, correlation ID, record ID) so you can pivot across services.
- For errors: include `error: e.message` and `stack: e.stack` at minimum; add `code`, `statusCode`, or response body when relevant.
- Never log secrets, full PII, or request bodies that might contain them.

## Aggregating over loops

```js
// bad
for (const item of items) {
  logger.info('processing item', { itemId: item.id });
}

// good
const start = Date.now();
for (const item of items) { /* ... */ }
logger.info('items processed', { count: items.length, durationMs: Date.now() - start });
```

One log line per batch, not one per item.

## node-import-style


# Node import style

- No `/index` in `require(...)` or `import ... from` paths. Require/import the folder: `require('./foo')`, `import x from './foo'` — never `./foo/index`. Node resolves the folder's `index.js` automatically.
- Prefer short folder names over deep nested paths. If a module lives under `a/b/c/d/e/thing.js`, that is a signal the hierarchy needs flattening, not that the path needs an alias.
- Barrel files (`index.js` re-exporting siblings) are fine, but don't pile up one-line re-exports that duplicate what an IDE's goto-definition can already do.

## pr-comment-action-scope


# PR comment action scope

Inline comments on a PR that propose **code changes** represent a commitment — the author is expected to act on them. Treat that commitment as something the reviewer (you, or the user you are helping) has to approve explicitly.

Rules when posting inline comments on someone else's PR:

1. Comments that ask for a code change → post only those the user has explicitly agreed to.
2. Comments that are observations, questions, or style nits without a code change → fine to post.
3. When in doubt about whether a finding is change-requesting or just commentary, discuss it first before posting.

**Why:** Over-eager "please change this" comments create work for the author that the reviewer never committed to. Discuss the borderline ones; post only the agreed-to code-change items.

## pr-comment-no-second-gate


# PR comments — no second gate

When reviewing a PR (via the `code-reviewer` agent or otherwise):

1. Present the findings in chat — verdict, summary, each inline finding with location and suggestion.
2. Post the comments in the same turn.

Do **not** pause for a second "want me to post?" confirmation. The author already reviewed the findings when they read them; a second gate just adds friction without adding safety.

Exception: the user says up front "draft only", "show me first", or "don't post yet". In that case, stop at step 1 and wait.

**Why:** After a review is generated, the next expected action is to post it. Rechecking intent every time is a wasted gate and trains the user to type "yes" without thinking.

## pr-review-via-agent


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

## prior-art-first


# Prior art first

When a task involves resolving a mapping, looking up a tenant-specific path, parsing a structured input, or any pattern that smells like "this has surely been done somewhere," grep similar handlers before drafting a new helper.

**Why:** A new implementation that ignores prior art costs iterations and often converges on a worse API than what already exists. The existing helper has already absorbed the edge cases.

## Where to look

- **Sibling handlers under the same service / module / domain.** If you're writing for integration A and integrations B and C exist for the same shape of problem, the pattern is in one of them.
- **`common/` or `helpers/` folders** — the folder name itself signals reusable logic worth grepping.
- **The largest or oldest file in the area** — typically the canonical pattern.

## How

1. `grep -rn` for the key concept across the relevant directory tree — function name, field name, data shape, whichever the task hinges on.
2. Read the most similar handler in full before drafting your own. Don't skim.
3. If found: lift the pattern. Refactor into a shared helper if a second use case justifies it; otherwise stay within the existing convention.
4. If genuinely missing: proceed with new code, but call out the gap so it can become a shared helper next time.

## What not to do

- Don't grep the function name you'd hypothetically use (`getThingByName`) — that's the name *you'd* write. Grep the *concept* (the field/path/operation being resolved).
- Don't conclude "no prior art" after one failed grep. Try two or three keyword variations.
- Don't reimplement just because the existing version is in a slightly different style. Match the style, propose a refactor as a follow-up.

