# review-dotnet

Code review checklist for .NET/C# — used by the `code-reviewer` agent.

## When to use

PR contains `.cs`, `.csproj`, or `.sln` files.

## Checklist highlights

- `IDisposable` resources disposed with `using`
- Nullable references handled; no `NullReferenceException` risks
- No `async void` (except event handlers); no `.Result`/`.Wait()` deadlock risks
- Exceptions typed and caught at the right level; no bare `catch {}`
- Dependencies injected, not `new`-ed inside business logic
- No raw string SQL concatenation — use parameterized queries or ORM
- `CancellationToken` propagated through async chains

## Files

| Path | Description |
|------|-------------|
| `SKILL.md` | Full checklist and anti-patterns |
