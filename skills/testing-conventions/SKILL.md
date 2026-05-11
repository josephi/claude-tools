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

## Running tests before publishing

- Changed tests first — fast feedback on the area you touched.
- Full suite second — catches unrelated regressions.
- Docker is available locally. Missing Redis/DB/MSSQL is not an excuse to skip.

## Common mistakes

- Unit-testing a route by mocking its router. The route still passes, production still breaks — mock removed the only thing that was real.
- Stubbing a repository method instead of using a real database. Your test passes. Your migration doesn't.
- Stubbing the logger to "clean up" test output, then asserting what it logged. Every log message change breaks a test for no value.
- Fixtures in `before()` instead of `beforeEach()`. One test mutates shared state and the next test is now flaky.
