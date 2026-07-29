// Parses CHANGELOG.md so the SessionStart hook can tell the user what actually
// changed in a plugin update, rather than only that the version moved.
//
// Deliberately a small hand-rolled parser rather than a dependency: this runs on
// every session start and the plugin ships no node_modules.

import { readFileSync } from 'node:fs';

const HEADING = /^##\s*\[?v?(\d+(?:\.\d+)*)\]?(?:\s*-\s*(\S+))?\s*$/;

// A `> one-liner` immediately under a version heading is that version's TL;DR.
// The update report leads with these, because the full entry is too long to scan
// at session start and the user needs the gist before deciding to read on.
const SUMMARY = /^>\s*(.+?)\s*$/;

// Keep a Changelog section headings, mapped to something scannable in a terminal.
const SECTION_EMOJI = {
  added: '✨',
  changed: '🔧',
  deprecated: '⚠️',
  removed: '🗑️',
  fixed: '🐛',
  security: '🔒',
  breaking: '💥',
};

export function sectionEmoji(heading) {
  const key = String(heading).trim().toLowerCase();
  return SECTION_EMOJI[key] ?? '•';
}

// Claude Code renders a hook's systemMessage as a raw string child of an Ink text
// component (`hook_system_message` -> `{hookName} says: {content}`), and the
// binary ships no ANSI-stripping helper, so escape codes reach the terminal.
//
// Two constraints that shape this:
//   1. That component renders dim. Closing a colour with \x1b[0m would reset the
//      host's dim too and leave the rest of the message styled differently, so
//      close with \x1b[39m (default foreground) and never a full reset.
//   2. Colour is applied only to structural markers, never body prose. If a
//      terminal or future renderer does show the codes literally, a few tokens
//      garble instead of the whole report.
//
// Honours NO_COLOR, and BENCH_REPORT_COLOR=0 turns it off outright.
const FG = { cyan: 36, green: 32, yellow: 33, magenta: 35, bold: 1 };

export function colorEnabled(e = {}) {
  if (e.BENCH_REPORT_COLOR === '0') return false;
  if (e.BENCH_REPORT_COLOR === '1') return true;
  return !e.NO_COLOR;
}

export function paint(text, color, e = {}) {
  if (!colorEnabled(e) || !FG[color]) return String(text);
  const close = color === 'bold' ? 22 : 39;
  return `\x1b[${FG[color]}m${text}\x1b[${close}m`;
}

const SECTION_COLOR = {
  added: 'green',
  changed: 'cyan',
  deprecated: 'yellow',
  removed: 'yellow',
  fixed: 'magenta',
  security: 'yellow',
  breaking: 'yellow',
};

/** Prefix `### Added` style headings inside a body with their emoji and colour. */
export function decorateBody(body, e = {}) {
  return String(body).replace(/^#{2,4}\s*([A-Za-z ]+?)\s*$/gm, (m, heading) => {
    const name = heading.trim();
    const color = SECTION_COLOR[name.toLowerCase()];
    return `${sectionEmoji(name)} ${color ? paint(name, color, e) : name}`;
  });
}

/** Numeric-aware compare of dotted versions. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * @returns {Array<{version: string, date: string|null, body: string}>}
 *   Newest first, in file order — the file is authored newest-first and we do not
 *   re-sort, so a mis-ordered file shows up as-is rather than being silently fixed.
 */
export function parseChangelog(text) {
  if (typeof text !== 'string' || text === '') return [];

  const lines = text.split('\n');
  const entries = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(HEADING);
    if (m) {
      if (current) entries.push(current);
      current = { version: m[1], date: m[2] ?? null, summary: null, body: [] };
      continue;
    }
    if (!current) continue;

    // The first blockquote before any body content is the version's TL;DR.
    if (current.summary === null && current.body.every((l) => l.trim() === '')) {
      const s = line.match(SUMMARY);
      if (s) { current.summary = s[1]; continue; }
    }
    current.body.push(line);
  }
  if (current) entries.push(current);

  return entries.map((e) => ({ ...e, body: e.body.join('\n').trim() }));
}

export function loadChangelog(path) {
  try {
    return parseChangelog(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Entries the user has not seen: newer than `from`, up to and including `to`.
 *
 * `from` null/unknown (never initialized, or a legacy guard file with no version)
 * yields only the `to` entry — a first-time user does not want the whole history,
 * and someone upgrading from an unknown version has no meaningful range.
 */
export function entriesBetween(entries, from, to) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  if (!from || from === 'unknown') {
    const exact = entries.find((e) => compareVersions(e.version, to) === 0);
    return exact ? [exact] : [];
  }

  return entries.filter((e) =>
    compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0);
}

/**
 * User-facing report for a version range. Null when there is nothing to say.
 *
 * Leads with a TL;DR because this prints at session start, when the user is
 * trying to get on with something else. The full entries follow for anyone who
 * wants them; the one-liners are what actually gets read.
 */
export function renderUpdateReport(entries, from, to, e = {}) {
  const relevant = entriesBetween(entries, from, to);
  if (relevant.length === 0) return null;

  const rule = '─'.repeat(58);
  const out = [];

  out.push(`📦  ${paint('bench updated', 'bold', e)}`
    + `${from ? ` ${from} -> ` : ' to '}${paint(to, 'cyan', e)}`
    + (relevant.length > 1 ? `  (${relevant.length} versions)` : ''));

  const summaries = relevant.filter((x) => x.summary);
  if (summaries.length) {
    out.push('', `⚡ ${paint('TL;DR', 'yellow', e)}`);
    for (const x of summaries) {
      out.push(relevant.length > 1
        ? `   • ${paint(x.version, 'cyan', e)}  ${x.summary}`
        : `   • ${x.summary}`);
    }
  }

  out.push('', `👉  Run ${paint('/bench:setup', 'green', e)} to apply it.`, '', rule);

  for (const x of relevant) {
    out.push('', `📌  ${paint(x.version, 'cyan', e)}${x.date ? `  ${x.date}` : ''}`,
      '', decorateBody(x.body, e));
  }

  return out.join('\n');
}

/**
 * One-line nag for sessions after the full report has already been shown once.
 * The changelog is worth reading once; repeating it every session trains people
 * to skip it, and the guard file can stay unset for days.
 */
export function renderShortReminder(from, to, e = {}) {
  return `📦  bench ${paint(to, 'cyan', e)} is installed but not set up`
    + `${from ? ` (you last set up ${from})` : ''}.`
    + `  👉  Run ${paint('/bench:setup', 'green', e)}.`;
}

/** Just the version numbers in the range — for a one-line mention. */
export function versionsBetween(entries, from, to) {
  return entriesBetween(entries, from, to).map((e) => e.version);
}
