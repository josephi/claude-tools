#!/usr/bin/env node
// Structural linter for skills, agents, rules, and commands.
// Validates frontmatter, naming, references, and cross-skill links.
// Exits 1 on any error, 0 on clean. Warnings don't fail.
//
// Usage: node scripts/lint.mjs [--fix] [--quiet]

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, env } from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLAGS = new Set(argv.slice(2).filter((a) => a.startsWith('--')));
const QUIET = FLAGS.has('--quiet');

const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus', 'inherit']);
const VALID_AUDIENCE = new Set(['work', 'personal', 'both']);
const VALID_PORTABLE = new Set(['verbatim', 'adapt', 'none']);

const errors = [];
const warnings = [];

function parseInlineTags(s) {
    if (!s || !s.startsWith('[') || !s.endsWith(']')) return [];
    return s.slice(1, -1).split(',').map((t) => t.trim()).filter(Boolean);
}

function validateRoutingTags(frontmatter, relPath) {
    const tags = parseInlineTags(frontmatter.tags);
    if (tags.length === 0) {
        err(relPath, 'frontmatter missing required `tags` (audience/* and portable/*)');
        return;
    }
    const audiences = tags.filter((t) => t.startsWith('audience/')).map((t) => t.slice('audience/'.length));
    const portables = tags.filter((t) => t.startsWith('portable/')).map((t) => t.slice('portable/'.length));
    if (audiences.length !== 1) err(relPath, `expected exactly one audience/* tag, found ${audiences.length}`);
    else if (!VALID_AUDIENCE.has(audiences[0])) err(relPath, `invalid audience "${audiences[0]}" (expected ${[...VALID_AUDIENCE].join(', ')})`);
    if (portables.length !== 1) err(relPath, `expected exactly one portable/* tag, found ${portables.length}`);
    else if (!VALID_PORTABLE.has(portables[0])) err(relPath, `invalid portable "${portables[0]}" (expected ${[...VALID_PORTABLE].join(', ')})`);
}

function err(file, msg) { errors.push({ file, msg }); }
function warn(file, msg) { warnings.push({ file, msg }); }

function parseFrontmatter(raw) {
    if (!raw.startsWith('---')) return { frontmatter: null, body: raw };
    const end = raw.indexOf('\n---', 4);
    if (end === -1) return { frontmatter: null, body: raw, error: 'unterminated frontmatter' };
    const fmRaw = raw.slice(4, end).trim();
    const body = raw.slice(end + 4).replace(/^\n/, '');
    const fm = {};
    const unsafeScalars = [];
    const lines = fmRaw.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        // Only top-level keys; an indented line belongs to the value above it.
        if (/^\s/.test(line)) continue;
        const key = line.slice(0, colon).trim();
        let value = line.slice(colon + 1).trim();

        // YAML block scalars (`>`, `>-`, `|`, `|-`) put the value on the
        // following indented lines. Without this, a block-scalar description
        // reads as 2 chars and every length check on it is meaningless.
        if (/^[>|][-+]?\d*$/.test(value)) {
            const folded = value.startsWith('>');
            const parts = [];
            while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
                parts.push(lines[i + 1].trim());
                i++;
            }
            while (parts.length && parts[parts.length - 1] === '') parts.pop();
            value = folded ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n');
        } else if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        } else if (/:\s/.test(value) && !value.startsWith('[')) {
            // A plain YAML scalar containing ": " makes a real parser reject the
            // whole block, so every field is dropped and the skill loads
            // unroutable with no name or description. A key:value split like
            // this one can't see that — it is how skills/prometheus shipped
            // broken until `claude plugin validate` caught it.
            unsafeScalars.push(key);
        }
        fm[key] = value;
    }
    return { frontmatter: fm, body, unsafeScalars };
}

