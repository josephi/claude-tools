#!/usr/bin/env node
// Installs a small, stable launcher at CONFIG_DIR/bench-statusline.mjs.
//
// The plugin cache is version-namespaced
// (plugins/cache/<marketplace>/bench/<version>/), so pointing `statusLine` at
// it directly bakes a version into the user's settings and the statusline breaks
// on the next update. Setup rewriting the path each time is a treadmill, and it
// only works if the user runs setup promptly.
//
// The launcher resolves the newest installed version at run time, so
// settings.local.json holds one path that never needs revisiting.
// `${CLAUDE_PLUGIN_ROOT}` is not an option: it is expanded for hook commands,
// not for `statusLine`.
//
// Usage:
//   node install-launcher.mjs [--print-path] [--json]

import { writeFileSync, mkdirSync, readFileSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { argv, env, stdout, exit } from 'node:process';

const LAUNCHER_NAME = 'bench-statusline.mjs';

export function configDir(e = env) {
  return e.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

export function launcherPath(cfg) {
  return join(cfg, LAUNCHER_NAME);
}

// Kept deliberately tiny and dependency-free: it runs on every statusline render,
// and it must keep working across plugin updates and uninstalls.
export const LAUNCHER_SOURCE = `#!/usr/bin/env node
// Managed by the bench plugin. Do not edit — re-run /bench:setup to refresh.
//
// Resolves the newest installed bench and delegates to its statusline. This
// indirection exists so settings.local.json never holds a version-pinned path.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { env, stdout, exit } from 'node:process';

const cfg = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
const cache = join(cfg, 'plugins', 'cache');

function newest() {
  let best = null;
  try {
    for (const mkt of readdirSync(cache)) {
      let versions;
      try { versions = readdirSync(join(cache, mkt, 'bench')); } catch { continue; }
      for (const v of versions) {
        if (!best || v.localeCompare(best.v, undefined, { numeric: true }) > 0) {
          best = { v, path: join(cache, mkt, 'bench', v) };
        }
      }
    }
  } catch { /* no cache */ }
  return best;
}

const found = newest();
const target = found && join(found.path, 'hooks', 'statusline.mjs');

// Print nothing rather than an error: an uninstalled plugin should leave a blank
// statusline, not a broken one.
if (!target || !existsSync(target)) exit(0);

const mod = await import(pathToFileURL(target).href);

// Call main() explicitly. statusline.mjs guards its own entry point on
// import.meta.url === argv[1], and argv[1] here is THIS launcher, so importing
// alone runs nothing. Setting argv[1] instead would work but is symlink-fragile:
// import.meta.url is resolved through realpath and argv[1] is not.
if (typeof mod.main === 'function') await mod.main();
`;

export function install(cfg = configDir()) {
  const path = launcherPath(cfg);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (existing === LAUNCHER_SOURCE) return { path, changed: false, reason: 'already current' };

  mkdirSync(cfg, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, LAUNCHER_SOURCE);
  renameSync(tmp, path);
  try { chmodSync(path, 0o755); } catch { /* mode is cosmetic; it is invoked via node */ }

  return { path, changed: true, reason: existing ? 'updated' : 'created' };
}

function main() {
  const args = new Set(argv.slice(2));
  const cfg = configDir();

  if (args.has('--print-path')) {
    stdout.write(`${launcherPath(cfg)}\n`);
    exit(0);
  }

  const res = install(cfg);
  if (args.has('--json')) stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  else {
    stdout.write(`statusline launcher ${res.reason}: ${res.path}\n`);
    stdout.write('Point settings.local.json statusLine at:\n');
    // Quoted: the config dir can contain spaces (C:\Users\First Last\.claude).
    stdout.write(`  node "${res.path}"\n`);
    stdout.write('That path is stable across plugin updates.\n');
  }
  exit(0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}

export { LAUNCHER_NAME };
