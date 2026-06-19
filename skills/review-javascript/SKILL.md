---
name: review-javascript
description: Code review checklist for JavaScript and TypeScript. TRIGGER when a PR, diff, or file review touches .js, .ts, .jsx, or .tsx files, or when the user asks for a JS/TS review. SKIP for non-JS source. Usually invoked by the code-reviewer agent but safe to call standalone.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# JavaScript / TypeScript review checklist

Language-specific review for JS/TS code. Loaded by the **code-reviewer** agent when a PR contains `.js`, `.ts`, `.jsx`, or `.tsx` files.

## Checklist

- [ ] **Type safety**: Are types used where possible? Any `any` that should be narrowed?
- [ ] **Async/await**: Are promises handled correctly? Missing `await`? Unhandled rejections?
- [ ] **Immutability**: Are objects/arrays mutated where they shouldn't be?
- [ ] **Module boundaries**: Are imports/exports clean? Circular dependencies?
- [ ] **Error handling**: Are errors caught with context, not swallowed? No bare `catch (err) {}`.
- [ ] **Linting**: Does the code follow the project's ESLint/Prettier config?
- [ ] **Dead code**: Unused imports, unreachable branches, commented-out code?
- [ ] **Tests**: Does every logic change have test coverage? For a change whose purpose is a *measurable effect* (caching, fewer calls/queries, perf), is the **goal metric** tested through the real flow — not just correctness?
- [ ] **Caching / lookup correctness**: Does the **read key match the write key** (e.g. cache stored by `x.key` but read by `x.name`)? Does a cache read **fail open** (return null / the source of truth) on a miss instead of throwing? Is the cache populated in **every context that reads it**, not just one?
- [ ] **Identity vs lookup key**: Is anything `keyBy`/`groupBy`/`Map`/index'd by a field that isn't a **guaranteed unique key**? `keyBy` on a non-unique field is last-wins and order-dependent — a latent bug. The lookup must use the entity's true identity (often composite: name + domain, tenant + type). For every lookup, is **0 / 1 / many** handled (zero, one, and duplicate matches)?
- [ ] **Tests reflect real data**: Are fixtures derived from a real payload (duplicates, nulls, mixed/legacy values, ordering) rather than an idealized contract? Would the regression test actually **fail on the old code**?

## Anti-Patterns to Flag

- `catch (err) {}` — swallowing errors silently
- Stubbing internals (`fetch`, `fs`) instead of proper mocking (`nock`, `msw`, dependency injection)
- **Stubbing the function/cache/store under test** (the resolver, `getFromCache`, Redis) instead of mocking only the external boundary — a no-op or never-hit cache then passes every test
- A cache read that **throws on a missing key** (null-deref) instead of degrading to the source of truth
- **Asymmetric cache keys** — stored under one key, read under another — and no guard test over all entries
- `typeof x === 'undefined'` when `x == null` is equivalent and clearer
- `setTimeout` / `waitForTimeout` with magic numbers in tests — use proper waits
- Copy-pasted boilerplate that should be a shared utility
- Functions doing too many things (violating single responsibility)
- Missing `await` on async calls (fire-and-forget without intent)
- Using `var` instead of `const`/`let`
- String concatenation for building queries or URLs — use template literals or URL builders

## Module import style

- **No `/index` in `require(...)` or `import ... from` paths.** Require/import the folder: `require('./foo')`, `import x from './foo'` — never `./foo/index`. Node resolves the folder's `index.js` automatically.
- **Prefer short folder names over deep nested paths.** If a module lives under `a/b/c/d/e/thing.js`, that's a signal the hierarchy needs flattening, not that the path needs an alias.
- **Barrel files** (`index.js` re-exporting siblings) are fine, but don't pile up one-line re-exports that duplicate what an IDE's goto-definition can already do.
