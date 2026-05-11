# review-javascript

Code review checklist for JavaScript/TypeScript — used by the `code-reviewer` agent.

## When to use

PR contains `.js`, `.ts`, `.jsx`, or `.tsx` files.

## Checklist highlights

- Type safety: no unnarrowed `any`
- Async/await: no missing `await`, no unhandled rejections
- Error handling: errors caught with context, not swallowed (`catch (err) {}`)
- No dead code: unused imports, unreachable branches, commented-out code
- No `var` — use `const`/`let`
- Template literals for URL/query building, not string concatenation
- Every logic change has test coverage

## Files

| Path | Description |
|------|-------------|
| `SKILL.md` | Full checklist and anti-patterns |
