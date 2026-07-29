#!/usr/bin/env node
// Statusline: task context, unpushed count, and bench hook health.
//
// The hook-health segment is the reason this exists rather than being another
// hook. When `disableAllHooks: true` is set, or the plugin is disabled, *no hook
// runs* — so no hook can warn that hooks are off. The statusline is a separate
// subsystem that still renders, which makes it the only channel that can report
// its own absence.
//
// Reads the statusline JSON payload on stdin and prints one line on stdout.
// Must be fast and must never crash: a throwing statusline shows an error where
// the user expects context, on every render.
//
// Opt out of colour with NO_COLOR, or BENCH_REPORT_COLOR=0.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { argv, env, stdin, stdout, exit, cwd as processCwd } from 'node:process';
import { taskContext } from './lib/task-context.mjs';
import { colorEnabled } from './lib/changelog.mjs';

const CLAUDE_DIR = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
const PLUGIN_DATA = env.CLAUDE_PLUGIN_DATA?.trim()
  || join(CLAUDE_DIR, 'plugins', 'data', 'bench-josephi-bench');

// colorEnabled treats NO_COLOR=0 as "colour on"; a bare !env.NO_COLOR did not,
// because the string '0' is truthy.
const USE_COLOR = colorEnabled(env);
const c = (code, s) => (USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c('2', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const green = (s) => c('32', s);
const cyan = (s) => c('36', s);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * Are bench's hooks actually going to run?
 *
 * Checks the two settings files a user can realistically break this in. Managed
 * settings could also disable hooks and are not readable here, so a clean result
 * means "nothing locally disables them", not a hard guarantee.
 *
 * @returns {{ok: boolean, reason: string|null}}
 */
export function hookHealth({ claudeDir = CLAUDE_DIR, pluginData = PLUGIN_DATA } = {}) {
  for (const file of ['settings.json', 'settings.local.json']) {
    const s = readJson(join(claudeDir, file));
    if (s?.disableAllHooks === true) {
      return { ok: false, reason: `hooks OFF (disableAllHooks in ${file})` };
    }
  }

  const settings = readJson(join(claudeDir, 'settings.json')) ?? {};
  const local = readJson(join(claudeDir, 'settings.local.json')) ?? {};
  const enabled = { ...settings.enabledPlugins, ...local.enabledPlugins };
  const key = Object.keys(enabled).find((k) => k.startsWith('bench@'));

  if (key && enabled[key] === false) return { ok: false, reason: 'bench plugin disabled' };
  if (!key) return { ok: false, reason: 'bench plugin not enabled' };

  if (!existsSync(join(pluginData, '.initialized'))) {
    return { ok: false, reason: 'bench not set up (/bench:setup)' };
  }

  return { ok: true, reason: null };
}

export function renderSegments(ctx, health) {
  const segments = [];

  if (!ctx) {
    segments.push(dim('not a git repo'));
  } else {
    if (ctx.issueRef) segments.push(cyan(ctx.issueRef));
    else if (ctx.onBase) segments.push(red('no task'));
    else segments.push(yellow('no issue'));

    if (ctx.branch) {
      segments.push(ctx.onBase ? red(ctx.branch) : ctx.branch);
    }
    if (ctx.base && !ctx.onBase) segments.push(dim(`<- ${ctx.base}`));

    if (ctx.unpushed > 0) segments.push(yellow(`unpushed:${ctx.unpushed}`));
    else if (ctx.branch && !ctx.onBase) segments.push(green('pushed'));

    if (ctx.worktree) segments.push(dim('wt'));
  }

  if (!health.ok) segments.push(red(`! ${health.reason}`));

  return segments;
}

export function renderLine(ctx, health) {
  return renderSegments(ctx, health).join(dim(' | '));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let dir = processCwd();
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      const payload = JSON.parse(raw);
      dir = payload.workspace?.current_dir || payload.cwd || dir;
    }
  } catch { /* no payload — fall back to cwd */ }

  try {
    stdout.write(renderLine(taskContext(dir), hookHealth()));
  } catch {
    // Never surface a stack trace where the user expects their branch name.
    stdout.write(dim('bench statusline unavailable'));
  }
  exit(0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}

// Exported so the stable launcher (skills/setup/scripts/install-launcher.mjs) can
// invoke it after importing. The guard above compares against argv[1], which for
// a launcher run is the launcher's own path, so it does not fire — the launcher
// must call this directly. Comparing paths there would also be symlink-fragile,
// since import.meta.url is resolved through realpath and argv[1] is not.
export { main };