async function lintMarkdownFile(absPath, relPath, kind, expectedName) {
    const raw = await readFile(absPath, 'utf8');
    const { frontmatter, body, error, unsafeScalars } = parseFrontmatter(raw);

    if (error) { err(relPath, `frontmatter: ${error}`); return; }

    for (const key of unsafeScalars ?? []) {
        err(relPath, `frontmatter.${key} is an unquoted scalar containing ": " — YAML rejects the whole block, `
            + 'so every field is dropped and this loads with no name or description. Quote it, use a >- block '
            + 'scalar, or rephrase to remove the colon-space.');
    }
    if (!frontmatter) {
        if (kind === 'skill' || kind === 'agent') err(relPath, 'missing frontmatter (---)');
        return;
    }

    if (kind === 'skill' || kind === 'agent') {
        if (!frontmatter.name) err(relPath, 'frontmatter missing required key: name');
        if (!frontmatter.description) err(relPath, 'frontmatter missing required key: description');
        if (frontmatter.model && !VALID_MODELS.has(frontmatter.model)) {
            err(relPath, `frontmatter.model invalid: "${frontmatter.model}" (expected: ${[...VALID_MODELS].join(', ')})`);
        }

        if (frontmatter.name && expectedName && frontmatter.name !== expectedName) {
            err(relPath, `frontmatter.name "${frontmatter.name}" does not match expected "${expectedName}"`);
        }

        if (frontmatter.description && frontmatter.description.length < 30) {
            warn(relPath, `description very short (${frontmatter.description.length} chars) — TRIGGER hints help routing`);
        }
        if (frontmatter.description && frontmatter.description.length > 600) {
            warn(relPath, `description long (${frontmatter.description.length} chars) — keep under ~600 to fit in routing context`);
        }
    }

    if (kind === 'rule') {
        if (!frontmatter.description) err(relPath, 'frontmatter missing required key: description');
    }

    // Routing tags required on every non-internal skill, every agent, every rule.
    const isInternal = frontmatter.internal === 'true' || frontmatter.internal === true;
    if ((kind === 'skill' && !isInternal) || kind === 'agent' || kind === 'rule') {
        validateRoutingTags(frontmatter, relPath);
    }

    if (!body || body.trim().length < 50) {
        err(relPath, `body is empty or too short (${body.trim().length} chars)`);
    }

    // Match markdown link target that looks like a relative path (./foo or foo/bar) ending in a known extension.
    const fileRefRegex = /\]\((\.{0,2}\/[^)\s]+\.(md|mjs|sh|js|ts|json|yaml|yml))\)/g;
    let m;
    while ((m = fileRefRegex.exec(body)) !== null) {
        const ref = m[1];
        if (ref.startsWith('http') || ref.includes('://')) continue;
        const refPath = ref.startsWith('/') ? join(ROOT, ref) : resolve(dirname(absPath), ref);
        if (!existsSync(refPath)) {
            warn(relPath, `referenced file not found: ${ref}`);
        }
    }
}

async function lintSkillsDir() {
    const skillsDir = join(ROOT, 'skills');
    if (!existsSync(skillsDir)) return;
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
        const skillDir = join(skillsDir, e.name);
        const skillFile = join(skillDir, 'SKILL.md');
        if (!existsSync(skillFile)) {
            err(`skills/${e.name}`, 'missing SKILL.md');
            continue;
        }
        await lintMarkdownFile(skillFile, `skills/${e.name}/SKILL.md`, 'skill', e.name);

        const scriptsDir = join(skillDir, 'scripts');
        if (existsSync(scriptsDir)) {
            const files = await readdir(scriptsDir);
            const hasScript = files.some((f) => /\.(mjs|js|sh|ts)$/.test(f) && !f.startsWith('test'));
            const hasTest = files.includes('test.mjs') || files.includes('test.js');
            if (hasScript && !hasTest) {
                warn(`skills/${e.name}`, 'has scripts/ but no test.mjs — script-bearing skills should have tests');
            }
        }
    }
}

async function lintAgentsDir() {
    const agentsDir = join(ROOT, 'agents');
    if (!existsSync(agentsDir)) return;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue;
        if (e.name === 'README.md') continue;
        const agentName = e.name.replace(/\.md$/, '');
        await lintMarkdownFile(join(agentsDir, e.name), `agents/${e.name}`, 'agent', agentName);
    }
}

