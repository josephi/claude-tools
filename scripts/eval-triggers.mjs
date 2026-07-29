#!/usr/bin/env node
// Trigger eval — uses Claude Haiku as a judge to verify each skill's TRIGGER/SKIP
// description correctly classifies a curated set of scenarios.
//
// Two judge backends, picked in this order:
//
//   1. ANTHROPIC_API_KEY set  → the HTTP API. Metered separately from the
//      subscription and works on a CI box with no CLI installed.
//   2. otherwise              → `claude -p`, which judges using the auth the CLI
//      already holds. No key to mint, store, or leak, and nothing to add to a
//      sandbox network allow-list.
//
// ~30-40 judge calls per run, all Haiku (< $0.02 on the API path).
//
// Usage:
// By default only skills whose description or scenarios CHANGED since their last
// clean run are judged; the rest are reported as skipped, never as verified.
//
// Usage:
//   node scripts/eval-triggers.mjs                  # changed skills only
//   node scripts/eval-triggers.mjs --all            # re-judge everything
//   node scripts/eval-triggers.mjs --dry-run        # print scenarios, no judge calls
//   node scripts/eval-triggers.mjs --skill <name>   # eval only one skill
//   node scripts/eval-triggers.mjs --model <id>     # override judge model
//   node scripts/eval-triggers.mjs --threshold 0.9  # min accuracy to pass (default 1.0)
//   node scripts/eval-triggers.mjs --backend cli    # force a backend instead of
//   node scripts/eval-triggers.mjs --backend api    #   auto-picking; fails if absent

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argv, exit, env } from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'scripts', 'eval-data', 'triggers.json');

const FLAGS = parseFlags(argv.slice(2));
const DRY_RUN = !!FLAGS['dry-run'];
const SKILL_FILTER = FLAGS.skill;
const MODEL = FLAGS.model || 'claude-haiku-4-5-20251001';
const THRESHOLD = parseFloat(FLAGS.threshold ?? '1.0');
const BACKEND = FLAGS.backend || '';
const RUN_ALL = !!FLAGS.all;

function parseFlags(rest) {
    const out = {};
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (!a.startsWith('--')) continue;
        const k = a.slice(2);
        const next = rest[i + 1];
        if (next && !next.startsWith('--')) { out[k] = next; i++; }
        else { out[k] = true; }
    }
    return out;
}

function parseFrontmatter(raw) {
    if (!raw.startsWith('---')) return null;
    const end = raw.indexOf('\n---', 4);
    if (end === -1) return null;
    const fmRaw = raw.slice(4, end).trim();
    const fm = {};
    for (const line of fmRaw.split('\n')) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    return fm;
}

async function loadSkillDescription(skill) {
    const file = join(ROOT, 'skills', skill, 'SKILL.md');
    if (!existsSync(file)) throw new Error(`SKILL.md not found for ${skill}`);
    const raw = await readFile(file, 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm || !fm.description) throw new Error(`no description in frontmatter for ${skill}`);
    return fm.description;
}

const JUDGE_PROMPT = `You are evaluating whether a Claude Code skill should activate for a given user message.

Skill description (the routing TRIGGER/SKIP rules — read carefully):
"""
{{description}}
"""

User message:
"""
{{scenario}}
"""

Should this skill activate for this message? Reply with strict JSON only, no prose:
{"trigger": true|false, "reasoning": "<one sentence why>"}`;

// ── Change detection ────────────────────────────────────────────────────────
//
// A full run is ~40 sequential judge calls, each a process spawn on the CLI path,
// so re-judging a skill whose description and scenarios are untouched is pure
// waste. The cache key covers everything that can change a verdict: the
// description, the scenarios, the judge prompt, and the model.
//
// Only 100% results are cached. A skill that missed anything is always re-judged,
// so the cache can never turn a failure into a silent pass — the reason `--all`
// is a convenience rather than a correctness requirement.

const CACHE = join(ROOT, 'scripts', '.eval-cache.json');

// `backend` is part of the key because two backends can disagree: replaying a
// CLI-judged sweep as a pass for an API run reports a verdict nothing produced,
// which is the same "quietly changes what the numbers mean" the --backend flag
// exists to prevent.
export function fingerprint({ description, cases, model, judgePrompt, backend }) {
    return createHash('sha256')
        .update(JSON.stringify({ description, cases, model, judgePrompt, backend }))
        .digest('hex')
        .slice(0, 16);
}

async function loadCache() {
    try { return JSON.parse(await readFile(CACHE, 'utf8')); } catch { return {}; }
}

