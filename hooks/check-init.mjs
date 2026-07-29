#!/usr/bin/env node
// SessionStart hook. Emits SessionStart additionalContext asking Claude to run
// the bench:setup skill when the plugin is not yet initialized on this
// machine, or when it was updated since the last init (guard-file version !=
// installed version). Claude Code has no plugin-install/update hook event, so
// SessionStart — the first event after an install/update + reload — is the
// trigger. Hooks can't invoke a skill directly; injecting an instruction and
// letting Claude act on it is the only available mechanism.
//
// Contract: exit 0 always (a hook failure must never block session start), and
// print the JSON envelope only when action is needed — silence otherwise.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { argv, env, stdout, exit } from 'node:process';
import {
  loadChangelog, renderUpdateReport, renderShortReminder, compareVersions,
} from './lib/changelog.mjs';

const HOME = homedir();

// Honor CLAUDE_CONFIG_DIR (Claude Code's override for the ~/.claude location).
// Used only for the out-of-context fallbacks below; in a real hook run
// CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA are authoritative.
const CLAUDE_DIR = env.CLAUDE_CONFIG_DIR?.trim() || join(HOME, '.claude');

// The plugin installs into a version-namespaced cache:
// <config-dir>/plugins/cache/<marketplace>/bench/<version>/. When run outside
// plugin context (CLAUDE_PLUGIN_ROOT unset) pick the highest installed version.
function discoverPluginRoot() {
  const cache = join(CLAUDE_DIR, 'plugins', 'cache');
  let best = null;
  try {
    for (const mkt of readdirSync(cache)) {
      const tipDir = join(cache, mkt, 'bench');
      let versions;
      try { versions = readdirSync(tipDir); } catch { continue; }
      for (const v of versions) {
        if (!best || compareVersions(v, best.version) > 0) best = { version: v, path: join(tipDir, v) };
      }
    }
  } catch { /* no cache dir */ }
  return best?.path ?? null;
}

// CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA are set in plugin hook context. The
// data fallback follows Claude Code's canonical layout
// (plugins/data/<plugin>-<marketplace>); the root fallback scans the cache.
const PLUGIN_ROOT = env.CLAUDE_PLUGIN_ROOT?.trim() || discoverPluginRoot();
const PLUGIN_DATA = env.CLAUDE_PLUGIN_DATA?.trim()
  || join(CLAUDE_DIR, 'plugins', 'data', 'bench-josephi-bench');
const GUARD_FILE = join(PLUGIN_DATA, '.initialized');

function installedVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

// The guard file stores the plugin version last initialized. Absent → never
// initialized. A legacy empty guard (pre-version-tracking) reads as '' → treat
// as initialized-at-unknown-version so we don't nag existing users, but still
// re-trigger once the installed version is a real string that differs.
function guardVersion() {
  try {
    return readFileSync(GUARD_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

function buildContext(installed, guard) {
  if (guard === null) {
    return `The bench plugin (v${installed}) is installed but not yet initialized on this machine. `
      + `Run the bench:setup skill now to finish setup: it offers the base-branch pre-commit `
      + `hook per repository and registers projects in the projects.<key> block of `
      + `<config-dir>/settings.local.json. Confirm with the user before prompting for any secret. `
      + `On completion the skill records the version in the guard file so this stops appearing.`;
  }
  // An unresolvable plugin root reports 'unknown', which is a broken install, not
  // an update. Without this the hook claimed "updated to vunknown" every single
  // session, rendered a report against a version that has no changelog entry, and
  // recorded 'unknown' as the seen-version. Running setup would not fix any of it.
  if (installed === 'unknown') return null;

  if (guard !== installed) {
    return `The bench plugin was updated (initialized v${guard || 'legacy'} -> now v${installed}). `
      + `Run the bench:setup skill to apply any new rules or env-var questions from the update. `
      + `It is idempotent and only changes what is new, then records v${installed} in the guard file. `
      + `The changelog for this range has already been shown to the user, so summarise rather than repeat it.`;
  }
  return null;
}

// Which version's full changelog has already been shown. Separate from the
// .initialized guard on purpose: the guard tracks "setup has run", this tracks
// "the human has read the news". Without the split, the whole changelog reprints
// every session until setup runs, which trains people to skip it.
const SEEN_FILE = join(PLUGIN_DATA, '.changelog-seen');

function seenVersion() {
  try {
    return readFileSync(SEEN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

function markSeen(version) {
  try {
    mkdirSync(PLUGIN_DATA, { recursive: true });
    writeFileSync(SEEN_FILE, version);
  } catch {
    // Unwritable data dir just means the full report shows again next session.
    // Degraded, not broken, and never worth failing session start over.
  }
}

// The user-facing half: what actually changed. The context above tells the model
// to run setup; this tells the human why they should let it. Only on an update —
// a first install has no "changed" to report.
//
// Full report the first session after an update, a one-liner thereafter.
function buildUpdateReport(installed, guard, seen = seenVersion(), e = env) {
  if (guard === null || guard === installed) return null;

  if (seen === installed) return renderShortReminder(guard || null, installed, e);

  const entries = loadChangelog(join(PLUGIN_ROOT ?? '', 'CHANGELOG.md'));
  return renderUpdateReport(entries, guard || null, installed, e)
    ?? renderShortReminder(guard || null, installed, e);
}

function main() {
  try {
    const installed = installedVersion();
    const guard = guardVersion();

    const context = buildContext(installed, guard);
    const seen = seenVersion();
    const report = buildUpdateReport(installed, guard, seen);

    // Record that this version's changelog has been shown, so the next session
    // gets the one-liner. Only after deciding to print it, and only on a real
    // update — a first install shows no report and must not be marked as read.
    if (report && guard !== null && guard !== installed && seen !== installed) {
      markSeen(installed);
    }

    if (context || report) {
      const out = {};
      if (context) out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: context };
      if (report) out.systemMessage = report;
      stdout.write(JSON.stringify(out));
    }
  } catch {
    // Fail open: a nag is never worth failing session start over.
  }
  exit(0);
}

// Run only when invoked directly (node check-init.mjs), not when imported by tests.
if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}

export { buildContext, buildUpdateReport, installedVersion, guardVersion, seenVersion, markSeen, GUARD_FILE, SEEN_FILE, PLUGIN_ROOT, PLUGIN_DATA };
