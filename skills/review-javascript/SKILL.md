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
- [ ] **Tests**: Does every logic change have test coverage?

## Anti-Patterns to Flag

- `catch (err) {}` — swallowing errors silently
- Stubbing internals (`fetch`, `fs`) instead of proper mocking (`nock`, `msw`, dependency injection)
- `typeof x === 'undefined'` when `x == null` is equivalent and clearer
- `setTimeout` / `waitForTimeout` with magic numbers in tests — use proper waits
- Copy-pasted boilerplate that should be a shared utility
- Functions doing too many things (violating single responsibility)
- Missing `await` on async calls (fire-and-forget without intent)
- Using `var` instead of `const`/`let`
- String concatenation for building queries or URLs — use template literals or URL builders