async function lintRulesDir() {
    const rulesDir = join(ROOT, 'rules');
    if (!existsSync(rulesDir)) return;
    const entries = await readdir(rulesDir, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue;
        if (e.name === 'README.md') continue;
        await lintMarkdownFile(join(rulesDir, e.name), `rules/${e.name}`, 'rule');
    }
}

async function lintCommandsDir() {
    const commandsDir = join(ROOT, 'commands');
    if (!existsSync(commandsDir)) return;
    const entries = await readdir(commandsDir, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue;
        await lintMarkdownFile(join(commandsDir, e.name), `commands/${e.name}`, 'command');
    }
}

// Only events this plugin has verified against Claude Code's behaviour. Notably
// absent: PostCompact — additionalContext is documented for SessionStart but not
// for it, which is why the re-injection rides SessionStart matcher "compact". A
// registration under PostCompact would be silently inert, so it fails lint until
// someone re-verifies the event and adds it here deliberately.
const KNOWN_HOOK_EVENTS = new Set([
    'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
    'PreCompact', 'Stop', 'SubagentStop', 'Notification',
]);

// hooks/hooks.json is the registration table for every hook the plugin ships. A
// typo'd event name, an uncompilable matcher, or a command pointing at a file
// that does not exist all fail the same way at runtime: the hook silently never
// fires. That is the failure mode this whole linter exists to catch.
async function lintHooksJson() {
    const abs = join(ROOT, 'hooks', 'hooks.json');
    if (!existsSync(abs)) return;
    const rel = 'hooks/hooks.json';

    const raw = await readFile(abs, 'utf8');
    let table;
    try {
        table = JSON.parse(raw);
    } catch (e) {
        err(rel, `invalid JSON: ${e.message}`);
        return;
    }

    // JSON.parse keeps only the LAST duplicate key, so a second "SessionStart"
    // block silently clobbers every hook registered under the first. Only the
    // raw text can see it. Scoped by event NAME, not indentation — an indent-
    // anchored pattern is disabled by any reformat, which is the same silent
    // failure this check exists to catch.
    const eventCounts = {};
    for (const m of raw.matchAll(/"([A-Za-z]+)"\s*:\s*\[/g)) {
        if (!KNOWN_HOOK_EVENTS.has(m[1])) continue;
        eventCounts[m[1]] = (eventCounts[m[1]] ?? 0) + 1;
    }
    for (const [event, n] of Object.entries(eventCounts)) {
        if (n > 1) err(rel, `"${event}" appears ${n} times — JSON.parse keeps only the last, silently dropping the others' hooks`);
    }

    for (const [event, entries] of Object.entries(table.hooks ?? {})) {
        if (!KNOWN_HOOK_EVENTS.has(event)) {
            err(rel, `unknown hook event "${event}" — a misspelt event never fires`);
        }
        for (const entry of entries ?? []) {
            if (entry.matcher !== undefined) {
                try { new RegExp(entry.matcher); }
                catch (e) { err(rel, `${event}: matcher ${JSON.stringify(entry.matcher)} does not compile — ${e.message}`); }
            }
            for (const h of entry.hooks ?? []) {
                if (h.type !== 'command') continue;
                const m = String(h.command).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/);
                if (!m) {
                    err(rel, `${event}: command must resolve via \${CLAUDE_PLUGIN_ROOT}/<script>, got: ${h.command}`);
                    continue;
                }
                if (!existsSync(join(ROOT, m[1]))) {
                    err(rel, `${event}: command points at a file that does not exist: ${m[1]}`);
                }
                if (typeof h.timeout !== 'number') {
                    warn(rel, `${event}: ${m[1]} sets no timeout`);
                }
            }
        }
    }
}

