#!/usr/bin/env node
// Test runner — discovers and executes scripts/test.mjs in every skill dir plus
// every hooks/*.test.mjs. Aggregates results and exits non-zero on any failure.
//
// Usage: node scripts/test.mjs [--skill <name>] [--quiet]

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { argv, exit } from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLAGS = parseFlags(argv.slice(2));

function parseFlags(rest) {
    const out = { _: [] };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith('--')) {
            const next = rest[i + 1];
            if (next && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
            else { out[a.slice(2)] = true; }
        } else {
            out._.push(a);
        }
    }
    return out;
}

// Picks up both scripts/test.mjs and scripts/<name>.test.mjs. Only matching the
// exact filename meant a skill's second test file was silently never run, which
// is worse than having no test at all.
async function discoverSkillTests() {
    const skillsDir = join(ROOT, 'skills');
    if (!existsSync(skillsDir)) return [];
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const tests = [];
    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
        if (FLAGS.skill && e.name !== FLAGS.skill) continue;

        const scriptsDir = join(skillsDir, e.name, 'scripts');
        if (!existsSync(scriptsDir)) continue;

        for (const f of await readdir(scriptsDir, { withFileTypes: true })) {
            if (!f.isFile()) continue;
            if (f.name !== 'test.mjs' && !f.name.endsWith('.test.mjs')) continue;
            const label = f.name === 'test.mjs' ? e.name : `${e.name}/${f.name.replace(/\.test\.mjs$/, '')}`;
            tests.push({ skill: label, file: join(scriptsDir, f.name) });
        }
    }
    return tests.sort((a, b) => a.skill.localeCompare(b.skill));
}

// Hooks and repo-level scripts live outside any skill dir, so each needs its own
// discovery pass — otherwise the harness silently covers none of them. This bit
// them: scripts/eval-triggers.test.mjs existed and passed by hand while the suite
// total never moved, which reads as "covered" when nothing was running it.
async function discoverDirTests(relDir) {
    const dir = join(ROOT, relDir);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
        .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
        .map((e) => ({ skill: `${relDir}/${e.name.replace(/\.test\.mjs$/, '')}`, file: join(dir, e.name) }))
        .sort((a, b) => a.skill.localeCompare(b.skill));
}

async function discoverTests() {
    const skills = await discoverSkillTests();
    // --skill scopes to a skill dir, so the flat dirs are out of scope for it.
    if (FLAGS.skill) return skills;
    const hooks = await discoverDirTests('hooks');
    const scripts = await discoverDirTests('scripts');
    return [...hooks, ...scripts, ...skills];
}

function runTest({ skill, file }) {
    const start = Date.now();
    const result = spawnSync(process.execPath, [file], {
        stdio: FLAGS.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        env: process.env,
    });
    const elapsed = Date.now() - start;
    return {
        skill,
        file,
        passed: result.status === 0,
        signal: result.signal,
        code: result.status,
        elapsedMs: elapsed,
        stdout: FLAGS.quiet && result.stdout ? result.stdout.toString() : null,
        stderr: FLAGS.quiet && result.stderr ? result.stderr.toString() : null,
    };
}

async function main() {
    const tests = await discoverTests();
    if (!tests.length) {
        console.log(FLAGS.skill ? `no test found for skill: ${FLAGS.skill}` : 'no tests found');
        exit(0);
    }

    console.log(`running ${tests.length} test${tests.length === 1 ? '' : 's'}\n`);
    const results = [];
    for (const t of tests) {
        if (!FLAGS.quiet) console.log(`\n→ ${t.skill}\n`);
        const r = runTest(t);
        results.push(r);
        if (FLAGS.quiet) console.log(`  ${r.passed ? 'ok  ' : 'FAIL'} ${r.skill} (${r.elapsedMs}ms)`);
    }

    const failed = results.filter((r) => !r.passed);
    console.log(`\n=== summary ===`);
    console.log(`  ${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        console.log(`\nfailures:`);
        for (const f of failed) {
            console.log(`  ${f.skill}: exit=${f.code}${f.signal ? ` signal=${f.signal}` : ''}`);
            if (f.stderr) console.log(f.stderr.split('\n').map((l) => `    ${l}`).join('\n'));
        }
        exit(1);
    }
    exit(0);
}

main().catch((e) => { console.error(e); exit(2); });
