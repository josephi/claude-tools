#!/usr/bin/env node
// Tracks which entries in the user's settings.local.json this plugin wrote, so
// uninstall can remove exactly those and leave the user with what they had.
//
// The record lives in $CLAUDE_PLUGIN_DATA/installed.json, never inside the
// user's own file. JSON forbids comments, and the alternatives are worse: a
// "$comment" key inside `env` would be exported as an environment variable, and
// a sentinel string inside `permissions.deny` would sit in a security-relevant
// list pretending to be a rule. Neither can express per-key ownership anyway,
// which is the whole requirement.
//
// This is the same approach as .ai-tools-manifest.json, which is what let
// uninstall-legacy.mjs remove 41 paths without touching skills the user added.
//
// Three states per entry:
//   added     - the key did not exist; uninstall removes it
//   replaced  - the key held a placeholder we overwrote; uninstall RESTORES it
//   unrecorded- the user already had a real value; uninstall never touches it
//
// Uninstall also refuses to act when the current value no longer matches what we
// wrote. That means the user edited it since setup, and removing it would
// destroy their edit.
//
// Usage:
//   node ownership.mjs plan [--json]
//   node ownership.mjs revert --apply [--json]

import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { atomicWriteFileSync } from '../../../hooks/lib/atomic-write.mjs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { argv, env, stdin, stdout, stderr, exit } from 'node:process';

const RECORD_NAME = 'installed.json';
const RECORD_VERSION = 1;

