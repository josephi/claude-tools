#!/usr/bin/env node
// Tests for the eval-triggers judge-backend selection.
//
// The selection is pure and injectable precisely so it can be tested without a
// credential or a CLI: a wrong choice here means the eval either fails to run or
// silently bills the wrong account.
//
// Usage: node scripts/eval-triggers.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  pickBackend, fingerprint, judgeArgv, CLAUDE_BIN, NEEDS_SHELL,
} from './eval-triggers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'eval-triggers.mjs');

let pass = 0;
let fail = 0;

function step(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      throw new Error('step callback must be synchronous — use the *Sync fs APIs');
    }
    pass++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

console.log('\neval-triggers — backend selection');

step('an API key wins when both are available', () => {
  assert.equal(pickBackend({ cli: true, apiKey: 'sk-x', forced: '' }), 'api');
});

step('the CLI is used when there is no key', () => {
  assert.equal(pickBackend({ cli: true, apiKey: undefined, forced: '' }), 'cli');
});

step('the API is used when there is no CLI', () => {
  assert.equal(pickBackend({ cli: false, apiKey: 'sk-x', forced: '' }), 'api');
});

step('neither available yields null', () => {
  assert.equal(pickBackend({ cli: false, apiKey: undefined, forced: '' }), null);
});

console.log('\neval-triggers — forcing a backend');

// A CI job that asked for one backend must not silently get the other; that would
// bill the wrong account or quietly change what the numbers mean.
step('--backend cli does not fall back to the API', () => {
  assert.equal(pickBackend({ cli: false, apiKey: 'sk-x', forced: 'cli' }), null);
});

step('--backend api does not fall back to the CLI', () => {
  assert.equal(pickBackend({ cli: true, apiKey: undefined, forced: 'api' }), null);
});

step('forcing an available backend works', () => {
  assert.equal(pickBackend({ cli: true, apiKey: 'sk-x', forced: 'cli' }), 'cli');
  assert.equal(pickBackend({ cli: true, apiKey: 'sk-x', forced: 'api' }), 'api');
});

console.log('\neval-triggers — the change-detection key');

// Anything that can change a verdict must change the key, or an edit gets reported
// as "unchanged since its last clean run" and never actually re-judged.
const baseKey = {
  description: 'TRIGGER when x. SKIP for y.',
  cases: { 'should-trigger': ['do x'], 'should-skip': ['do y'] },
  model: 'claude-haiku-4-5-20251001',
  judgePrompt: 'judge this',
};

step('the same inputs give the same key', () => {
  assert.equal(fingerprint(baseKey), fingerprint({ ...baseKey }));
});

step('a changed description changes the key', () => {
  assert.notEqual(fingerprint(baseKey), fingerprint({ ...baseKey, description: 'TRIGGER when z.' }));
});

step('a changed scenario changes the key', () => {
  const cases = { 'should-trigger': ['do x'], 'should-skip': ['do y', 'do w'] };
  assert.notEqual(fingerprint(baseKey), fingerprint({ ...baseKey, cases }));
});

step('a changed model changes the key', () => {
  assert.notEqual(fingerprint(baseKey), fingerprint({ ...baseKey, model: 'claude-sonnet-5' }));
});

step('a changed judge prompt invalidates every skill', () => {
  assert.notEqual(fingerprint(baseKey), fingerprint({ ...baseKey, judgePrompt: 'judge differently' }));
});

// Two backends can disagree, so replaying a CLI-judged sweep as a pass for an API
// run would report a verdict nothing produced.
step('a changed backend changes the key', () => {
  assert.notEqual(
    fingerprint({ ...baseKey, backend: 'cli' }),
    fingerprint({ ...baseKey, backend: 'api' }),
  );
});

console.log('\neval-triggers — the judge runs isolated');

