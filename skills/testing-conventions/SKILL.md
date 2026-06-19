---
name: testing-conventions
description: Conventions for writing and running tests — integration over unit for routes and repos, real infrastructure over mocks, no logger stubs, only external services get stubbed. TRIGGER when the user asks to write, run, or review tests. SKIP for documentation or pure configuration changes.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# Testing conventions

## What kind of test

| Layer | Kind | Why |
|---|---|---|
| HTTP routes | **Integration with supertest** against a real Express app | Unit tests with a mocked router miss real middleware, parsing, error paths |
| Repositories / DAL | **Integration with a real DB** via sqlcontainers / testcontainers | Mocks of Sequelize/Knex don't catch column mismatches, constraint violations, or transaction semantics |
| Pure functions, utilities | **Unit** | They have no side effects; mocking the world is overkill |
| Queue handlers, job runners | **Integration** with a real Redis | Bull's timing behavior is hard to fake |

## What to stub

**Only external services.** Schema validators, message buses, external HTTP APIs.

**Do not stub infrastructure.** Redis, Postgres, MSSQL — use testcontainers or the real thing via Docker.

**Never stub the logger.** Log-message assertions are brittle and teach you nothing. If you need to assert logging happened, prefer a structured spy that verifies a single call count at the end of the test.

## How to observe

- Use `sinon.spy` for observing. Spies let the real behavior happen.
- Use `sinon.stub` only when you have to replace behavior — external service calls, non-determinism (time, random).

## Testing a behavioral goal, not just correctness

When a change exists to produce a *measurable effect* — fewer API calls, fewer DB queries, a cache hit, lower latency — a correctness test is not enough. A flag can resolve to the right value while the cache behind it silently re-fetches every time. Assert the **goal metric itself**, through the real flow:

- **Mock only the external boundary** (e.g. `nock` the HTTP service) and **count what crosses it** — assert "this operation issues ≤ N requests", not just "the result is right".
- **Do not stub the function under test, its cache, or its store** (e.g. don't stub the resolver, `getFromCache`, or Redis). Let the real path run so the test actually exercises cache-hit vs miss. Stubbing those is how a "no-op cache" passes every test and still ships.
- A cache/lookup has **more than one read context**. Don't prove it once in the path where you found the bug and generalize — exercise each context that reads it (e.g. job creation *and* job execution).

## Fixtures from real data, not the assumed contract

A test that encodes the same assumption as the code shares its blind spot and catches nothing. Three rules close that gap:

- **Derive fixtures from a real payload, not an idealized shape.** External stores carry data-quality artifacts — duplicate keys, nulls, legacy/mixed values, unstable ordering. If the source can return the same name under two domains, the fixture must too. Inspect an actual response/row before writing the fixture.
- **0 / 1 / many for every lookup.** Cover zero matches, exactly one, and multiple — including duplicates and shuffled order — and assert the result is stable regardless of ordering. Single-entry fixtures never exercise the "many"/"zero" paths where the bugs live.
- **A test must be able to fail.** A regression test should fail on the old code and pass on the new — that is the proof it tests the bug. If you can't make it go red against the defect, it isn't covering it.

Delegate test authoring to the **qa-automation** agent, which enforces these by default.

## Running tests before publishing

- Changed tests first — fast feedback on the area you touched.
- Full suite second — catches unrelated regressions.
- **Run the linter too**, not just the test runner. `test:unit` (mocha) does **not** run ESLint, so `no-undef` / `no-unused-vars` errors pass locally and fail the CI quality gate. Run `npm run lint` (or `npx eslint <changed files>`, 0 errors) before pushing.
- Docker is available locally. Missing Redis/DB/MSSQL is not an excuse to skip.

## Common mistakes

- Unit-testing a route by mocking its router. The route still passes, production still breaks — mock removed the only thing that was real.
- Stubbing a repository method instead of using a real database. Your test passes. Your migration doesn't.
- Stubbing the logger to "clean up" test output, then asserting what it logged. Every log message change breaks a test for no value.
- Fixtures in `before()` instead of `beforeEach()`. One test mutates shared state and the next test is now flaky.

## Editing tests in an existing file

When modifying or adding tests to an existing test file, layer these on top of the conventions above:

- Keep the original file style and structure. Make minimal edits to existing tests; don't reformat the whole file.
- Do not use `proxyquire`. Load real modules normally.
- Do not delete entries from `require.cache`.
- Do not stub core codebase functions; prefer real Redis/DB-backed behavior.
- To observe calls, use spies (not stubs) on codebase functions.
- Do not stub or silence logger calls (also covered above).
- Only stub external config or feature flags when necessary, and keep the scope narrow.
- Avoid overriding code in the module under test. Focus on assertions, not rewiring.
- Keep assertions concise: verify the key inputs, outputs, order, and side effects without piling on mocks.
