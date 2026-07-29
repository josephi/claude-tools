#!/usr/bin/env node
// Tests for lib/shell-command.mjs.
//
// blankQuoted feeds both the nudge and branch-change matchers, so this pins what
// it promises AND what it deliberately does not, so the next edit sees the line.
//
// Usage: node hooks/shell-command.test.mjs

import assert from 'node:assert/strict';
import {
  blankQuoted, maskShellSyntax, shellTokens, isWriteRedirect,
} from './lib/shell-command.mjs';

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

console.log('\nshell-command — blanking quoted runs');

step('blanks double-quoted contents, keeps the quotes and length', () => {
  const out = blankQuoted('git commit -m "fix --amend handling"');
  assert.equal(out.length, 'git commit -m "fix --amend handling"'.length);
  assert.ok(!out.includes('--amend'));
  assert.match(out, /^git commit -m "\s+"$/);
});

step('blanks single-quoted contents', () => {
  assert.ok(!blankQuoted("git commit -m 'add --dry-run flag'").includes('--dry-run'));
});

step('leaves unquoted text untouched', () => {
  const c = 'git commit --amend && git push';
  assert.equal(blankQuoted(c), c);
});

step('handles multiple quoted runs', () => {
  const out = blankQuoted('echo "git commit" and \'git checkout\' done');
  assert.ok(!out.includes('git commit'));
  assert.ok(!out.includes('git checkout'));
  assert.match(out, /^echo "\s+" and '\s+' done$/);
});

// This used to blank to end-of-string, which in the guard's case hid every write
// after an apostrophe. The masker is shared now, so the nudge matchers get the same
// fail-visible direction.
step('an unterminated quote leaves the rest of the command visible', () => {
  const out = blankQuoted('git commit -m "oops no close');
  assert.ok(out.includes('git commit'), 'the command itself must stay readable');
  assert.equal(out.length, 'git commit -m "oops no close'.length);
});

step('a single quote inside double quotes does not open a new run', () => {
  const out = blankQuoted(`git commit -m "it's fine" --amend`);
  assert.ok(out.includes('--amend'), 'text after the closing quote must survive');
});

console.log('\nshell-command — escaped quotes');

// `\"` inside a double-quoted run must not flip the scanner out early, or the
// rest of the message reads as unquoted command text.
step('a backslash-escaped quote stays inside the run', () => {
  const out = blankQuoted('git commit -m "fix \\" --amend \\" handling"');
  assert.ok(!out.includes('--amend'), 'the flag is inside the message and must be blanked');
});

step('a trailing backslash at end of string does not crash', () => {
  assert.equal(typeof blankQuoted('echo "abc\\'), 'string');
});

console.log('\nshell-command — documented non-goals');

// Pinned so a future edit knows these are accepted costs, not oversights. Both
// cost at most a missed nudge, never a wrong action.
// This was a pinned non-goal telling the next reader to update the docs if the scope
// grew. It grew: the shared masker blanks heredoc bodies, so a flag quoted in a
// commit message body no longer suppresses the push nudge either.
step('heredoc bodies are blanked now that the masker is shared', () => {
  const out = blankQuoted('git commit -F- <<EOF\nfix --amend handling\nEOF');
  assert.ok(!out.includes('--amend'));
});

// $'…' needs no special handling: the $ sits outside and the '…' run is blanked
// like any other single-quoted run, which is the behaviour we want anyway.
step("$'...' ANSI-C quoting is blanked via its ordinary quote run", () => {
  const out = blankQuoted("git commit -m $'fix --amend'");
  assert.ok(!out.includes('--amend'));
});

console.log('\nshell-command — robustness');

step('non-string input yields an empty string', () => {
  for (const v of [null, undefined, 42, {}, []]) assert.equal(blankQuoted(v), '');
});

step('empty string round-trips', () => {
  assert.equal(blankQuoted(''), '');
});

console.log('\nshell-command — maskShellSyntax');

