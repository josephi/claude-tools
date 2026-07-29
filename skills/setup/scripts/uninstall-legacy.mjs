#!/usr/bin/env node
// Removes the legacy `sync.mjs` install of skills, agents, and commands.
//
// Why this exists: sync.mjs copied every skill into CONFIG_DIR/skills/ while the
// plugin also ships them under its own namespace. Anyone who ran both loaded ~33
// skills twice — roughly doubling routing context and letting two copies of the
// same skill disagree — and deletions never propagated (`hud` survived being
// removed from the plugin). The plugin is now the sole owner.
//
// Safety: only paths recorded in .ai-tools-manifest.json are touched. Anything the
// user added to CONFIG_DIR themselves was never in the manifest and is left alone.
// Dry-run is the default; --apply is required to delete.
//
// Usage:
//   node uninstall-legacy.mjs [--json]            # report only
//   node uninstall-legacy.mjs --apply [--json]    # remove

import { readFileSync, existsSync, rmSync, unlinkSync, lstatSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { argv, env, stdout, exit } from 'node:process';

const MANIFEST_NAME = '.ai-tools-manifest.json';

export function configDir(e = env) {
  return e.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

export function readManifest(cfg) {
  const path = join(cfg, MANIFEST_NAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { malformed: true };
  }
}

/** A manifest entry is only usable if it is a plain, non-hidden basename. */
export function isSafeEntry(name) {
  return typeof name === 'string'
    && name !== ''
    && name === basename(name)
    && !name.startsWith('.');
}

/**
 * What the manifest claims ownership of that still exists on disk.
 * @returns {{skills: string[], agents: string[], commands: string[], missing: number, rejected: string[]}}
 */
export function plan(cfg, manifest) {
  const out = { skills: [], agents: [], commands: [], missing: 0, rejected: [] };
  if (!manifest || manifest.malformed) return out;

  const groups = [
    ['skills', 'skills', true],
    ['agents', 'agents', false],
    ['commands', 'commands', false],
  ];

  for (const [key, dir, isDir] of groups) {
    for (const name of manifest[key] ?? []) {
      // The manifest is the sole authority for a recursive delete and lives in a
      // user-writable file, so entries must be plain basenames. `join` would
      // resolve `../../Documents` outside the config dir, and an absolute entry
      // would replace the prefix entirely.
      if (!isSafeEntry(name)) { out.rejected.push(String(name)); continue; }

      // A manifest entry may be a bare name or already have the .md suffix.
      const candidates = isDir
        ? [join(cfg, dir, name)]
        : [join(cfg, dir, name), join(cfg, dir, `${name}.md`)];
      const found = candidates.find((p) => existsSync(p));
      if (found) out[key].push(found);
      else out.missing++;
    }
  }
  return out;
}

/** Legacy sync.mjs rules section in CLAUDE.md, which the plugin's marker block replaces. */
export function legacyRulesSection(cfg) {
  const path = join(cfg, 'CLAUDE.md');
  if (!existsSync(path)) return null;
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }

  const hasMarker = raw.includes('<!-- BEGIN claude-tools rules -->');
  const lines = raw.split('\n');
  const idx = lines.findIndex((l) => /^# Rules$/.test(l));
  if (idx === -1) return null;

  const end = hasMarker
    ? lines.findIndex((l) => l.includes('<!-- BEGIN claude-tools rules -->'))
    : lines.length;

  // A marker sitting ABOVE `# Rules` would make end < idx; clamp so the report
  // never shows a negative range.
  const endLine = Math.max(end, idx);
  return { path, startLine: idx + 1, endLine, lineCount: Math.max(0, endLine - idx), hasMarker };
}

export function removeAll(target) {
  const removed = [];
  const failed = [];
  for (const p of [...target.skills, ...target.agents, ...target.commands]) {
    try {
      // lstat, not stat: on a delete path a symlinked skill dir must be unlinked,
      // not followed into and recursively removed.
      if (lstatSync(p).isDirectory()) rmSync(p, { recursive: true, force: true });
      else unlinkSync(p);
      removed.push(p);
    } catch (e) {
      failed.push({ path: p, error: e.message });
    }
  }
  return { removed, failed };
}

export function removeManifest(cfg) {
  const path = join(cfg, MANIFEST_NAME);
  try { unlinkSync(path); return true; } catch { return false; }
}

function render(result) {
  const { cfg, manifest, target, rules, applied, removed, failed } = result;

  if (!manifest) {
    return `No ${MANIFEST_NAME} in ${cfg} — the legacy sync.mjs path was never used here. Nothing to do.`;
  }
  if (manifest.malformed) {
    return `${MANIFEST_NAME} in ${cfg} is malformed and cannot be trusted to say what it owns. `
      + 'Remove the duplicate skills/agents/commands by hand, or delete the manifest and re-check.';
  }

  const total = target.skills.length + target.agents.length + target.commands.length;
  const lines = [];

  lines.push(applied ? 'Removed the legacy sync.mjs install:' : 'Legacy sync.mjs install found (dry run):');
  lines.push(`  config dir : ${cfg}`);
  lines.push(`  skills     : ${target.skills.length}`);
  lines.push(`  agents     : ${target.agents.length}`);
  lines.push(`  commands   : ${target.commands.length}`);
  if (target.missing) lines.push(`  (${target.missing} manifest entries already gone)`);
  if (target.rejected?.length) {
    lines.push('', `  REFUSED ${target.rejected.length} unsafe manifest ${target.rejected.length === 1 ? 'entry' : 'entries'}:`);
    for (const r of target.rejected) lines.push(`    ${JSON.stringify(r)}`);
    lines.push('  Entries must be plain file or directory names. Nothing outside the config dir is touched.');
  }

  if (rules) {
    lines.push(`  CLAUDE.md  : legacy "# Rules" section at line ${rules.startLine}, ~${rules.lineCount} lines`
      + (rules.hasMarker ? ' (duplicates the plugin marker block below it)' : ''));
  }

  if (applied) {
    lines.push('', `Deleted ${removed.length} path(s).`);
    if (failed.length) {
      lines.push(`Failed to delete ${failed.length}:`);
      for (const f of failed) lines.push(`  ${f.path} — ${f.error}`);
    }
    if (rules) {
      lines.push('', 'The CLAUDE.md "# Rules" section was NOT touched — the setup skill rewrites that file');
      lines.push('as part of installing the managed marker block.');
    }
    lines.push('', 'Restart Claude Code so the removed skills stop loading.');
  } else if (total > 0 || rules) {
    lines.push('', 'Re-run with --apply to remove. Only paths listed in the manifest are touched;');
    lines.push('anything you added to the config dir yourself was never in it and is left alone.');
  } else {
    lines.push('', 'Manifest present but nothing it owns is still on disk — safe to delete the manifest.');
  }

  return lines.join('\n');
}

export function run({ apply = false, e = env } = {}) {
  const cfg = configDir(e);
  const manifest = readManifest(cfg);
  const target = plan(cfg, manifest);
  const rules = legacyRulesSection(cfg);

  let removed = [];
  let failed = [];
  if (apply && manifest && !manifest.malformed) {
    ({ removed, failed } = removeAll(target));
    if (failed.length === 0) removeManifest(cfg);
  }

  return { cfg, manifest, target, rules, applied: apply, removed, failed };
}

function main() {
  const args = new Set(argv.slice(2));
  const result = run({ apply: args.has('--apply') });

  if (args.has('--json')) {
    stdout.write(JSON.stringify({
      configDir: result.cfg,
      manifestPresent: Boolean(result.manifest),
      manifestMalformed: Boolean(result.manifest?.malformed),
      counts: {
        skills: result.target.skills.length,
        agents: result.target.agents.length,
        commands: result.target.commands.length,
        alreadyGone: result.target.missing,
      },
      rejectedEntries: result.target.rejected,
      legacyRulesSection: result.rules,
      applied: result.applied,
      removed: result.removed.length,
      failed: result.failed,
    }, null, 2));
  } else {
    stdout.write(`${render(result)}\n`);
  }

  exit(result.failed.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  main();
}

export { render, MANIFEST_NAME };
