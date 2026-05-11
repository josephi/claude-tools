---
name: refactor-flow
description: Handle refactors that multiple feature branches depend on — branch from base, merge into dependents after. TRIGGER when the user asks for a refactor, consolidation, or structural change that spans multiple files or might affect in-flight feature work. SKIP for single-file tweaks or refactors that touch only one feature branch's scope.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# Refactor flow

Refactors that other feature branches depend on have a specific lifecycle. Get it wrong and you either (a) block feature branches waiting on the refactor, or (b) orphan refactor commits inside one feature branch that other features can't see.

## Rules

1. **Refactor branches come from the base branch** (`dev`, `master`, `main`). Never from a feature branch.
2. **One refactor per branch.** Don't mix refactor work with a feature change.
3. **Merge the refactor first**, then rebase dependent feature branches onto the updated base.

## Flow

```
Start:        base (dev) — A — B — C
Feature X:                      \— X1 — X2
Feature Y:                      \— Y1

Create refactor branch from base:
              base (dev) — A — B — C
                                 \— R1 — R2  (refactor)
Merge refactor into base:
              base (dev) — A — B — C — M(R)

Rebase features onto new base:
              base (dev) — A — B — C — M(R)
                                      \— X1' — X2'
                                      \— Y1'
```

## Steps

1. Confirm the base branch.
2. From the base branch: `git checkout -b refactor/<id>_<goal>`.
3. Implement the refactor. Small, scoped commits.
4. Run tests — changed files + full suite.
5. Open PR as draft → review → publish → merge.
6. For each dependent feature branch: `git checkout <feature>` → `git pull --rebase origin <base>` → resolve conflicts → `git push --force-with-lease`.

## What not to do

- Don't branch off a feature branch for a refactor — the refactor becomes invisible to other features.
- Don't mix refactor and feature commits. If you catch yourself doing it, split into two branches before the PR.
- Don't `--force` push a dependent feature branch before telling the author of that branch.
