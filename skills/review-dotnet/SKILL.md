---
name: review-dotnet
description: Code review checklist for .NET and C#. TRIGGER when a PR, diff, or file review touches .cs, .csproj, or .sln files, or when the user asks for a .NET review. SKIP for non-.NET source. Usually invoked by the code-reviewer agent but safe to call standalone.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# .NET / C# review checklist

Language-specific review for .NET/C# code. Loaded by the **code-reviewer** agent when a PR contains `.cs`, `.csproj`, or `.sln` files.

## Checklist

- [ ] **Dispose/using**: Are `IDisposable` resources properly disposed with `using` statements?
- [ ] **Null safety**: Are nullable references handled? `NullReferenceException` risks?
- [ ] **Async patterns**: Is `ConfigureAwait(false)` used where appropriate? No `async void` (except event handlers)?
- [ ] **LINQ performance**: Are queries materialized too early? N+1 query risks?
- [ ] **Exception handling**: Are exceptions typed and caught at the right level? No bare `catch {}`?
- [ ] **Dependency injection**: Are dependencies injected, not `new`-ed inside business logic?
- [ ] **Dead code**: Unused usings, unreachable branches, commented-out code?
- [ ] **Tests**: Does every logic change have test coverage?

## Anti-Patterns to Flag

- `catch (Exception ex) { }` — swallowing exceptions silently
- `async void` methods (except UI event handlers) — unobserved exceptions crash the process
- `.Result` or `.Wait()` on async code — deadlock risk
- Hardcoded connection strings, secrets, or config values
- Raw string concatenation for SQL — use parameterized queries or an ORM
- Large methods doing too many things — violating single responsibility
- Missing `CancellationToken` propagation in async chains
- `GC.Collect()` calls in application code — let the runtime manage it