// Everything below rests on this: the mask must be the same length as its input and
// differ only by blanks, or values read by offset come back wrong. It was verified by
// hand and by fuzzing, but nothing kept it true.
step('the mask preserves length and only introduces blanks', () => {
  const alphabet = ['a', ' ', '"', "'", '\\', '#', '$', '`', '(', ')', '[', ']',
    '<', '>', '|', ';', '&', '\n', 'EOF', '-', '/', '=', '{', '}'];
  let seed = 12345;
  const next = (max) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % max; };

  for (let n = 0; n < 4000; n++) {
    let input = '';
    for (let k = 0; k < 1 + next(24); k++) input += alphabet[next(alphabet.length)];

    const masked = maskShellSyntax(input);
    assert.equal(masked.length, input.length, `length drift on ${JSON.stringify(input)}`);
    for (let k = 0; k < masked.length; k++) {
      assert.ok(
        masked[k] === input[k] || masked[k] === ' ' || masked[k] === '\n',
        `position ${k} of ${JSON.stringify(input)} became ${JSON.stringify(masked[k])}`,
      );
    }
  }
});

step('quoted contents are blanked, quotes and length kept', () => {
  assert.equal(maskShellSyntax('cat > "a b"'), 'cat > "   "');
  assert.equal(maskShellSyntax("cat > 'a b'"), "cat > '   '");
});

step('comments are blanked to end of line only', () => {
  assert.equal(maskShellSyntax('ls # note\ncat > f'), 'ls       \ncat > f');
});

step('a # inside quotes is not a comment, and an apostrophe in a comment is not a quote', () => {
  assert.equal(maskShellSyntax('echo "a # b" > f'), 'echo "     " > f');
  assert.match(maskShellSyntax("ls # don't\ncat > f"), /cat > f$/);
});

step('bracket constructs and heredoc bodies are blanked', () => {
  assert.equal(maskShellSyntax('if (( a > b )); then'), 'if            ; then');
  assert.match(maskShellSyntax('cat <<EOF\na > b\nEOF'), /^cat <<EOF\n {5}\n {3}$/);
});

step('an escaped quote does not open a run', () => {
  const masked = maskShellSyntax("echo won\\'t\ncat > f");
  assert.match(masked, /cat > f$/, 'the rest of the command must stay visible');
});

step('an unterminated construct leaves the rest visible', () => {
  for (const input of ['echo "oops\ncat > f', "echo 'oops\ncat > f", 'echo ((\ncat > f']) {
    assert.match(maskShellSyntax(input), /cat > f$/, `blanked too much: ${JSON.stringify(input)}`);
  }
});

step('non-string input yields an empty string', () => {
  for (const v of [null, undefined, 42, {}]) assert.equal(maskShellSyntax(v), '');
});

console.log('\nshell-command — shellTokens');

const values = (cmd) => shellTokens(maskShellSyntax(cmd), cmd)
  .filter((t) => t.type === 'word').map((t) => t.value);

step('words, operators and separators are distinguished', () => {
  const tokens = shellTokens(maskShellSyntax('cat > out.txt'), 'cat > out.txt');
  assert.deepEqual(tokens.map((t) => t.type), ['word', 'op', 'word']);
  assert.equal(tokens[1].value, '>');
});

step('a quoted word resolves to its contents', () => {
  assert.deepEqual(values('cat > "my notes.md"'), ['cat', 'my notes.md']);
});

step('an fd prefix belongs to the operator, not the word', () => {
  const tokens = shellTokens(maskShellSyntax('make 2> err.log'), 'make 2> err.log');
  assert.deepEqual(tokens.map((t) => t.value), ['make', '>', 'err.log']);
  assert.equal(tokens[1].fd, '2');
});

step('write redirects are told apart from reads and fd duplication', () => {
  assert.equal(isWriteRedirect({ type: 'op', value: '>' }), true);
  assert.equal(isWriteRedirect({ type: 'op', value: '>>' }), true);
  assert.equal(isWriteRedirect({ type: 'op', value: '>|' }), true);
  assert.equal(isWriteRedirect({ type: 'op', value: '<' }), false);
  assert.equal(isWriteRedirect({ type: 'word', value: '>' }), false);
  assert.equal(isWriteRedirect(null), false);
});

step('a word containing an expansion is marked unresolvable but keeps its text', () => {
  const tokens = shellTokens(maskShellSyntax('cp --target-directory="$D" a.txt'), 'cp --target-directory="$D" a.txt');
  const flag = tokens.find((t) => t.value.startsWith('--target-directory'));
  assert.ok(flag.unresolvable, 'the value came from an expansion');
  assert.ok(flag.value.startsWith('--target-directory='), 'the literal prefix must survive');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
