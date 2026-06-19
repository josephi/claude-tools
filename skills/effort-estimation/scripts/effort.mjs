#!/usr/bin/env node
// effort.mjs — GitHub Issues effort calibration + estimation.
//
// Commands:
//   record <issue-number...>     capture cycle/lead times + PR signals for closed issues
//   estimate [--type T] [--size S]  print calibration stats to ground a new estimate
//   backfill [--days N] [--assignee @me]  seed history from recently closed issues
//
// Repo: --repo owner/name, or EFFORT_GH_REPO, or the repo in the current directory.
// Auth: the `gh` CLI (already authenticated for the personal account). No tokens here.
// Data: ~/.claude-personal/data/effort-estimation/history.jsonl (one record per issue, upserted by key).
// Weekend: Sat+Sun by default. Override: EFFORT_WEEKEND="0,6" (JS getDay numbers, Sun=0 .. Sat=6).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DATA_DIR = join(homedir(), '.claude-personal', 'data', 'effort-estimation');
const HISTORY = join(DATA_DIR, 'history.jsonl');
const WEEKEND = (process.env.EFFORT_WEEKEND ?? '0,6').split(',').map(Number); // Sun, Sat
const START_LABEL = (process.env.EFFORT_START_LABEL ?? 'in-progress').toLowerCase();
const TYPE_LABELS = new Set(['feat', 'fix', 'chore', 'refactor', 'infra', 'test', 'docs', 'perf', 'security']);
const SIZE_RE = /^size:(xs|s|m|l|xl)$/i;
const MS_DAY = 86_400_000;

// --- gh CLI ---

function gh(args) {
    try {
        return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    }
    catch (e) {
        const msg = (e.stderr?.toString() || e.message || '').trim();
        throw new Error(`gh ${args.join(' ')}: ${msg.slice(0, 300)}`);
    }
}

const ghJson = (args) => JSON.parse(gh(args));

function resolveRepo(flag) {
    const r = flag ?? process.env.EFFORT_GH_REPO;
    if (r) return r;
    try { return ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner; }
    catch { console.error('no repo: pass --repo owner/name, set EFFORT_GH_REPO, or run from a repo dir'); process.exit(2); }
}

// One GraphQL call per issue: label/assignment timing + linked PRs, for cycle-start
// detection. GitHub Issues have no Jira-style workflow states, so "work started" is
// the earliest of: a start label applied, first assignment, or first linked PR opened.
function issueTimeline(repo, number) {
    const [owner, name] = repo.split('/');
    const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){number title createdAt closedAt state labels(first:50){nodes{name}} timelineItems(first:250,itemTypes:[LABELED_EVENT,ASSIGNED_EVENT,CONNECTED_EVENT,CROSS_REFERENCED_EVENT]){nodes{__typename ... on LabeledEvent{createdAt label{name}} ... on AssignedEvent{createdAt} ... on ConnectedEvent{createdAt subject{__typename ... on PullRequest{number}}} ... on CrossReferencedEvent{createdAt source{__typename ... on PullRequest{number}}}}}}}}`;
    const out = ghJson(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`]);
    return out.data?.repository?.issue ?? null;
}

// PR-review interaction signals per linked PR: review rounds, changes-requested
// votes, commit count (rework proxy), and publish→merge wall time. Also returns the
// earliest PR open time, used as a cycle-start fallback.
function prSignals(repo, prNumbers) {
    if (!prNumbers.length) return { signals: null, firstPrAt: null };
    const out = { count: 0, reviewRounds: 0, changesRequested: 0, commits: 0, publishToMergeDays: null };
    let firstPrAt = null;
    for (const n of prNumbers) {
        let pr;
        try { pr = ghJson(['pr', 'view', String(n), '--repo', repo, '--json', 'number,createdAt,mergedAt,state,reviews,commits']); }
        catch { continue; }
        out.count++;
        const reviews = pr.reviews ?? [];
        out.reviewRounds += reviews.length;
        out.changesRequested += reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length;
        out.commits += pr.commits?.length ?? 0;
        if (pr.createdAt && (!firstPrAt || new Date(pr.createdAt) < new Date(firstPrAt))) firstPrAt = pr.createdAt;
        if (pr.state === 'MERGED' && pr.mergedAt) {
            out.publishToMergeDays = round((out.publishToMergeDays ?? 0) + businessMs(pr.createdAt, pr.mergedAt) / MS_DAY);
        }
    }
    return { signals: out.count ? out : null, firstPrAt };
}

