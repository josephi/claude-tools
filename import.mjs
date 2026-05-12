#!/usr/bin/env node
// Pull personal-classified items from a work AI-tools repo into this one.
//
// Usage:
//   node import.mjs [--source <path>] [--dry-run] [--force]
//
// Defaults:
//   source = $AI_TOOLS_WORK or ~/repos/.ai-tools
//
// Routing (read from `tags` frontmatter):
//   audience/personal or audience/both → pulled
//   audience/work                       → skipped
//   portable/verbatim                   → copied to live tree (overwrites on re-run)
//   portable/adapt                      → copied to pending-adaptation/ ONLY if
//                                         not already in pending or live tree
//   portable/none                       → never pulled (paired with audience/work)
//   internal: true                      → skipped
//
// Re-running is safe: verbatim items track upstream, adapt items are not
// clobbered once they exist anywhere in the personal tree.

import { readdir, readFile, mkdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const FLAGS = new Set(argv.slice(2).filter((a) => a.startsWith('--')));
const DRY = FLAGS.has('--dry-run');
const FORCE = FLAGS.has('--force');

const sourceFlagIdx = argv.indexOf('--source');
const SOURCE = sourceFlagIdx !== -1 && argv[sourceFlagIdx + 1]
  ? resolve(argv[sourceFlagIdx + 1])
  : resolve(env.AI_TOOLS_WORK || join(homedir(), 'repos', '.ai-tools'));

if (!existsSync(SOURCE)) {
  console.error(`source not found: ${SOURCE}`);
  console.error('pass --source <path> or set AI_TOOLS_WORK');
  exit(1);
}

const log = (...args) => console.log(...args);

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function parseInlineTags(s) {
  if (!s || !s.startsWith('[') || !s.endsWith(']')) return [];
  return s.slice(1, -1).split(',').map((t) => t.trim()).filter(Boolean);
}

function classify(fm) {
  if (fm.internal === 'true' || fm.internal === true) return { skip: 'internal' };
  const tags = parseInlineTags(fm.tags);
  const audience = tags.find((t) => t.startsWith('audience/'))?.slice('audience/'.length);
  const portable = tags.find((t) => t.startsWith('portable/'))?.slice('portable/'.length);
  if (!audience || !portable) return { skip: 'untagged' };
  if (audience === 'work') return { skip: 'work' };
  return { audience, portable };
}

async function readFm(path) {
  try { return parseFrontmatter(await readFile(path, 'utf8')); }
  catch { return {}; }
}

const SKIP_BASENAMES = new Set(['.DS_Store', 'Icon\r', 'node_modules']);
function copyFilter(src) {
  const base = src.split('/').pop();
  return !SKIP_BASENAMES.has(base);
}

async function copyItem(srcPath, destPath, isDir) {
  if (DRY) { log(`  [dry-run] ${srcPath} → ${destPath}`); return; }
  await mkdir(dirname(destPath), { recursive: true });
  await cp(srcPath, destPath, { recursive: isDir, force: true, filter: copyFilter });
}

async function hashFile(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function* walkFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_BASENAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

async function dirHash(dir) {
  const items = [];
  for await (const file of walkFiles(dir)) {
    items.push({ rel: file.slice(dir.length + 1), hash: await hashFile(file) });
  }
  items.sort((a, b) => a.rel.localeCompare(b.rel));
  return createHash('sha256').update(items.map((i) => `${i.rel}:${i.hash}`).join('\n')).digest('hex');
}

async function hasDrifted(srcPath, destPath, isDir) {
  if (!existsSync(destPath)) return true;
  return isDir
    ? (await dirHash(srcPath)) !== (await dirHash(destPath))
    : (await hashFile(srcPath)) !== (await hashFile(destPath));
}

const stats = {
  verbatimUpdated: 0, verbatimUnchanged: 0,
  adaptedNew: 0, adaptedRefreshed: 0, adaptedKeptLive: 0, adaptedKeptPending: 0, adaptedUnchanged: 0,
  skippedWork: 0, skippedInternal: 0, skippedUntagged: 0,
};

async function processItem({ kind, name, srcPath, isDir }) {
  const fmPath = isDir ? join(srcPath, 'SKILL.md') : srcPath;
  if (!existsSync(fmPath)) return;
  const fm = await readFm(fmPath);
  const c = classify(fm);

  if (c.skip === 'internal')  { stats.skippedInternal++;  return; }
  if (c.skip === 'work')      { stats.skippedWork++;      return; }
  if (c.skip === 'untagged')  { stats.skippedUntagged++;  log(`  warning: ${kind}/${name} has no audience/portable tags`); return; }

  const livePath    = join(HERE, kind, name);
  const pendingPath = join(HERE, 'pending-adaptation', kind, name);

  if (c.portable === 'verbatim') {
    if (!(await hasDrifted(srcPath, livePath, isDir))) {
      stats.verbatimUnchanged++;
      return;
    }
    await copyItem(srcPath, livePath, isDir);
    stats.verbatimUpdated++;
    log(`  verbatim → ${kind}/${name}`);
    return;
  }

  if (c.portable === 'adapt') {
    // Once an adapt item is in the live tree, the user has rewired it — never clobber.
    if (existsSync(livePath)) {
      stats.adaptedKeptLive++;
      if (FORCE) log(`  keep    ← ${kind}/${name} (in live tree; --force does not overwrite adaptations)`);
      return;
    }
    if (existsSync(pendingPath)) {
      if (!FORCE) {
        stats.adaptedKeptPending++;
        log(`  keep    ← ${kind}/${name} (in pending-adaptation; pass --force to refresh)`);
        return;
      }
      if (!(await hasDrifted(srcPath, pendingPath, isDir))) {
        stats.adaptedUnchanged++;
        return;
      }
      await copyItem(srcPath, pendingPath, isDir);
      stats.adaptedRefreshed++;
      log(`  refresh → pending-adaptation/${kind}/${name}`);
      return;
    }
    await copyItem(srcPath, pendingPath, isDir);
    stats.adaptedNew++;
    log(`  adapt   → pending-adaptation/${kind}/${name}`);
    return;
  }

  log(`  warning: ${kind}/${name} has portable/${c.portable} with audience/${c.audience}`);
}

async function walkRules() {
  const dir = join(SOURCE, 'rules');
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name === 'README.md') continue;
    await processItem({
      kind: 'rules',
      name: entry.name,
      srcPath: join(dir, entry.name),
      isDir: false,
    });
  }
}