// hooks/routing.json and hooks/nudges.json drive behaviour from data, so a
// typo'd skill name or an uncompilable regex is a silent no-op at runtime — the
// hook just stops firing. Validate them here instead.
async function lintHookTables() {
    const hooksDir = join(ROOT, 'hooks');
    if (!existsSync(hooksDir)) return;

    const known = await knownSkillAndAgentNames();

    for (const [file, listKey, checks] of [
        ['routing.json', 'routes', ['when', 'unless']],
        ['nudges.json', 'nudges', ['filePathPatterns', 'contentPatterns', 'commandPatterns', 'commandUnless']],
    ]) {
        const abs = join(hooksDir, file);
        const rel = `hooks/${file}`;
        if (!existsSync(abs)) continue;

        let table;
        try {
            table = JSON.parse(await readFile(abs, 'utf8'));
        } catch (e) {
            err(rel, `invalid JSON: ${e.message}`);
            continue;
        }

        const entries = table[listKey];
        if (!Array.isArray(entries) || entries.length === 0) {
            err(rel, `missing or empty "${listKey}" array`);
            continue;
        }

        const ids = new Set();
        for (const entry of entries) {
            const label = entry?.id ?? '(no id)';
            if (!entry?.id) err(rel, 'entry missing "id"');
            else if (ids.has(entry.id)) err(rel, `duplicate id: ${entry.id}`);
            else ids.add(entry.id);

            if (!entry?.message) err(rel, `${label}: missing "message"`);

            for (const key of checks) {
                const patterns = entry?.[key];
                if (patterns === undefined) continue;
                if (!Array.isArray(patterns)) { err(rel, `${label}: "${key}" must be an array`); continue; }
                for (const p of patterns) {
                    try { new RegExp(p); }
                    catch (e) { err(rel, `${label}: "${key}" has an invalid regex ${JSON.stringify(p)} — ${e.message}`); }
                }
            }

            // routing.json targets name a skill or agent; a rename that misses
            // the table would leave the router pointing at nothing.
            for (const ref of referencedNames(entry?.target)) {
                if (!known.has(ref)) {
                    warn(rel, `${label}: target references unknown skill/agent "${ref}"`);
                }
            }
        }

        for (const p of table.taskRefPatterns ?? []) {
            try { new RegExp(p); }
            catch (e) { err(rel, `taskRefPatterns: invalid regex ${JSON.stringify(p)} — ${e.message}`); }
        }
    }
}

// Every name a target string points at. Covers the `skill:`/`agent:`/`rule:`
// prefixes and bare `claude-tools:<name>` mentions, which appear in parenthesised
// alternatives like "(or claude-tools:business-analyst for PRD breakdown)". Only
// matching the two prefixes meant a renamed rule left the router pointing at
// nothing — exactly what this check exists to catch.
function referencedNames(target) {
    if (typeof target !== 'string') return [];
    const names = new Set();
    for (const m of target.matchAll(/(?:skill|agent|rule):(?:claude-tools:)?([a-z0-9-]+)/g)) names.add(m[1]);
    for (const m of target.matchAll(/(?<![\w:])claude-tools:([a-z0-9-]+)/g)) names.add(m[1]);
    return [...names];
}

async function knownSkillAndAgentNames() {
    const names = new Set();
    for (const [dir, strip] of [['skills', false], ['agents', true], ['rules', true]]) {
        const abs = join(ROOT, dir);
        if (!existsSync(abs)) continue;
        for (const e of await readdir(abs, { withFileTypes: true })) {
            if (strip) {
                if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') names.add(e.name.replace(/\.md$/, ''));
            } else if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')) {
                names.add(e.name);
            }
        }
    }
    return names;
}

/**
 * A NUL byte in a source file is invisible in an editor and makes grep silently
 * decline to match text that sed will happily print — which cost a long debugging
 * detour when one landed in shell-command.mjs. Tests that need the byte build it
 * with String.fromCharCode rather than embedding it, so there are no exclusions.
 */