// Elapsed ms between two instants, excluding whole weekend days.
function businessMs(start, end) {
    let cur = new Date(start);
    const e = new Date(end);
    if (e <= cur) return 0;
    let total = 0;
    while (cur < e) {
        const dayEnd = new Date(cur);
        dayEnd.setHours(24, 0, 0, 0);
        const segEnd = dayEnd < e ? dayEnd : e;
        if (!WEEKEND.includes(cur.getDay())) total += segEnd - cur;
        cur = segEnd;
    }
    return total;
}

const round = (n) => Math.round(n * 100) / 100;
const earliest = (...dates) => dates.filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] ?? null;

function loadHistory() {
    if (!existsSync(HISTORY)) return [];
    return readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function saveHistory(records) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(HISTORY, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

async function recordIssue(repo, numberArg) {
    const number = Number(String(numberArg).replace(/^#/, ''));
    const issue = issueTimeline(repo, number);
    if (!issue) throw new Error(`${repo}#${number}: not found`);

    const labels = (issue.labels?.nodes ?? []).map((l) => l.name);
    const type = labels.find((l) => TYPE_LABELS.has(l.toLowerCase())) ?? null;
    const size = labels.find((l) => SIZE_RE.test(l))?.replace(/^size:/i, '').toUpperCase() ?? null;

    const events = issue.timelineItems?.nodes ?? [];
    const linkedPrs = new Set();
    let firstAssignAt = null;
    let firstStartLabelAt = null;
    for (const ev of events) {
        if (ev.__typename === 'AssignedEvent') firstAssignAt = earliest(firstAssignAt, ev.createdAt);
        else if (ev.__typename === 'LabeledEvent' && ev.label?.name?.toLowerCase() === START_LABEL) firstStartLabelAt = earliest(firstStartLabelAt, ev.createdAt);
        else if (ev.__typename === 'CrossReferencedEvent' && ev.source?.__typename === 'PullRequest') linkedPrs.add(ev.source.number);
        else if (ev.__typename === 'ConnectedEvent' && ev.subject?.__typename === 'PullRequest') linkedPrs.add(ev.subject.number);
    }

    let signals = null;
    let firstPrAt = null;
    try { ({ signals, firstPrAt } = prSignals(repo, [...linkedPrs])); }
    catch (e) { console.warn(`${repo}#${number}: pr enrichment skipped (${e.message})`); }

    // cycle start = earliest real signal that work began, but never before the issue
    // existed (a cross-referenced PR can predate the issue when it only mentions it);
    // fall back to created (cycle == lead) when no valid signal remains.
    const afterCreated = (d) => (d && new Date(d) >= new Date(issue.createdAt) ? d : null);
    const labelAt = afterCreated(firstStartLabelAt);
    const assignAt = afterCreated(firstAssignAt);
    const prAt = afterCreated(firstPrAt);
    const startedAt = earliest(labelAt, assignAt, prAt) ?? issue.createdAt;
    const startBasis = startedAt === labelAt ? `label:${START_LABEL}` : startedAt === assignAt ? 'assigned' : startedAt === prAt ? 'first-pr' : 'created';
    const doneAt = issue.closedAt;

    return {
        key: `${repo}#${number}`,
        recordedAt: new Date().toISOString(),
        title: issue.title,
        type,
        size,
        state: issue.state,
        startBasis,
        cycleDays: doneAt ? round(businessMs(startedAt, doneAt) / MS_DAY) : null,
        leadDays: doneAt ? round(businessMs(issue.createdAt, doneAt) / MS_DAY) : null,
        pr: signals,
    };
}

async function cmdRecord(repo, numbers) {
    if (!numbers.length) { console.error('usage: effort.mjs record <issue-number...> [--repo owner/name]'); process.exit(2); }
    const history = loadHistory();
    for (const n of numbers) {
        const rec = await recordIssue(repo, n);
        const i = history.findIndex((r) => r.key === rec.key);
        if (i >= 0) history[i] = rec; else history.push(rec);
        const prInfo = rec.pr ? ` | pr: ${rec.pr.count} (${rec.pr.reviewRounds} reviews, ${rec.pr.commits} commits, merge ${rec.pr.publishToMergeDays ?? '?'}d)` : '';
        const tags = [rec.type, rec.size].filter(Boolean).join(' ');
        console.log(`${rec.key}: cycle ${rec.cycleDays ?? '?'}d | lead ${rec.leadDays ?? '?'}d${prInfo}${tags ? ` | ${tags}` : ''} (start: ${rec.startBasis})`);
        if (rec.cycleDays === null) console.warn(`${rec.key}: not closed — recorded for reference only`);
    }
    saveHistory(history);
    console.log(`history: ${history.length} issues @ ${HISTORY}`);
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function statLine(label, values, unit = 'd') {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    return `${label.padEnd(28)} n=${String(s.length).padEnd(3)} median=${quantile(s, 0.5)}${unit}  p75=${quantile(s, 0.75)}${unit}  avg=${round(s.reduce((a, b) => a + b, 0) / s.length)}${unit}`;
}

function cmdEstimate(args) {
    const typeFilter = args.type?.toLowerCase();
    const sizeFilter = args.size?.toUpperCase();
    let recs = loadHistory().filter((r) => r.cycleDays !== null);
    if (typeFilter) recs = recs.filter((r) => (r.type ?? '').toLowerCase() === typeFilter);
    if (sizeFilter) recs = recs.filter((r) => (r.size ?? '') === sizeFilter);
    if (!recs.length) {
        console.log('no calibration data matches — run `effort.mjs backfill` or finish more tasks first');
        return;
    }
    console.log(statLine('cycle (start→closed)', recs.map((r) => r.cycleDays)));
    console.log(statLine('lead (opened→closed)', recs.map((r) => r.leadDays).filter((d) => d !== null)));
    console.log('');
    const byType = Object.groupBy(recs.filter((r) => r.type), (r) => r.type);
    for (const [t, rs] of Object.entries(byType)) console.log(statLine(`  type: ${t}`, rs.map((r) => r.cycleDays)));
    console.log('');
    const bySize = Object.groupBy(recs.filter((r) => r.size), (r) => r.size);
    for (const [s, rs] of Object.entries(bySize)) console.log(statLine(`  size: ${s}`, rs.map((r) => r.cycleDays)));

    const withPr = recs.filter((r) => r.pr);
    if (withPr.length) {
        console.log('\nPR review interaction (per task):');
        console.log(statLine('  review rounds', withPr.map((r) => r.pr.reviewRounds), ''));
        console.log(statLine('  commits (rework proxy)', withPr.map((r) => r.pr.commits), ''));
        console.log(statLine('  publish→merge', withPr.map((r) => r.pr.publishToMergeDays).filter((d) => d !== null)));
        const cr = withPr.filter((r) => r.pr.changesRequested > 0).length;
        console.log(`  tasks with a changes-requested review: ${cr}/${withPr.length}`);
    }
}

async function cmdBackfill(repo, args) {
    const days = args.days ? Number(args.days) : 120;
    const cutoff = Date.now() - days * MS_DAY;
    const limit = args.limit ?? '200';
    const assignee = args.assignee ?? '@me';
    let issues = ghJson(['issue', 'list', '--repo', repo, '--state', 'closed', '--assignee', assignee, '--limit', String(limit), '--json', 'number,closedAt']);
    issues = issues.filter((i) => i.closedAt && new Date(i.closedAt).getTime() >= cutoff);
    console.log(`backfilling ${issues.length} issues closed in last ${days}d for ${repo} (assignee ${assignee})`);
    if (issues.length) await cmdRecord(repo, issues.map((i) => i.number));
}

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1], i++;
    else positional.push(rest[i]);
}

try {
    if (cmd === 'record') await cmdRecord(resolveRepo(args.repo), positional);
    else if (cmd === 'estimate') cmdEstimate(args);
    else if (cmd === 'backfill') await cmdBackfill(resolveRepo(args.repo), args);
    else { console.error('usage: effort.mjs <record|estimate|backfill> [args]'); process.exit(2); }
}
catch (e) {
    console.error(e.message);
    process.exit(1);
}
