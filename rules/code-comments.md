---
description: Default to no code comments in any language — write self-explanatory code and reserve comments for the rare case the code genuinely cannot convey on its own.
tags: [audience/both, portable/verbatim]
---

# Code comments

Default to **no code comments**, in every language (C#, JavaScript/TypeScript, SQL, Python, etc.). Make the code self-explanatory — clear names, small functions, obvious structure — instead of narrating it.

Add a comment only in the rare case the code genuinely cannot be made self-explanatory:

- a non-obvious workaround (and *why* it's needed),
- a subtle invariant or ordering constraint a reader would otherwise break,
- a "why" the code itself cannot express (a business rule, a link to a ticket/spec).

**Why:** Comments that restate what the code does are noise — they drift out of sync with the code, clutter diffs, and train readers to stop trusting them. Naming and structure carry the intent; a comment should only carry what they cannot.

**How to apply:** When writing or editing code, add zero comments by default. Match a file's existing comment density only when it is already sparse. Before adding a comment, ask whether a rename or a small refactor would remove the need for it — if so, do that instead.
