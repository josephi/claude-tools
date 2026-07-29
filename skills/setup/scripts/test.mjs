#!/usr/bin/env node
// Aggregates the setup skill's script tests so `scripts/lint.mjs` and the
// repo-level runner have one entry point per skill.
//
// Usage: node skills/setup/scripts/test.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { exit } from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = ['install-launcher.test.mjs', 'ownership.test.mjs'];

let failed = 0;

for (const suite of SUITES) {
  const r = spawnSync('node', [join(HERE, suite)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(`\nsetup: ${SUITES.length - failed}/${SUITES.length} suites passed\n`);
exit(failed === 0 ? 0 : 1);
