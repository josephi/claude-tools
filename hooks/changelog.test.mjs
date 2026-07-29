#!/usr/bin/env node
// Tests for lib/changelog.mjs, plus a check that the shipped CHANGELOG.md has a
// section for the version in plugin.json — a released version with no entry
// means the update report silently shows nothing.
//
// Usage: node hooks/changelog.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import {
  parseChangelog, entriesBetween, renderUpdateReport, compareVersions,
  versionsBetween, loadChangelog, colorEnabled, paint, decorateBody, renderShortReminder,
} from './lib/changelog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
let fail = 0;

function step(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('step callback must be synchronous');
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

const SAMPLE = `# Changelog

Preamble text that is not a version.

## [0.6.0] - 2026-07-28

> Sixth summary.

### Added

- Thing three.

## [0.5.0] - 2026-07-27

> Fifth summary.

### Added

- Thing two.

## [0.4.0]

- Thing one.
`;

// Colour defaults ON, so content assertions pass NOCOLOR to keep escape codes out
// of the way. Colour itself is asserted separately below.
const NOCOLOR = { NO_COLOR: '1' };
const COLOR = { CLAUDE_TOOLS_REPORT_COLOR: '1' };

console.log('\nchangelog — version compare');

step('orders numerically, not lexically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

step('tolerates differing segment counts', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.1', '1.2'), 1);
});

step('tolerates junk segments', () => {
  assert.equal(typeof compareVersions('1.x.3', '1.0.3'), 'number');
});

console.log('\nchangelog — parsing');

const entries = parseChangelog(SAMPLE);

step('finds every version section', () => {
  assert.deepEqual(entries.map((e) => e.version), ['0.6.0', '0.5.0', '0.4.0']);
});

step('captures dates when present, null when absent', () => {
  assert.equal(entries[0].date, '2026-07-28');
  assert.equal(entries[2].date, null);
});

step('captures the body and excludes the preamble', () => {
  assert.match(entries[0].body, /Thing three/);
  assert.ok(!entries[0].body.includes('Preamble'));
});

step('extracts the TL;DR blockquote as summary, not body', () => {
  assert.equal(entries[0].summary, 'Sixth summary.');
  assert.equal(entries[1].summary, 'Fifth summary.');
  assert.ok(!entries[0].body.includes('Sixth summary'), 'summary must not duplicate into body');
});

step('summary is null when a version has none', () => {
  assert.equal(entries[2].summary, null);
  assert.match(entries[2].body, /Thing one/);
});

step('a blockquote further down the body is not treated as the summary', () => {
  const e = parseChangelog('## [1.0.0]\n\n### Added\n\n- thing\n\n> a quoted aside\n');
  assert.equal(e[0].summary, null);
  assert.match(e[0].body, /a quoted aside/);
});

step('body stops at the next version heading', () => {
  assert.ok(!entries[0].body.includes('Thing two'));
});

step('handles an empty or absent file', () => {
  assert.deepEqual(parseChangelog(''), []);
  assert.deepEqual(parseChangelog(undefined), []);
  assert.deepEqual(loadChangelog('/nonexistent/CHANGELOG.md'), []);
});

step('accepts headings without brackets or with a v prefix', () => {
  const e = parseChangelog('## 1.2.3\n\n- a\n\n## [v1.2.2]\n\n- b\n');
  assert.deepEqual(e.map((x) => x.version), ['1.2.3', '1.2.2']);
});

step('ignores non-version h2 headings', () => {
  const e = parseChangelog('## Unreleased\n\n- x\n\n## [1.0.0]\n\n- y\n');
  assert.deepEqual(e.map((x) => x.version), ['1.0.0']);
});

console.log('\nchangelog — range selection');

step('returns versions newer than from, up to and including to', () => {
  assert.deepEqual(versionsBetween(entries, '0.4.0', '0.6.0'), ['0.6.0', '0.5.0']);
});

step('excludes the from version itself', () => {
  assert.ok(!versionsBetween(entries, '0.5.0', '0.6.0').includes('0.5.0'));
});

step('includes the to version itself', () => {
  assert.ok(versionsBetween(entries, '0.5.0', '0.6.0').includes('0.6.0'));
});

step('empty when already current', () => {
  assert.deepEqual(versionsBetween(entries, '0.6.0', '0.6.0'), []);
});

step('empty when the guard is somehow ahead', () => {
  assert.deepEqual(versionsBetween(entries, '0.7.0', '0.6.0'), []);
});

step('a first install shows only the installed version', () => {
  assert.deepEqual(versionsBetween(entries, null, '0.6.0'), ['0.6.0']);
});

step('a legacy guard of "unknown" shows only the installed version', () => {
  assert.deepEqual(versionsBetween(entries, 'unknown', '0.6.0'), ['0.6.0']);
});

step('a first install of a version with no section shows nothing', () => {
  assert.deepEqual(versionsBetween(entries, null, '9.9.9'), []);
});

step('spans multiple intermediate versions', () => {
  assert.deepEqual(versionsBetween(entries, '0.3.0', '0.6.0'), ['0.6.0', '0.5.0', '0.4.0']);
});

console.log('\nchangelog — rendering');

step('null when there is nothing to report', () => {
  assert.equal(renderUpdateReport(entries, '0.6.0', '0.6.0'), null);
  assert.equal(renderUpdateReport([], '0.1.0', '0.2.0'), null);
});

step('single-version report names the version', () => {
  const r = renderUpdateReport(entries, '0.5.0', '0.6.0', NOCOLOR);
  assert.match(r, /0\.5\.0 -> 0\.6\.0/);
  assert.match(r, /Thing three/);
  assert.ok(!r.includes('Thing two'));
});

step('multi-version report names the range and count', () => {
  const r = renderUpdateReport(entries, '0.4.0', '0.6.0', NOCOLOR);
  assert.match(r, /0\.4\.0 -> 0\.6\.0/);
  assert.match(r, /2 versions/);
  assert.match(r, /Thing three/);
  assert.match(r, /Thing two/);
});

step('leads with a TL;DR before any detail', () => {
  const r = renderUpdateReport(entries, '0.5.0', '0.6.0', NOCOLOR);
  assert.ok(r.indexOf('TL;DR') < r.indexOf('Thing three'), 'TL;DR must come first');
  assert.match(r, /Sixth summary/);
});

step('multi-version TL;DR labels each version', () => {
  const r = renderUpdateReport(entries, '0.4.0', '0.6.0', NOCOLOR);
  const tldr = r.slice(r.indexOf('TL;DR'), r.indexOf('👉'));
  assert.match(tldr, /0\.6\.0\s+Sixth summary/);
  assert.match(tldr, /0\.5\.0\s+Fifth summary/);
});

step('tells the user what to do next', () => {
  assert.match(renderUpdateReport(entries, '0.5.0', '0.6.0', NOCOLOR), /\/claude-tools:setup/);
});

step('decorates section headings with emoji', () => {
  const r = renderUpdateReport(entries, '0.5.0', '0.6.0', NOCOLOR);
  assert.match(r, /✨ Added/);
  assert.ok(!/^#+\s*Added/m.test(r), 'raw markdown heading should be replaced');
});

step('omits the TL;DR block when no version has a summary', () => {
  const e = parseChangelog('## [1.0.0]\n\n### Added\n\n- thing\n');
  const r = renderUpdateReport(e, null, '1.0.0', NOCOLOR);
  assert.ok(!r.includes('TL;DR'));
  assert.match(r, /thing/);
});

console.log('\nchangelog — colour');

step('colour is off under NO_COLOR', () => {
  assert.equal(colorEnabled(NOCOLOR), false);
  assert.equal(paint('x', 'cyan', NOCOLOR), 'x');
});

step('CLAUDE_TOOLS_REPORT_COLOR=0 wins over an unset NO_COLOR', () => {
  assert.equal(colorEnabled({ CLAUDE_TOOLS_REPORT_COLOR: '0' }), false);
});

step('CLAUDE_TOOLS_REPORT_COLOR=1 wins over NO_COLOR', () => {
  assert.equal(colorEnabled({ NO_COLOR: '1', CLAUDE_TOOLS_REPORT_COLOR: '1' }), true);
});

step('paint wraps with a scoped close, never a full reset', () => {
  const s = paint('x', 'cyan', COLOR);
  assert.equal(s, '\x1b[36mx\x1b[39m');
  assert.ok(!s.includes('\x1b[0m'), 'a full reset would clear the host dim styling');
});

step('bold closes with 22, not 0', () => {
  assert.equal(paint('x', 'bold', COLOR), '\x1b[1mx\x1b[22m');
});

step('an unknown colour name is a no-op', () => {
  assert.equal(paint('x', 'chartreuse', COLOR), 'x');
});

step('the report never emits a full reset', () => {
  const r = renderUpdateReport(entries, '0.4.0', '0.6.0', COLOR);
  assert.ok(!r.includes('\x1b[0m'), `found a full reset in the report`);
  assert.match(r, /\x1b\[36m/, 'expected some colour');
});

step('the report is plain text under NO_COLOR', () => {
  const r = renderUpdateReport(entries, '0.4.0', '0.6.0', NOCOLOR);
  assert.ok(!/\x1b\[/.test(r), 'expected no escape codes at all');
  assert.match(r, /TL;DR/, 'content still present');
});

step('section headings are coloured but still readable', () => {
  const plain = decorateBody('### Added\n\n- x', NOCOLOR);
  assert.equal(plain.split('\n')[0], '✨ Added');
  assert.match(decorateBody('### Added\n\n- x', COLOR), /✨ \x1b\[32mAdded\x1b\[39m/);
});

console.log('\nchangelog — short reminder');

step('names the version and the command', () => {
  const s = renderShortReminder('0.5.0', '0.6.0', NOCOLOR);
  assert.match(s, /0\.6\.0/);
  assert.match(s, /0\.5\.0/);
  assert.match(s, /\/claude-tools:setup/);
});

step('is a single line', () => {
  assert.ok(!renderShortReminder('0.5.0', '0.6.0', NOCOLOR).includes('\n'));
});

step('handles an unknown previous version', () => {
  const s = renderShortReminder(null, '0.6.0', NOCOLOR);
  assert.match(s, /0\.6\.0/);
  assert.ok(!s.includes('you last set up'));
});

console.log('\nchangelog — the shipped file');

const shipped = loadChangelog(join(ROOT, 'CHANGELOG.md'));
const installedVersion = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

step('CHANGELOG.md parses and has entries', () => {
  assert.ok(shipped.length > 0, 'no version sections found');
});

step(`has a section for the current plugin version (${installedVersion})`, () => {
  const found = shipped.some((e) => compareVersions(e.version, installedVersion) === 0);
  assert.ok(found, `CHANGELOG.md has no "## [${installedVersion}]" section — the update report would show nothing`);
});

step('is ordered newest-first', () => {
  for (let i = 1; i < shipped.length; i++) {
    assert.ok(
      compareVersions(shipped[i - 1].version, shipped[i].version) > 0,
      `${shipped[i - 1].version} should sort above ${shipped[i].version}`,
    );
  }
});

step('every entry has a non-empty body', () => {
  for (const e of shipped) assert.ok(e.body.length > 10, `[${e.version}] body is empty`);
});

step('every shipped version has a TL;DR summary', () => {
  for (const e of shipped) {
    assert.ok(e.summary && e.summary.length > 10,
      `[${e.version}] has no "> one-liner" TL;DR — the update report would lead with nothing`);
  }
});

step('the shipped report renders with a TL;DR ahead of the detail', () => {
  const r = renderUpdateReport(shipped, shipped.at(-1).version, installedVersion);
  assert.ok(r, 'expected a report across the full shipped range');
  assert.ok(r.indexOf('TL;DR') < r.indexOf('📌'), 'TL;DR must precede the per-version detail');
  assert.match(r, /\/claude-tools:setup/);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
