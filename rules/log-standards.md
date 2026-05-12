---
description: Principles for writing logs — when to log, how to format messages, how to choose levels, and how to use metadata. Language-agnostic.
tags: [audience/personal, portable/verbatim]
---

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
