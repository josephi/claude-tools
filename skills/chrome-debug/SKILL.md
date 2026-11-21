---
name: chrome-debug
description: Open the current project's app in the right browser (headless Chromium in a container, the project's Chrome profile on a Mac) and drive DevTools — read console, list network requests, take screenshots, evaluate JS, navigate, click, fill. Uses Chrome DevTools MCP tools under the hood. TRIGGER when the user says "debug the app", "open DevTools", "screenshot the app", "check the console", "look at the network tab", "load localhost in Chrome", "is the deploy actually working". SKIP for backend-only debugging or when no Chrome DevTools MCP tools are available.
model: sonnet
tags: [audience/personal, portable/verbatim]
---

# chrome-debug

Drive the project's web app in the correct Chrome profile, so cookies/auth/extensions match the environment under test. All UI debugging happens through the Chrome DevTools MCP tools (`mcp__chrome-devtools__*`).

## Reading the project context

```sh
BIN="${CLAUDE_SKILL_DIR}/../../bin"
KEY=$("$BIN/project-key")
LOCAL=$("$BIN/project-cfg"   "$KEY" app localUrl   2>/dev/null || true)
STAGING=$("$BIN/project-cfg" "$KEY" app stagingUrl 2>/dev/null || true)
PROD=$("$BIN/project-cfg"    "$KEY" app prodUrl    2>/dev/null || true)
```

If the project has no `app` topic, defer to the `personal-projects` skill to add one before continuing.

## Step 1 — Get a browser the MCP can drive

Pick the branch by where the session runs (`uname -s`, and `/.dockerenv` exists in a container).

### Container or Linux (claude-vm)

There is no desktop Chrome and no profile. The user-scope `chrome-devtools` MCP launches a headless Chromium itself (`--executablePath /usr/local/bin/chromium --headless --isolated`), so skip launching anything:

1. `new_page` with `$URL`.
2. Screenshots work; there is no window for the user to look at, so show results as screenshots or text.
3. A login the user must type cannot happen here. For a local stack prefer `SKIP_AUTH`; for staging or prod, ask the user to log in on their own machine and debug from the network evidence instead.
4. A local stack's ports are on `localhost` for the MCP's Chromium (host networking).

If `new_page` fails with "Could not find Google Chrome", the session is using a plugin-bundled DevTools MCP rather than the user-scope one; use `mcp__chrome-devtools__*` tools, not `mcp__plugin_*`.

### macOS desktop

The MCP attaches to the **most recently launched** Chrome window, so launch the project's profile first:

```sh
WRAPPER=$(eval echo "$("$BIN/project-cfg" "$KEY" chrome wrapper)")
"$WRAPPER" "$URL" &
sleep 1.5
```

If Chrome is already open in a *different* profile and the MCP attaches to it, the inspection will be wrong. When in doubt, ask the user to fully quit Chrome first, then run the wrapper.

Replace `$URL` with whichever environment the user wants (`$LOCAL`, `$STAGING`, `$PROD`).

## Step 2 — Use DevTools MCP tools

| Need | MCP tool |
|---|---|
| List open tabs | `mcp__chrome-devtools__list_pages` |
| Switch active tab | `mcp__chrome-devtools__select_page` |
| Navigate to URL | `mcp__chrome-devtools__navigate_page` |
| Read all console messages | `mcp__chrome-devtools__list_console_messages` |
| Read one console message | `mcp__chrome-devtools__get_console_message` |
| List network requests | `mcp__chrome-devtools__list_network_requests` |
| Inspect one network request | `mcp__chrome-devtools__get_network_request` |
| Run JS in page | `mcp__chrome-devtools__evaluate_script` |
| DOM snapshot (text) | `mcp__chrome-devtools__take_snapshot` |
| Image screenshot | `mcp__chrome-devtools__take_screenshot` |
| Click an element | `mcp__chrome-devtools__click` |
| Fill an input | `mcp__chrome-devtools__fill` |
| Upload a file | `mcp__chrome-devtools__upload_file` |
| Wait for selector / text | `mcp__chrome-devtools__wait_for` |
| Performance trace | `mcp__chrome-devtools__performance_start_trace` + `..._stop_trace` |
| Lighthouse audit | `mcp__chrome-devtools__lighthouse_audit` |

The DevTools tool schemas are deferred — load them as needed via `ToolSearch` with `select:mcp__chrome-devtools__<name>` before calling.

## Common recipes

### "Open the app and check for errors"

1. Open `$LOCAL` (Step 1 for this machine).
2. `select_page` to the new tab.
3. `wait_for` something that indicates the app finished hydrating (e.g. the project title).
4. `list_console_messages` — filter to `error` and `warning`.
5. Report findings; suggest the next step (read a source file, fix, etc.).

### "Screenshot the staging deploy"

1. Open `$STAGING` (Step 1 for this machine).
2. `wait_for` the main heading.
3. `take_screenshot` and save to `./aclim-staging-<timestamp>.png` (these are gitignored by `aclim-*.png` per repo `.gitignore`).
4. If the user asked to compare, repeat for `prod` and place screenshots side by side in a Markdown response.

### "Why is the API call failing"

1. Launch on the relevant URL.
2. Reproduce the user action (click / fill / navigate via MCP).
3. `list_network_requests` filtered to the offending endpoint.
4. `get_network_request` on the failing one — read status, response body, request headers.
5. Cross-reference with backend logs (use `deploy-status` skill if the failure is on staging/prod).

## Working with multiple environments side by side

Don't try to open two profiles in the same Chrome instance — that's exactly the conflict the user just spent an hour cleaning up. Instead:

- **Compare same project across environments**: open one URL, screenshot, navigate to next URL, screenshot.
- **Compare different projects**: quit Chrome between switches; each project's wrapper launches a clean window.

## What not to do

- Don't run `open <URL>` to launch the app — that uses the OS default browser/profile, not the project's profile.
- Don't paste the user's session cookies or auth tokens into chat or commit them — DevTools network panels can expose them.
- Don't `take_screenshot` before `wait_for` settles — empty white screenshots are useless.
- Don't repeatedly poll `list_console_messages` waiting for an error to appear — use `wait_for` on the DOM change that *triggers* the error, then read messages once.
- Don't open DevTools manually (Cmd+Opt+I) and then expect the MCP to coexist — the MCP attaches via remote debugging, which a manual DevTools session can conflict with.

## Related skills

- `personal-projects` — to add `chrome` + `app` topics to a project, or update URLs.
- `deploy-status` — to check whether staging/prod are actually serving before screenshotting them.
- `gcloud-auth` — if you're debugging a Google-auth-protected app and gcloud-driven auth is involved.
