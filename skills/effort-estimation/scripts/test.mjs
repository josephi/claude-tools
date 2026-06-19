#!/usr/bin/env node
// Smoke test for effort.mjs — exercises CLI parsing and the offline `estimate` path.
// The `record`/`backfill` commands shell out to `gh`, so only behavior reachable
// without network is tested: usage errors and estimation over a seeded fixture.
//
// Strategy: point HOME at a temp dir so loadHistory() reads a fixture we control
// (~/.claude-personal/data/effort-estimation/history.jsonl) instead of real data.

import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'effort.mjs');

let pass = 0, fail = 0;

function step(label, fn) {
    try { fn(); console.log(`  ok ${label}`); pass++; }
    catch (e) { console.error(`  FAIL ${label}\n      ${e.message}`); fail++; }
}

function run(args, env = {}) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, ...env },
    });
}

async function main() {
    const tmp = await mkdtemp(join(tmpdir(), 'effort-test-'));

    try {
        step('exits non-zero with usage when no command given', () => {
            const r = run([], { HOME: tmp });
            assert.equal(r.status, 2, `exit ${r.status}; stderr: ${r.stderr}`);
            assert.match(r.stderr || '', /usage/i);
        });

        step('exits non-zero on unknown command', () => {
            const r = run(['bogus'], { HOME: tmp });
            assert.equal(r.status, 2);
            assert.match(r.stderr || '', /usage/i);
        });

        step('record without numbers prints usage and exits 2', () => {
            const r = run(['record', '--repo', 'o/r'], { HOME: tmp });
            assert.equal(r.status, 2);
            assert.match(r.stderr || '', /record <issue-number/);
        });

        step('estimate with no history reports no calibration data', () => {
            const r = run(['estimate'], { HOME: tmp });
            assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr}`);
            assert.match(r.stdout || '', /no calibration data/i);
        });

        // Seed a history fixture and assert estimate summarizes it (fully offline).
        const dataDir = join(tmp, '.claude-personal', 'data', 'effort-estimation');
        await mkdir(dataDir, { recursive: true });
        const records = [
            { key: 'o/r#1', type: 'feat', size: 'S', cycleDays: 2, leadDays: 4, pr: null },
            { key: 'o/r#2', type: 'feat', size: 'M', cycleDays: 6, leadDays: 9, pr: null },
        ];
        await writeFile(join(dataDir, 'history.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');

        step('estimate summarizes seeded history with median/p75', () => {
            const r = run(['estimate'], { HOME: tmp });
            assert.equal(r.status, 0, `exit ${r.status}; stderr: ${r.stderr}`);
            assert.match(r.stdout || '', /cycle \(start.*closed\)/);
            assert.match(r.stdout || '', /median=/);
            assert.match(r.stdout || '', /type: feat/);
        });

        step('estimate --size filter selects matching records only', () => {
            const r = run(['estimate', '--size', 'S'], { HOME: tmp });
            assert.equal(r.status, 0);
            assert.match(r.stdout || '', /median=2d/);
        });

        step('estimate --type filter with no match reports no calibration data', () => {
            const r = run(['estimate', '--type', 'bug'], { HOME: tmp });
            assert.equal(r.status, 0);
            assert.match(r.stdout || '', /no calibration data/i);
        });

        step('script imports cleanly (no syntax error)', () => {
            const r = run(['estimate'], { HOME: tmp });
            assert.ok(!(r.stderr || '').includes('SyntaxError'));
            assert.ok(!(r.stderr || '').includes('Cannot find'));
        });
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