async function walkSkills() {
  const dir = join(SOURCE, 'skills');
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    await processItem({
      kind: 'skills',
      name: entry.name,
      srcPath: join(dir, entry.name),
      isDir: true,
    });
  }
}

async function walkAgents() {
  const dir = join(SOURCE, 'agents');
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name === 'README.md') continue;
    await processItem({
      kind: 'agents',
      name: entry.name,
      srcPath: join(dir, entry.name),
      isDir: false,
    });
  }
}

log(`importing from ${SOURCE}${DRY ? ' (dry-run)' : ''}${FORCE ? ' (force)' : ''}\n`);
log('rules:');   await walkRules();
log('\nskills:'); await walkSkills();
log('\nagents:'); await walkAgents();

log('\n── summary ──');
log(`  verbatim updated:          ${stats.verbatimUpdated}`);
log(`  verbatim unchanged:        ${stats.verbatimUnchanged}`);
log(`  adapt queued (new):        ${stats.adaptedNew}`);
log(`  adapt refreshed:           ${stats.adaptedRefreshed}`);
log(`  adapt unchanged:           ${stats.adaptedUnchanged}`);
log(`  kept (live tree):          ${stats.adaptedKeptLive}`);
log(`  kept (pending):            ${stats.adaptedKeptPending}`);
log(`  skipped (work-only):       ${stats.skippedWork}`);
log(`  skipped (internal):        ${stats.skippedInternal}`);
if (stats.skippedUntagged) log(`  skipped (untagged):        ${stats.skippedUntagged}`);
if (DRY) log('\n(dry-run; no files written)');