export function configDir(e = env) {
  return e.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

export function pluginDataDir(e = env) {
  return e.CLAUDE_PLUGIN_DATA?.trim()
    || join(configDir(e), 'plugins', 'data', 'bench-josephi-bench');
}

const recordPath = (dataDir) => join(dataDir, RECORD_NAME);
const settingsPath = (cfg) => join(cfg, 'settings.local.json');

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function readRecord(dataDir) {
  return readJson(recordPath(dataDir));
}

/**
 * Fingerprint for a value we wrote. Used instead of `wroteValue` for secrets, so
 * uninstall still gets its "has the user changed this since setup?" guard without
 * the plaintext token sitting in a file on disk.
 */
export function fingerprint(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function expandHome(value) {
  return typeof value === 'string' ? value.replaceAll('$HOME', homedir()) : value;
}

/**
 * True when `current` matches what we recorded, by value or by hash.
 *
 * With neither recorded there is no way to tell, and the safe direction is to
 * leave it alone: these entries can be credentials, and the record is written by
 * a model following prose, so a missing value is a realistic outcome.
 */
export function matchesWritten(meta, current) {
  if (meta.wroteHash !== undefined) return fingerprint(current) === meta.wroteHash;
  if (meta.wroteValue !== undefined) return expandHome(current) === expandHome(meta.wroteValue);
  return false;
}

/**
 * Merge env ownership across setup runs, per field rather than per entry.
 *
 * `action` and `previous` are earliest-wins: the first run is when we learned
 * whether the key pre-existed, and a later run must not downgrade `replaced` to
 * `added` just because the key is present now (we put it there).
 *
 * `wroteValue` / `wroteHash` are latest-wins. A whole-entry merge kept the first
 * run's value, so a re-run that legitimately rewrote a key left the record
 * disagreeing with the file — and uninstall then skipped that key as
 * "user-modified" for a value the plugin itself had written. Setup is documented
 * as idempotent and runs after every update, so that decayed over time.
 */
export function mergeEnv(prevEnv, nextEnv) {
  const out = { ...prevEnv };
  for (const [key, next] of Object.entries(nextEnv)) {
    const prev = out[key];
    if (!prev) { out[key] = next; continue; }
    out[key] = mergeWritten(prev, next);
  }
  return out;
}

/** action/previous earliest-wins; the recorded value latest-wins. */
function mergeWritten(prev, next) {
  const merged = { ...prev };
  if (next.wroteValue !== undefined) { merged.wroteValue = next.wroteValue; delete merged.wroteHash; }
  if (next.wroteHash !== undefined) { merged.wroteHash = next.wroteHash; delete merged.wroteValue; }
  return merged;
}

/**
 * Same asymmetry as mergeEnv, for the single-value statusLine entry.
 *
 * A whole-value `prev ?? next` merge would keep the first run's command, so a
 * setup that repoints statusLine (as the launcher migration does) would leave
 * the record mismatching the file and uninstall would strand the entry as
 * "user-modified".
 */
export function mergeStatusLine(prev, next) {
  if (!prev) return next ?? null;
  if (!next) return prev;
  return mergeWritten(prev, next);
}

/**
 * Unions the deny entries across runs rather than keeping only the first run's.
 *
 * A later release adding rules would otherwise leave them unrecorded, so
 * uninstall would leave those rules in the user's file.
 */
export function mergeDeny(prev, next) {
  if (!prev) return next ?? null;
  if (!next) return prev;
  const entries = [...new Set([...(prev.entries ?? []), ...(next.entries ?? [])])];
  return { ...prev, action: prev.action ?? next.action, entries };
}

/**
 * Persist what setup wrote. Merges into any existing record so a re-run that
 * adds one new env var doesn't forget the ones recorded earlier.
 */
export function writeRecord(dataDir, changes, { pluginVersion = null, now = null } = {}) {
  const prev = readRecord(dataDir) ?? {};
  const prevEnv = prev.settingsLocal?.env ?? {};

  const record = {
    version: RECORD_VERSION,
    pluginVersion: pluginVersion ?? prev.pluginVersion ?? null,
    writtenAt: now ?? prev.writtenAt ?? null,
    settingsLocal: {
      env: mergeEnv(prevEnv, changes.settingsLocal?.env ?? {}),
      permissionsDeny: mergeDeny(
        prev.settingsLocal?.permissionsDeny, changes.settingsLocal?.permissionsDeny),
      statusLine: mergeStatusLine(
        prev.settingsLocal?.statusLine, changes.settingsLocal?.statusLine),
    },
    claudeMd: prev.claudeMd ?? changes.claudeMd ?? null,
  };

  mkdirSync(dirname(recordPath(dataDir)), { recursive: true });
  // Atomic like settings.local.json: the record is the only ownership signal,
  // so a truncated write here strands every plugin-written key as unrevertable.
  atomicWriteFileSync(recordPath(dataDir), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * What an uninstall would do, without doing it.
 *
 * @returns {{recordPresent, env: {remove: string[], restore: Array, skipped: Array},
 *   permissionsDeny: {remove: string[], skipped: Array}, statusLine: object, claudeMd: object}}
 */
export function planRevert(cfg, dataDir) {
  const record = readRecord(dataDir);
  const out = {
    recordPresent: Boolean(record),
    settingsPath: settingsPath(cfg),
    env: { remove: [], restore: [], skipped: [] },
    permissionsDeny: { remove: [], skipped: [] },
    statusLine: { action: 'none', reason: null },
    claudeMd: { action: 'none' },
  };
  if (!record) return out;

  const settings = readJson(settingsPath(cfg), {}) ?? {};
  const currentEnv = settings.env ?? {};
  const currentDeny = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny : [];

  for (const [key, meta] of Object.entries(record.settingsLocal?.env ?? {})) {
    const current = currentEnv[key];

    if (current === undefined) {
      out.env.skipped.push({ key, reason: 'already absent' });
      continue;
    }
    // The value-match guard: if it changed, the user owns it now. Secrets are
    // recorded as a hash rather than plaintext, so the guard still applies to a
    // rotated token without the token ever being written to disk.
    if (!matchesWritten(meta, current)) {
      out.env.skipped.push({
        key,
        reason: meta.wroteValue === undefined && meta.wroteHash === undefined
          ? 'no recorded value to verify against — remove by hand if you want it gone'
          : 'user-modified since setup',
      });
      continue;
    }
    if (meta.action === 'replaced') out.env.restore.push({ key, previous: meta.previous ?? '' });
    else if (meta.action === 'added') out.env.remove.push(key);
    else out.env.skipped.push({ key, reason: `unknown action "${meta.action}"` });
  }

  const deny = record.settingsLocal?.permissionsDeny;
  if (deny?.action === 'appended') {
    for (const entry of deny.entries ?? []) {
      if (currentDeny.includes(entry)) out.permissionsDeny.remove.push(entry);
      else out.permissionsDeny.skipped.push({ entry, reason: 'already absent' });
    }
  }

  const sl = record.settingsLocal?.statusLine;
  if (sl?.action === 'added') {
    const currentCmd = settings.statusLine?.command;
    if (currentCmd === undefined) out.statusLine = { action: 'none', reason: 'already absent' };
    else if (!matchesWritten(sl, currentCmd)) {
      out.statusLine = { action: 'skip', reason: 'user-modified since setup' };
    } else out.statusLine = { action: 'remove', reason: null };
  }

  if (record.claudeMd?.action === 'markerBlock') out.claudeMd = { action: 'removeBlock' };

  return out;
}

/** How many changes a plan would actually make. */
export function planOperationCount(plan) {
  return plan.env.remove.length
    + plan.env.restore.length
    + plan.permissionsDeny.remove.length
    + (plan.statusLine.action === 'remove' ? 1 : 0);
}

/**
 * Apply a plan to settings.local.json. Every other key in the file is preserved.
 * CLAUDE.md is not touched here — the uninstall skill removes the marker block.
 */
export function applyRevert(cfg, plan) {
  const path = settingsPath(cfg);

  // Nothing to do is not success: reporting changed here would delete the
  // ownership record (stranding any keys skipped as user-modified) and rewrite
  // a file this had no reason to touch.
  if (planOperationCount(plan) === 0) return { changed: false, reason: 'nothing to revert' };

  const settings = readJson(path);
  if (!settings) return { changed: false, reason: 'settings.local.json missing or unreadable' };

  for (const key of plan.env.remove) delete settings.env?.[key];
  for (const { key, previous } of plan.env.restore) {
    if (settings.env) settings.env[key] = previous;
  }

  if (plan.permissionsDeny.remove.length && Array.isArray(settings.permissions?.deny)) {
    const drop = new Set(plan.permissionsDeny.remove);
    settings.permissions.deny = settings.permissions.deny.filter((r) => !drop.has(r));
    // An emptied array we created is noise; an emptied array the user had is theirs.
    if (settings.permissions.deny.length === 0) delete settings.permissions.deny;
    if (settings.permissions && Object.keys(settings.permissions).length === 0) delete settings.permissions;
  }

  if (plan.statusLine.action === 'remove') delete settings.statusLine;

  // Drop `env` only if it is now empty AND we are the reason it is.
  if (settings.env && Object.keys(settings.env).length === 0) delete settings.env;

  try {
    atomicWriteFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (e) {
    return { changed: false, reason: `could not write ${path}: ${e.message}` };
  }
  return { changed: true, settings };
}

export function removeRecord(dataDir) {
  try { unlinkSync(recordPath(dataDir)); return true; } catch { return false; }
}

export function render(plan) {
  if (!plan.recordPresent) {
    return `No ${RECORD_NAME} — this plugin has no record of writing to settings.local.json.\n`
      + 'Nothing will be removed. Anything bench-shaped in there predates ownership tracking\n'
      + 'and is left for you to remove by hand, which is the safe default.';
  }

  const lines = [`settings.local.json: ${plan.settingsPath}`, ''];

  const show = (label, items, fmt) => {
    if (!items.length) return;
    lines.push(`${label} (${items.length}):`);
    for (const i of items) lines.push(`  ${fmt(i)}`);
    lines.push('');
  };

  show('env keys to remove', plan.env.remove, (k) => k);
  show('env keys to restore to their previous value', plan.env.restore,
    (r) => `${r.key} -> ${JSON.stringify(r.previous)}`);
  show('env keys left alone', plan.env.skipped, (s) => `${s.key} (${s.reason})`);
  show('deny rules to remove', plan.permissionsDeny.remove, (e) => e);
  show('deny rules left alone', plan.permissionsDeny.skipped, (s) => `${s.entry} (${s.reason})`);

  if (plan.statusLine.action === 'remove') lines.push('statusLine: remove', '');
  else if (plan.statusLine.reason) lines.push(`statusLine: left alone (${plan.statusLine.reason})`, '');

  if (plan.claudeMd.action === 'removeBlock') {
    lines.push('CLAUDE.md: remove the managed bench rules block', '');
  }

  if (planOperationCount(plan) === 0) lines.push('Nothing to change.');

  return lines.join('\n');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * `record` reads the ownership JSON from stdin.
 *
 * Deliberately not an inline `node -e` snippet in the skill: that needed
 * top-level await (a SyntaxError under CJS, which is how `node -e` evaluates)
 * and passed a bare absolute path as an import specifier, which fails on Windows
 * and mangles backslashes inside the quoted argument. Piping JSON has none of
 * those problems.
 */
async function runRecord(wantJson) {
  let changes;
  try {
    const raw = await readStdin();
    changes = JSON.parse(raw);
  } catch (e) {
    stderr.write(`could not parse the ownership record from stdin: ${e.message}\n`);
    exit(1);
  }

  // JSON.parse accepts `null`, numbers, strings and arrays, all of which reached
  // the destructure below and threw a raw TypeError with a stack trace.
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
    stderr.write('the ownership record must be a JSON object, '
      + `got ${Array.isArray(changes) ? 'an array' : JSON.stringify(changes)}\n`);
    exit(1);
  }

  const { pluginVersion, now, ...rest } = changes;
  const record = writeRecord(pluginDataDir(), rest, {
    pluginVersion: pluginVersion ?? null,
    now: now ?? null,
  });

  if (wantJson) stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  else {
    const envKeys = Object.keys(record.settingsLocal?.env ?? {});
    stdout.write(`Recorded ownership at ${recordPath(pluginDataDir())}\n`);
    stdout.write(`  env keys:    ${envKeys.length ? envKeys.join(', ') : '(none)'}\n`);
    stdout.write(`  deny rules:  ${record.settingsLocal?.permissionsDeny?.entries?.length ?? 0}\n`);
    stdout.write(`  statusLine:  ${record.settingsLocal?.statusLine ? 'recorded' : '(not ours)'}\n`);
  }
  exit(0);
}

function main() {
  const args = argv.slice(2);
  const cmd = args.find((a) => !a.startsWith('--')) ?? 'plan';
  const wantJson = args.includes('--json');
  const apply = args.includes('--apply');

  // A typo'd subcommand used to fall through to `plan` and exit 0, so a mistake in
  // the hand-written invocation inside setup/uninstall SKILL.md looked like success.
  const KNOWN = ['plan', 'revert', 'record'];
  if (!KNOWN.includes(cmd)) {
    stdout.write(`unknown command: ${cmd}\nexpected one of: ${KNOWN.join(', ')}\n`);
    exit(2);
  }

  if (cmd === 'record') return runRecord(wantJson);

  const cfg = configDir();
  const dataDir = pluginDataDir();
  const plan = planRevert(cfg, dataDir);

  let result = null;
  if (cmd === 'revert' && apply && plan.recordPresent) {
    result = applyRevert(cfg, plan);
    // The record is the ONLY ownership signal. Deleting it after a failed revert
    // would leave the user's plugin-written keys permanently unrevertable, so it
    // is removed only once the settings file has actually been rewritten.
    if (result.changed) removeRecord(dataDir);
  }

  const applied = result?.changed === true;

  if (wantJson) {
    stdout.write(`${JSON.stringify({
      ...plan, applied, failureReason: result && !result.changed ? result.reason : null,
    }, null, 2)}\n`);
  } else {
    stdout.write(`${render(plan)}\n`);
    if (applied) stdout.write('\nApplied.\n');
    else if (result) {
      stdout.write(`\nNothing reverted: ${result.reason}\n`);
      stdout.write('The ownership record was kept, so this can be retried once that is fixed.\n');
    }
  }

  // Non-zero when a revert was asked for and could not be done, so a caller
  // cannot mistake a silent failure for success.
  exit(result && !result.changed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}

export { RECORD_NAME, recordPath, settingsPath };
