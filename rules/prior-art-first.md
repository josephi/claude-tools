---
description: Before adding new logic for a problem that might already exist in the codebase, grep similar handlers/modules first — the pattern is often already implemented and your reimplementation will likely be worse.
tags: [audience/personal, portable/verbatim]
---

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
