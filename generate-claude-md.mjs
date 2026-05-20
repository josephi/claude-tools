#!/usr/bin/env node
/**
 * Compile rules/*.md into CLAUDE.md (the plugin context loaded by Claude Code).
 * Run after editing any file under rules/.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const rulesDir = join(root, 'rules');
const outFile = join(root, 'CLAUDE.md');

function stripFrontmatter(src) {
  const lines = src.split('\n');
  if (lines[0]?.trim() !== '---') return src;
  let fenceCount = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      fenceCount++;
      if (fenceCount === 2) { i++; break; }
    }
  }
  return lines.slice(i).join('\n');
}

const ruleFiles = readdirSync(rulesDir)
  .filter(f => f.endsWith('.md') && f !== '.gitkeep')
  .sort();

const header = `# claude-tools plugin — context

Rules and conventions loaded into every session.
Managed in [josephi/claude-tools](https://github.com/josephi/claude-tools).

---

# Rules

`;

const sections = ruleFiles.map(file => {
  const name = basename(file, '.md');
  const body = stripFrontmatter(readFileSync(join(rulesDir, file), 'utf8'));
  return `## ${name}\n\n${body.trim()}\n`;
});

writeFileSync(outFile, header + sections.join('\n'), 'utf8');
console.log(`CLAUDE.md written — ${ruleFiles.length} rules, ${readFileSync(outFile, 'utf8').split('\n').length} lines`);
