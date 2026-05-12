---
description: Guidelines for writing tests - mocking strategy and code style
tags: [audience/personal, portable/verbatim]
---

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