async function saveCache(cache) {
    try {
        await writeFile(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
    } catch (e) {
        console.log(`  (could not write ${CACHE}: ${e.message})`);
    }
}

function parseVerdict(text) {
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error(`no JSON in response: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]);
}

/**
 * Judge via the `claude` CLI in print mode.
 *
 * Preferred over the HTTP API because it reuses the subscription auth the CLI
 * already holds: no ANTHROPIC_API_KEY to mint, store, or leak, and nothing to add
 * to a sandbox network allow-list. Requires `claude` on PATH, which is a safe bet
 * for anyone maintaining this repo.
 */
// On Windows `claude` is a .cmd shim, and since the CVE-2024-27980 fix Node refuses
// to spawn .bat/.cmd without `shell: true`. But a shell splices argv together
// unquoted, which would destroy a multi-line prompt and any JSON argument.
//
// Both problems disappear by keeping every argv element free of spaces and quotes:
// the prompt goes on stdin (`claude -p` reads it there) and the settings JSON goes in
// a temp file. Then `shell: true` is safe and the shim resolves.
export const NEEDS_SHELL = process.platform === 'win32';
export const CLAUDE_BIN = NEEDS_SHELL ? 'claude.cmd' : 'claude';

/**
 * The judge must classify the description and nothing else. A plain `claude -p`
 * inherits this machine's whole configuration — and this repo's own
 * UserPromptSubmit router would then inject "use skill X" for the very trigger
 * phrases being judged, handing the judge the answer. Tools are dropped for the
 * same reason: the question is what the description says, not what an agent could
 * work out by reading the repo.
 *
 * Exported so a test can assert on it: a silently-dropped isolation flag would let
 * the judge regain hooks or tools while the numbers still looked fine.
 */
export function judgeArgv(settingsPath, mcpConfigPath, model = MODEL) {
    return [
        '-p',
        '--model', model,
        '--strict-mcp-config',
        '--mcp-config', mcpConfigPath,
        // An enumeration, so a tool added to Claude Code later is allowed by default.
        // Listed anyway because an empty --allowed-tools is not documented to mean
        // "none", and this at least denies everything that can read the repo today.
        '--disallowed-tools', DENIED_TOOLS.join(','),
        '--settings', settingsPath,
    ];
}

export const EMPTY_MCP_CONFIG = '{"mcpServers":{}}';
export const DENIED_TOOLS = [
    'Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
    'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Skill', 'SlashCommand', 'TodoWrite',
];

function judgeViaCli(prompt) {
    return new Promise((resolve, reject) => {
        // Written to disk rather than passed inline so no argv element contains a
        // quote or brace for a Windows shell to eat.
        const settingsPath = join(tmpdir(), `bench-eval-settings-${process.pid}.json`);
        const mcpConfigPath = join(tmpdir(), `bench-eval-mcp-${process.pid}.json`);
        try {
            writeFileSync(settingsPath, JSON.stringify({ disableAllHooks: true }));
            writeFileSync(mcpConfigPath, EMPTY_MCP_CONFIG);
        } catch (e) {
            return reject(e);
        }

        const child = spawn(CLAUDE_BIN, judgeArgv(settingsPath, mcpConfigPath), {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: NEEDS_SHELL,
        });
        child.stdin.on('error', () => { /* the child may exit before the write lands */ });
        child.stdin.end(prompt);

        let out = '';
        let err = '';
        const cleanup = () => {
            for (const p of [settingsPath, mcpConfigPath]) {
                try { unlinkSync(p); } catch { /* already gone */ }
            }
        };

        // A wedged judge must not hang the whole run.
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            cleanup();
            reject(new Error('claude -p timed out after 120s'));
        }, 120_000);

        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { clearTimeout(timer); cleanup(); reject(e); });
        child.on('close', (code) => {
            clearTimeout(timer);
            cleanup();
            if (code !== 0) return reject(new Error(`claude -p exited ${code}: ${err.trim().slice(0, 300)}`));
            try { resolve(parseVerdict(out)); } catch (e) { reject(e); }
        });
    });
}

async function judgeViaApi(prompt) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
    const data = await r.json();
    return parseVerdict(data.content?.[0]?.text || '');
}

export function hasClaudeCli() {
    return spawnSync(CLAUDE_BIN, ['--version'], {
        stdio: 'ignore',
        shell: NEEDS_SHELL,
    }).status === 0;
}

/**
 * Which backend to use: ANTHROPIC_API_KEY when one is set, otherwise the CLI.
 *
 * A key is the more predictable path when it exists — metered separately from the
 * subscription, no per-call process spawn, and it works on a CI box with no CLI.
 * The CLI fallback is what makes the eval runnable with no credential at all.
 * `--backend cli|api` forces one and fails loudly if it is unavailable, so a CI
 * job cannot silently degrade to the other.
 */
export function pickBackend({ cli = hasClaudeCli(), apiKey = env.ANTHROPIC_API_KEY, forced = BACKEND } = {}) {
    if (forced === 'cli') return cli ? 'cli' : null;
    if (forced === 'api') return apiKey ? 'api' : null;
    if (apiKey) return 'api';
    if (cli) return 'cli';
    return null;
}

async function judge(description, scenario, backend) {
    const prompt = JUDGE_PROMPT
        .replace('{{description}}', description)
        .replace('{{scenario}}', scenario);

    return backend === 'cli' ? judgeViaCli(prompt) : judgeViaApi(prompt);
}

function summarize(perSkill) {
    const totalPass = perSkill.reduce((a, s) => a + s.pass, 0);
    const totalFail = perSkill.reduce((a, s) => a + s.fail, 0);
    const total = totalPass + totalFail;
    return { totalPass, totalFail, total, accuracy: total ? totalPass / total : 1 };
}

async function main() {
    const scenarios = JSON.parse(await readFile(DATA, 'utf8'));
    const skills = SKILL_FILTER ? [SKILL_FILTER] : Object.keys(scenarios);

    const backend = DRY_RUN ? null : pickBackend();

    if (!DRY_RUN && !backend) {
        const why = BACKEND
            ? `--backend ${BACKEND} was requested but is not available`
            : 'no ANTHROPIC_API_KEY and no `claude` CLI on PATH';
        console.log(`eval skipped: ${why}.`);
        console.log('Either works: export ANTHROPIC_API_KEY=... (metered separately),');
        console.log('or install the claude CLI, which judges with your existing subscription auth.');
        console.log('To validate scenario data without a judge: node scripts/eval-triggers.mjs --dry-run');
        exit(0);
    }

    console.log(`mode: ${DRY_RUN ? 'dry-run (no judge calls)' : `live (backend=${backend}, model=${MODEL})`}`);
    console.log(`skills: ${skills.join(', ')}\n`);

    // --all re-judges everything, but must still MERGE onto what is on disk:
    // starting from {} meant `--all --skill x` rewrote the file with only x and
    // dropped every other skill's entry.
    const cache = DRY_RUN ? {} : await loadCache();
    const ignoreCache = RUN_ALL;
    const cached = [];

    const perSkill = [];
    for (const skill of skills) {
        const cases = scenarios[skill];
        if (!cases) { console.log(`skip ${skill}: no scenarios`); continue; }
        const description = await loadSkillDescription(skill);
        const fp = fingerprint({ description, cases, model: MODEL, judgePrompt: JUDGE_PROMPT, backend });

        if (!ignoreCache && cache[skill]?.fingerprint === fp) {
            cached.push({ skill, count: cache[skill].count });
            continue;
        }

        console.log(`\n=== ${skill} ===`);
        let pass = 0, fail = 0;
        const misses = [];

        for (const [bucket, expected] of [['should-trigger', true], ['should-skip', false]]) {
            for (const scenario of (cases[bucket] || [])) {
                if (DRY_RUN) {
                    console.log(`  [${bucket}] ${scenario}`);
                    pass++;
                    continue;
                }
                try {
                    const j = await judge(description, scenario, backend);
                    const ok = j.trigger === expected;
                    if (ok) {
                        console.log(`  ok   [${bucket}] ${scenario}`);
                        pass++;
                    } else {
                        console.log(`  FAIL [${bucket}] ${scenario}`);
                        console.log(`         judged: trigger=${j.trigger} — ${j.reasoning}`);
                        fail++;
                        misses.push({ bucket, scenario, judgment: j });
                    }
                } catch (e) {
                    console.log(`  ERR  [${bucket}] ${scenario}`);
                    console.log(`         ${e.message}`);
                    fail++;
                }
            }
        }

        perSkill.push({ skill, pass, fail, misses });

        // Cache only a clean sweep, so a miss is never skipped on the next run.
        if (!DRY_RUN) {
            if (fail === 0) cache[skill] = { fingerprint: fp, count: pass };
            else delete cache[skill];
        }
    }

    // --all ignores the cache for READING but must still write, or the run that
    // re-judges everything leaves nothing behind and the next run repeats it.
    if (!DRY_RUN) await saveCache(cache);

    // perSkill holds only what was judged, so the headline number counts only
    // scenarios a judge actually ruled on this run. Carrying cached passes into it
    // made a fully-cached run print "40/40 passed" having called nothing.
    const sum = summarize(perSkill);
    const carried = cached.reduce((a, c) => a + c.count, 0);

    console.log(`\n=== summary ===`);

    if (cached.length) {
        console.log(`  unchanged since their last clean run, not re-judged: ${cached.map((c) => c.skill).join(', ')}`);
        console.log(`  carried from cache: ${carried} scenario(s) across ${cached.length} skill(s)`);
    }

    if (sum.total === 0) {
        console.log('  0 judged this run — everything was up to date. Pass --all to re-judge.');
    } else {
        console.log(`  ${sum.totalPass}/${sum.total} judged passed (accuracy ${(sum.accuracy * 100).toFixed(1)}%)`);
    }

    if (DRY_RUN) {
        console.log('  (dry-run: no API calls, scenarios printed above)');
        exit(0);
    }

    if (sum.accuracy < THRESHOLD) {
        console.log(`  threshold ${(THRESHOLD * 100).toFixed(0)}% not met`);
        exit(1);
    }
    exit(0);
}

// Entry guard: the test imports pickBackend from this module, and without this
// the import would start a real eval — spawning judge calls as a side effect of
// loading the file.
if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
    main().catch((e) => { console.error(e); exit(2); });
}