async function lintNulBytes() {
    // Walked, not enumerated: a fixed directory list omitted skills/ entirely, which
    // is the largest body of shipped files — a NUL in a SKILL.md is exactly as
    // invisible as the one that landed in lint.mjs.
    const SKIP = new Set(['node_modules', '.git', 'eval-data']);
    const walk = async (dir, rel) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (SKIP.has(entry.name)) continue;
            const abs = join(dir, entry.name);
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) { await walk(abs, relPath); continue; }
            if (!entry.isFile() || !/\.(mjs|js|json|md|sh|ps1)$/.test(entry.name)) continue;
            if ((await readFile(abs, 'utf8')).includes('\0')) {
                err(relPath, 'contains a NUL byte — it will break grep and shell quoting');
            }
        }
    };
    await walk(ROOT, '');
}

// A released version with no CHANGELOG section makes the SessionStart update
// report silently show nothing — the user is told a version changed but not what.
async function lintChangelog() {
    const changelogPath = join(ROOT, 'CHANGELOG.md');
    const manifestPath = join(ROOT, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) return;

    let version;
    try {
        version = JSON.parse(await readFile(manifestPath, 'utf8')).version;
    } catch (e) {
        err('.claude-plugin/plugin.json', `invalid JSON: ${e.message}`);
        return;
    }
    if (!version) { err('.claude-plugin/plugin.json', 'missing "version"'); return; }

    if (!existsSync(changelogPath)) {
        err('CHANGELOG.md', 'missing — every released version needs an entry for the update report');
        return;
    }

    const raw = await readFile(changelogPath, 'utf8');
    const versions = [...raw.matchAll(/^##\s*\[?v?(\d+(?:\.\d+)*)\]?/gm)].map((m) => m[1]);

    if (!versions.includes(version)) {
        err('CHANGELOG.md', `no "## [${version}]" section for the version in plugin.json — `
            + 'the post-update report would show the user nothing. Add one before releasing.');
    }

    // Each version needs a `> one-liner` TL;DR directly under its heading. The
    // post-update report leads with those, and a full entry is too long to scan
    // at session start, so a missing summary is a release that nobody reads.
    const sections = raw.split(/^##\s+/m).slice(1);
    for (const section of sections) {
        const m = section.match(/^\[?v?(\d+(?:\.\d+)*)\]?/);
        if (!m) continue;
        const rest = section.slice(section.indexOf('\n') + 1);
        const firstContent = rest.split('\n').find((l) => l.trim() !== '');
        if (!firstContent || !firstContent.trimStart().startsWith('>')) {
            const level = m[1] === version ? err : warn;
            level('CHANGELOG.md', `[${m[1]}] has no "> one-line TL;DR" under its heading — `
                + 'the post-update report leads with these, so without one the user sees no summary.');
        }
    }

    const marketplacePath = join(ROOT, '..', '.claude-plugin', 'marketplace.json');
    if (existsSync(marketplacePath)) {
        try {
            const mkt = JSON.parse(await readFile(marketplacePath, 'utf8'));
            const entry = (mkt.plugins ?? []).find((p) => p.name === 'claude-tools');
            if (entry && entry.version !== version) {
                err('.claude-plugin/marketplace.json',
                    `version ${entry.version} does not match plugin.json ${version} — bump both together`);
            }
        } catch { /* marketplace.json is validated on its own elsewhere */ }
    }
}

async function main() {
    if (!QUIET) console.log(`linting ${relative(process.cwd(), ROOT) || '.'}...`);
    await lintChangelog();
    await lintSkillsDir();
    await lintAgentsDir();
    await lintRulesDir();
    await lintCommandsDir();
    await lintHooksJson();
    await lintHookTables();
    await lintNulBytes();

    if (warnings.length && !QUIET) {
        console.log(`\nwarnings (${warnings.length}):`);
        for (const w of warnings) console.log(`  ${w.file}: ${w.msg}`);
    }

    if (errors.length) {
        console.log(`\nerrors (${errors.length}):`);
        for (const e of errors) console.log(`  ${e.file}: ${e.msg}`);
        console.log(`\nlint failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
        exit(1);
    }

    if (!QUIET) console.log(`\nlint passed: 0 errors, ${warnings.length} warning(s)`);
    exit(0);
}

main().catch((e) => { console.error(e); exit(2); });
