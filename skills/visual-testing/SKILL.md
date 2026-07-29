---
name: visual-testing
description: Catch unintended visual regressions by diffing screenshots between the current branch and the base, using Playwright locally. Personal-stack replacement for the work Percy skill. TRIGGER when the user says "did this change the UI", "check for visual regressions", "screenshot diff", "compare the UI against main", or after a CSS/layout/component change. SKIP for logic-only changes with no rendered output, and for one-off "show me the page" requests — that is chrome-debug.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# visual-testing

Screenshot diffing for the current project's UI, run locally with Playwright.

Personal-stack counterpart to the work `percy` skill. Percy is a hosted service with a review UI and a stored baseline per branch; this has neither. The baseline is a directory of PNGs you generate from the base branch, so the whole workflow hinges on the baseline being honest — regenerate it from a clean base checkout, never from your working tree.

## Prerequisites

Playwright must be a dev dependency of the project:

```sh
npm ls @playwright/test 2>/dev/null || npm i -D @playwright/test && npx playwright install chromium
```

If the project has no Playwright config, this skill is the wrong tool — say so rather than scaffolding a test framework the project never chose.

## Reading the context

```sh
KEY=$(~/bin/project-key)
LOCAL_URL=$(~/bin/project-cfg "$KEY" app localUrl 2>/dev/null || echo "http://localhost:5173")
```

Screenshots come from a **locally running** app, not staging — you need both branches rendered under identical conditions, and staging only ever has one.

## The workflow

### 1. Capture the baseline from the base branch

```sh
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD | sed 's|origin/||')
git switch "$BASE"
npm run build && npm run preview &   # or `npm run dev`, whichever the project uses
npx playwright test --update-snapshots
kill %1
```

**Do this in a worktree, not by switching branches in place**, if you have uncommitted work — `worktree-manager` exists for exactly this. Switching with a dirty tree either fails or carries your changes onto the base, which silently poisons the baseline.

### 2. Capture the current branch and diff

```sh
git switch -
npm run build && npm run preview &
npx playwright test
kill %1
```

Playwright's `toHaveScreenshot()` fails the test on a diff and writes `*-diff.png` next to the actual and expected images. Open the diff, don't just read the pixel count.

### 3. Triage every diff

A diff is not automatically a bug. For each one decide:

- **Intended** — the change you set out to make. Accept it by re-running with `--update-snapshots` and committing the new baseline.
- **Unintended** — a layout shift, a font fallback, a z-index change you did not mean. This is the finding; fix it.
- **Flake** — see below before you use that word.

## Flake, and why the bar is high

The `testing-conventions` rule says a failing test is real until proven otherwise, and that applies here with one addition: screenshot tests have genuinely non-deterministic inputs, so the honest move is to *remove* the nondeterminism rather than to retry.

Before calling a visual diff flaky, eliminate the usual causes:

- **Animations and transitions.** Disable them globally in the test setup rather than sleeping.
- **Fonts.** A webfont that loads after first paint renders a different frame every run. Wait for `document.fonts.ready`.
- **Anything time- or data-dependent.** A rendered timestamp, a random avatar, live API data. Mask the region with `toHaveScreenshot({ mask: [...] })` or stub the response.
- **Viewport and device scale factor.** Pin both in the config; a default that varies by machine makes the baseline unshareable.

Only after all four are handled is a remaining diff worth calling nondeterministic — and then say which of them you could not eliminate.

## What to screenshot

Fewer, more meaningful shots beat one per component:

- The pages the change actually touches, at the project's real breakpoints.
- Both light and dark themes if the project has them — theme bugs are among the most common regressions and the easiest to miss.
- Error and empty states, which is where layout usually breaks and where manual testing rarely goes.

Do not screenshot a page whose content is dominated by live data unless you have stubbed it. The test will fail every run and get disabled, which is worse than not having it.

## What this skill does not do

- Does not upload anywhere or provide a hosted review UI. The baseline lives in the repo.
- Does not replace `chrome-debug` for interactive inspection of a running app.
- Does not assert behaviour — a page can look right and be broken. Functional coverage is `qa-automation` and `testing-conventions`.
