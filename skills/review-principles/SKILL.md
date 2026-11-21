---
name: review-principles
description: Keep the owner's code-review principles current, once, at user level. Fetches only the owner's PR comments added since the last harvest of a repo, folds each into a categorized principle, and moves that repo's cursor. TRIGGER at the start of every PR review (the code-reviewer agent runs it as step 0), or when the user says "update my review principles" / "what are my review rules". SKIP for reviews the user explicitly asks to run without principles.
tags: [audience/personal, portable/verbatim]
---

# review-principles

The owner's PR comments are the real coding standard. They live in one file shared by every repo:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/principles.mjs" path
```

`<config>/review-principles/principles.md`: categories with one-line principles, each with its scope and sources, and a `## Harvest cursors` section with one line per repo.

## Step 1: fetch only what is new

```sh
node "${CLAUDE_SKILL_DIR}/scripts/principles.mjs" new --repo <owner>/<repo>
```

This prints JSON with `since` (that repo's cursor; the epoch the first time), `until` (the newest comment GitHub returned, so the next run starts exactly here), and `comments`: every inline and conversation PR comment under the owner's login in that window. Only unmistakable generated output is removed (headings, tables, the generated-by footer, a bold label opening, "Fixed in <sha>"). Each comment carries `agentSignals`, the reasons it might be an agent's (opens like a finding or reply, cites a commit, quotes code, long). Signals are hints, not verdicts.

The login is the `Owner login:` line at the top of the principles file; without it the script asks `gh` who is logged in, so add the line on the first run.

If the command fails (it prints one `principles: could not fetch …` line and exits 1): review with the principles file as it is, leave the cursor, and say in the review summary that the harvest was skipped and why.

Never re-read old PRs to "re-derive" principles; the file is the memory.

## Step 2: decide which comments are the owner's, and fold them in

You make the call, comment by comment. Keep it when it reads like the owner: a short question or instruction, often informal, sometimes with typos ("Use a consts for this and the other fixed parameters", "Do we have the sunrise and the sunset on each date?", "Same as above", "Done?"). Drop what reads like an agent: a severity label, an account of what was changed, a confirmation, an analysis quoting code and commits. When unsure, keep it: a lost owner comment is never fetched again, a wrong principle can be corrected.

For each comment you keep:

1. Say what it asks for in general terms, not the case. "Use a const for this" becomes "Named constants for every fixed value". A question becomes the check it implies ("Ask why on unexplained defaults").
2. If an existing principle already covers it, add the source (`[owner/repo#pr]`) and sharpen the wording if the comment adds something. Do not add a near-duplicate.
3. Otherwise add a principle under the matching category:
   - Architecture and boundaries
   - Constants and configuration
   - Tests
   - Readability and code hygiene
   - Naming
   - Error handling and robustness
   - Performance
   - Security
   - UI and text
   - Data and state
   - Scope and PR hygiene
   - Questions the owner asks

   Create a category only if none fits.
4. Scope it: no tag means every project; name a language or project when the rule only holds there ("(TypeScript)", "(A-CLIM frontend)").

Never delete or weaken a principle on your own. When a new comment contradicts one, keep both and flag the conflict to the user.

## Step 3: save in one edit

Edit the principles file once, with the Edit or Write tool, not a shell redirect (a sandboxed shell cannot write the config dir):

- the new or updated principles;
- that repo's line under `## Harvest cursors`, set to the `until` value from step 1 (add the line if the repo is new). Move it even when no comment was kept, so the same comments are not fetched again.

## Step 4: hand over

Return the full principles list to whoever is reviewing. Name any principles added or changed in this run, in one line each.

## Rules

- One file for all repos. Project-specific memory files are not where principles live.
- The cursor moves only after the principles from that batch are saved, so a failed run fetches the same comments again.
- The owner's latest wording wins over an older phrasing of the same principle.