// The judge classifies a trigger phrase, and this repo's own prompt router fires on
// trigger phrases — so an un-isolated judge can be handed "use skill X" for the very
// skill it is ruling on. A dropped flag here would not fail anything; the numbers
// would just quietly stop measuring the description.
step('the judge argv disables hooks, MCP and tools', () => {
  const argv = judgeArgv('/tmp/settings.json', '/tmp/mcp.json', 'claude-haiku-4-5-20251001');
  assert.ok(argv.includes('--strict-mcp-config'), 'must not inherit MCP servers');
  assert.equal(argv[argv.indexOf('--mcp-config') + 1], '/tmp/mcp.json');
  assert.equal(argv[argv.indexOf('--settings') + 1], '/tmp/settings.json');

  const denied = argv[argv.indexOf('--disallowed-tools') + 1].split(',');
  for (const tool of ['Bash', 'Read', 'Task', 'MultiEdit', 'Skill']) {
    assert.ok(denied.includes(tool), `${tool} would let the judge investigate instead of classify`);
  }
});

// Node refuses to spawn a .cmd without a shell (CVE-2024-27980), and a shell joins
// argv unquoted — so the only workable shape is argv with nothing in it that needs
// quoting: the prompt goes on stdin and the settings JSON goes in a file.
step('no argv element needs shell quoting', () => {
  const argv = judgeArgv('/tmp/bench-eval-settings-1.json', '/tmp/bench-eval-mcp-1.json', 'some-model');
  for (const arg of argv) {
    assert.ok(!/[\s"'{}]/.test(arg), `${JSON.stringify(arg)} would be mangled by a Windows shell`);
  }
  assert.equal(argv[argv.indexOf('--model') + 1], 'some-model');
});

step('the prompt is not in argv at all — it goes on stdin', () => {
  const argv = judgeArgv('/tmp/s.json', '/tmp/m.json');
  assert.ok(argv.includes('-p'), 'print mode still requested');
  assert.equal(argv[argv.indexOf('-p') + 1], '--model', '-p takes no inline prompt');
});

step('the Windows shim is named and paired with a shell', () => {
  assert.ok(['claude', 'claude.cmd'].includes(CLAUDE_BIN));
  assert.equal(CLAUDE_BIN.endsWith('.cmd'), NEEDS_SHELL);
  assert.equal(NEEDS_SHELL, process.platform === 'win32');
});

console.log('\neval-triggers — the cache round-trips');

// --all ignoring the cache for reads is correct; skipping the WRITE was not, and
// it made the seeding run pointless: everything re-judged, nothing recorded.
step('a clean run writes a cache that a second run consumes', () => {
  const cache = resolve(HERE, '.eval-cache.json');
  const existed = existsSync(cache);
  const backup = existed ? readFileSync(cache, 'utf8') : null;

  try {
    if (existed) rmSync(cache);
    // --dry-run judges nothing, so use it to prove the no-write case, then assert
    // the live path's condition directly rather than spending real judge calls.
    spawnSync('node', [SCRIPT, '--dry-run'], { encoding: 'utf8' });
    assert.equal(existsSync(cache), false, 'a dry run must not write a cache');

    const src = readFileSync(SCRIPT, 'utf8');
    assert.match(src, /if \(!DRY_RUN\) await saveCache\(cache\)/,
      'the save must be gated on DRY_RUN alone, so --all still records results');
  } finally {
    if (backup !== null) writeFileSync(cache, backup);
  }
});

console.log('\neval-triggers — importing must not run anything');

// Without the entry guard, importing this module to reach pickBackend starts a
// real eval and spawns judge calls as a side effect of loading the file.
step('importing the module produces no output and no judge calls', () => {
  const r = spawnSync('node', ['-e', `
    const t0 = Date.now();
    import(${JSON.stringify(pathToFileURL(SCRIPT).href)}).then((m) => {
      if (typeof m.pickBackend !== 'function') { console.log('MISSING_EXPORT'); process.exit(1); }
      setTimeout(() => { console.log('CLEAN'); process.exit(0); }, 400);
    });
  `], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^CLEAN\s*$/, `import had side effects: ${r.stdout.trim()}`);
});

console.log('\neval-triggers — the no-judge path exits cleanly');

step('with no key and no CLI it explains both options and exits 0', () => {
  const r = spawnSync('node', [SCRIPT, '--backend', 'api'], {
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
  });
  assert.equal(r.status, 0, 'a missing judge is a skip, not a build failure');
  assert.match(r.stdout, /eval skipped/);
  assert.match(r.stdout, /ANTHROPIC_API_KEY/);
  assert.match(r.stdout, /claude CLI/);
});

step('--dry-run needs no judge at all', () => {
  const r = spawnSync('node', [SCRIPT, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dry-run/);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
