#!/usr/bin/env node
// Tests for lib/bash-writes.mjs.
//
// The asymmetry matters: a missed target costs a bypass the model was already
// told not to use, while a spurious target DENIES a legitimate command. So the
// false-positive cases below carry more weight than the detection cases.
//
// Usage: node hooks/bash-writes.test.mjs

import assert from 'node:assert/strict';
import { bashWriteTargets } from './lib/bash-writes.mjs';

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

// Each entry carries the directory in effect where the write happens, so the
// helpers project to plain target names for the cases that do not care.
const targets = (cmd) => bashWriteTargets(cmd).map((f) => f.target);
const has = (cmd, target) => assert.ok(
  targets(cmd).includes(target),
  `expected ${target} in [${targets(cmd).join(', ')}] for: ${cmd}`,
);
const none = (cmd) => assert.deepEqual(targets(cmd), [], `expected no targets for: ${cmd}`);

console.log('\nbash-writes — redirects');

step('a simple redirect', () => has('cat > notes.md', 'notes.md'));
step('an append redirect', () => has('echo hi >> notes.md', 'notes.md'));
step('no space before the target', () => has('cat >notes.md', 'notes.md'));
step('a heredoc into a file', () => has('cat > src/a.js <<EOF\nx\nEOF', 'src/a.js'));
step('a redirect later in a chain', () => has('npm run build && node x.js > out.txt', 'out.txt'));
step('multiple targets in one command', () => {
  assert.deepEqual(targets('cat > a.txt; echo x >> b.txt').sort(), ['a.txt', 'b.txt']);
});

console.log('\nbash-writes — in-place and copy commands');

step('sed -i', () => has("sed -i '' 's/a/b/' file.js", 'file.js'));
step('sed -i with a suffix', () => has("sed -i.bak 's/a/b/' file.js", 'file.js'));
step('tee', () => has('echo x | tee file.js', 'file.js'));
step('tee -a', () => has('echo x | tee -a file.js', 'file.js'));
step('cp destination', () => has('cp /tmp/a.js src/a.js', 'src/a.js'));
step('mv destination', () => has('mv old.js src/new.js', 'src/new.js'));
step('dd of=', () => has('dd if=/dev/zero of=blob.bin bs=1', 'blob.bin'));
step('touch', () => has('touch newfile.txt', 'newfile.txt'));
step('an env-var prefix does not hide the command', () => has('FOO=1 tee out.txt', 'out.txt'));

console.log('\nbash-writes — must NOT fire (false positives deny real work)');

step('fd duplication is not a file', () => none('npm test 2>&1'));
step('stderr duplication is not a file', () => none('echo boom >&2'));
step('/dev/null is not a file', () => none('command -v pandoc > /dev/null'));
step('a > inside a quoted string', () => none('echo "a > b"'));
step('a > inside single quotes', () => none("grep 'x > y' file.txt"));
step('sed without -i only prints', () => none("sed 's/a/b/' file.js"));
step('a plain read', () => none('cat file.js'));
step('a comparison in a test expression', () => none('[ 5 -gt 3 ] && echo yes'));
step('git commands with no redirect', () => none('git commit -m "x" && git push'));
step('a flag that looks like a target', () => none('ls -la'));

console.log('\nbash-writes — a bare > that is not a redirect');

// These denied read-only commands. The model has no recovery from that: branching
// does not help, and the only escape is the global flag that disables the guard
// everywhere — the failure mode the guard's own header says it exists to avoid.
step('arithmetic comparison in (( ))', () => none('if (( count > 3 )); then echo hi; fi'));
step('string comparison in [[ ]]', () => none('[[ "$a" > "$b" ]] && echo yes'));
step('a > inside a trailing comment', () => none('echo done # writes > nothing'));
step('a > in a heredoc body', () => none('psql <<EOF\nselect 1 > 0;\nEOF'));
step('a > in a heredoc commit message', () => none('git commit -F- <<EOF\nfix: handle a > b\nEOF'));
step('a quoted heredoc delimiter still blanks the body', () => none("cat <<'EOF'\na > b\nEOF"));
step('an indented heredoc terminator', () => none('cat <<-EOF\na > b\n\tEOF'));

step('a real redirect after a heredoc block is still found', () => {
  has('cat <<EOF > out.txt\nbody > here\nEOF', 'out.txt');
});

step('shell syntax never counts as a filename', () => {
  for (const cmd of ['[[ $a > $b ]]', 'if (( x > 1 )); then :; fi']) {
    for (const t of bashWriteTargets(cmd)) {
      assert.ok(!/["'`()[\]{}$]/.test(t), `reported shell syntax as a target: ${t}`);
    }
  }
});

// Swept for more of the C-1 class rather than waiting to be told about them. The
// tee case was a real find: redirection operands belong to the shell, not to the
// command, so `< in.txt` was being read as something tee writes.
step('a shell construct is never mistaken for a file', () => {
  for (const cmd of [
    'diff <(sort a.txt) <(sort b.txt)',
    'tee >(wc -l) < in.txt',
    'awk \'{print > "out"}\' data.txt',
    'echo $(( 5 > 3 ))',
    'case $x in a) echo 1;; esac',
    'if [ "$a" \\> "$b" ]; then echo y; fi',
    'while (( i > 0 )); do i=$((i-1)); done',
    'find . -newer package.json -type f',
    "git log --format='>%h' -3",
    'grep -rn "a > b" src/',
    'sed -n "1,5p" file.js',
    'grep -i pattern file.js',
    'perl -ne "print" file.js',
    'jq ".a > .b" data.json',
    'npm run build > /dev/null 2>&1',
  ]) {
    assert.deepEqual(bashWriteTargets(cmd), [], `false positive on: ${cmd}`);
  }
});

step('an input redirect does not hide a real output redirect', () => {
  has('tee out.txt < in.txt', 'out.txt');
  has('sed -i "" s/a/b/ f.js > log.txt', 'log.txt');
});

console.log('\nbash-writes — fd-prefixed and remote targets');

step('1> and 2> create real files', () => {
  has('echo hi 1> notes.txt', 'notes.txt');
  has('make 2> errors.log', 'errors.log');
});
step('>| force-clobber', () => has('echo hi >| clobber.txt', 'clobber.txt'));
step('fd duplication is still not a file', () => {
  none('npm test 2>&1');
  none('echo boom >&2');
});
step('a remote rsync destination is not a local path', () => {
  none('rsync -av src/ user@host:/var/www');
  none('rsync -av src/ host:/tmp/x');
});

console.log('\nbash-writes — cd makes relative targets unresolvable');

// A whole-command "a cd happened" flag allowed `cd <repo> && cat > f` and let a cd
// appended AFTER a write excuse it. State is tracked while walking instead, so each
// target knows the directory in effect where its own write happens.
const only = (cmd) => {
  const all = bashWriteTargets(cmd);
  assert.equal(all.length, 1, `expected exactly one target for: ${cmd}`);
  return all[0];
};

step('a cd before the write pins that write\'s directory', () => {
  assert.deepEqual(only('cd /tmp && cat > x'), { target: 'x', dir: '/tmp', unknownDir: false });
  assert.deepEqual(only('( cd /tmp; echo x > n.txt )'), { target: 'n.txt', dir: '/tmp', unknownDir: false });
});

step('a multi-line cd is seen (it was invisible past line 1)', () => {
  assert.deepEqual(only('echo start\ncd /tmp\ncat > s.txt'), { target: 's.txt', dir: '/tmp', unknownDir: false });
  assert.deepEqual(only('pwd\npushd /tmp\necho x > f.txt'), { target: 'f.txt', dir: '/tmp', unknownDir: false });
});

step('successive cds accumulate', () => {
  assert.deepEqual(only('cd a && cd b && cat > x'), { target: 'x', dir: 'a/b', unknownDir: false });
  assert.deepEqual(only('cd /one && cd /two && cat > x'), { target: 'x', dir: '/two', unknownDir: false });
});

step('an unpinnable cd marks the directory unknown rather than guessing', () => {
  assert.equal(only('cd "$TMPDIR" && cat > x').unknownDir, true);
  assert.equal(only('cd - && cat > x').unknownDir, true);
});

step('a cd AFTER the write does not reach back and excuse it', () => {
  assert.deepEqual(only('echo hi > t.txt; cd /tmp'),
    { target: 't.txt', dir: null, unknownDir: false });
});

// Under-detection, unlike the false positives above: a subshell's cd does not
// outlive the subshell, so a later write lands in the ORIGINAL directory. Without
// restoring, that write was attributed to /tmp and allowed.
step('a subshell cd does not leak past its closing paren', () => {
  const all = bashWriteTargets('( cd /tmp; echo a > inside.txt ); cat > outside.txt');
  assert.deepEqual(all, [
    { target: 'inside.txt', dir: '/tmp', unknownDir: false },
    { target: 'outside.txt', dir: null, unknownDir: false },
  ]);
});

step('popd returns to where pushd came from', () => {
  const all = bashWriteTargets('pushd /tmp && cat > a.txt && popd && cat > b.txt');
  assert.deepEqual(all, [
    { target: 'a.txt', dir: '/tmp', unknownDir: false },
    { target: 'b.txt', dir: null, unknownDir: false },
  ]);
});

step('a popd with nothing pushed is unknown rather than assumed', () => {
  assert.equal(only('popd && cat > x').unknownDir, true);
});

step('no cd at all leaves the session cwd in charge', () => {
  assert.deepEqual(only('cat > x'), { target: 'x', dir: null, unknownDir: false });
  assert.deepEqual(only('echo "cd /tmp" > x'), { target: 'x', dir: null, unknownDir: false });
});

console.log('\nbash-writes — an escaped > is a comparison, not a redirect');

// `[ ]`, `test` and `expr` compare with `\>`. All four denied a read-only command.
step('escaped > in single brackets, test and expr', () => {
  none('[ "$count" \\> 0 ] && echo yes');
  none('test 3 \\> 2 && echo yes');
  none('expr $a \\> 5');
  none('if [ $x \\> 10 ]; then echo big; fi');
});

console.log('\nbash-writes — a quoted target must still be seen');

// Shape-rejection introduced in the previous round made these invisible: the token
// became a lone quote character and was discarded. This is what a model reaches for
// when a path has a space, so it is the most natural write shape in the language.
step('quoted redirect targets resolve to the filename', () => {
  has('echo hi > "notes.md"', 'notes.md');
  has("echo hi > 'notes.md'", 'notes.md');
  has('cat > "src/new file.ts"', 'src/new file.ts');
});

step('quoted operands of tee and cp resolve too', () => {
  has('echo x | tee "my out.txt"', 'my out.txt');
  has('cp a.txt "dest dir/b.txt"', 'dest dir/b.txt');
});

step('a target containing an expansion is skipped, not guessed', () => {
  none('cat > "$OUT/file.txt"');
  none('cat > "`hostname`.log"');
});

console.log('\nbash-writes — flag and path shapes');

step('-t / --target-directory names the destination', () => {
  has('cp -t /repo/dir a.txt b.txt', '/repo/dir');
  has('cp --target-directory=/repo/dir a.txt', '/repo/dir');
  assert.ok(!bashWriteTargets('cp -t /repo/dir a.txt b.txt').includes('b.txt'),
    'the positional guess must not name a source file');
});

step('a colon does not always mean a remote host', () => {
  has('echo x > 12:30.log', '12:30.log');
  has('cp a.txt C:\\repo\\f.txt', 'C:\\repo\\f.txt');
  none('rsync -av src/ user@host:/var/www');
  none('rsync -av src/ host:/tmp/x');
});

step('only a real in-place flag counts as editing', () => {
  none('perl -MList::Util -e "print" data.txt');
  none('perl -Ilib -e "print" t.pl');
  has('sed -i.bak s/a/b/ f.js', 'f.js');
  has('sed -Ei s/a/b/ f.js', 'f.js');
  has('perl -pi -e s/a/b/ f.js', 'f.js');
});

console.log('\nbash-writes — an unparseable construct must not blind the guard');

// The worst class found in review: a masking pass that met something it could not
// close blanked to end-of-string, so every write after it was invisible. An
// apostrophe in an English comment was enough. Unlike a false positive this is
// silent — the write simply happens.
step('an unterminated quote inside a comment does not hide later writes', () => {
  has("echo hi # don't clobber\necho x > notes.md", 'notes.md');
  has('ls # say "hi\ncat > notes.md', 'notes.md');
});

step('a herestring is not a heredoc opener', () => {
  has('grep foo <<< "bar"\ncat > notes.md', 'notes.md');
  has('grep foo <<< bar\ncat > notes.md', 'notes.md');
});

step('a heredoc opener inside a quoted argument is not an opener', () => {
  has('echo "close it with <<EOF"\ncat > notes.md', 'notes.md');
});

step('an unterminated quote or bracket leaves the rest visible', () => {
  has('echo "oops ; cat > notes.md', 'notes.md');
  has('echo (( ; cat > notes.md', 'notes.md');
  has("echo ' ; cat > notes.md", 'notes.md');
});

step('a real heredoc body is still blanked', () => {
  none('git commit -F- <<EOF\nfix: handle a > b\nEOF');
  none("cat <<'EOF'\na > b\nEOF");
  has('cat <<EOF > out.txt\nbody > x\nEOF', 'out.txt');
});

step('a # inside a quoted string is not a comment', () => {
  has('echo "a # b" > f.txt', 'f.txt');
});

console.log('\nbash-writes — every written operand counts');

// Only the LAST operand was reported, so one out-of-repo path at the end hid the
// rest: `touch keep.txt /tmp/x` was allowed while `touch /tmp/x keep.txt` denied.
step('touch, truncate and in-place sed report all their files', () => {
  assert.deepEqual(targets('touch keep.txt /tmp/x').sort(), ['/tmp/x', 'keep.txt']);
  assert.deepEqual(targets('truncate -s 0 keep.txt /tmp/q.log').sort(), ['/tmp/q.log', 'keep.txt']);
  assert.deepEqual(targets('sed -i s/x/y/ keep.txt /tmp/z.js').sort(), ['/tmp/z.js', 'keep.txt']);
});

step('a flag value is not mistaken for a file', () => {
  assert.deepEqual(targets('truncate -s 0 f.txt'), ['f.txt'], 'the size is not a file');
  assert.deepEqual(targets('touch -d "2020-01-01" f.txt'), ['f.txt'], 'the date is not a file');
});

step('a sed script expression is not a file', () => {
  assert.ok(!targets('sed -i s/x/y/ f.js').includes('s/x/y/'));
});

step('a copy destination is still only the last operand', () => {
  assert.deepEqual(targets('cp a.txt b.txt dest/'), ['dest/']);
});

console.log('\nbash-writes — an unusable -t value must not fall through');

// The fix for `cp -t DIR` reintroduced itself for any -t whose value is an
// expansion: the flag was detected, its value unusable, and the code then guessed
// positionally and denied on a SOURCE file with a message claiming it was written.
step('-t with an unresolvable value yields nothing, not the source', () => {
  none('cp -t "$DEST" a.txt');
  none('cp --target-directory="$D" a.txt');
  none('install -t "$D" a.txt');
});

step('-t with a usable value still names the destination', () => {
  has('cp --target-directory=/repo/d a.txt', '/repo/d');
});

console.log('\nbash-writes — pipeline elements are subshells too');

step('a cd in a pipeline element does not leak past the pipe', () => {
  assert.deepEqual(only('cd /tmp | true; cat > notes.md'),
    { target: 'notes.md', dir: null, unknownDir: false });
});

console.log('\nbash-writes — line continuation');

step('a backslash-newline is removed, not folded into the word', () => {
  assert.deepEqual(only('cd \\\n/tmp && cat > s.txt'),
    { target: 's.txt', dir: '/tmp', unknownDir: false });
});

console.log('\nbash-writes — documented gaps');

// Pinned so the limits are visible rather than assumed. Each falls through to
// "allowed" — the TOLERABLE direction for a known and enumerated gap, not the safe
// one. Under-detection is the quieter failure, so an unlisted gap is a bug.
step('GAP: a redirect nested inside a quoted -c string is not seen', () => {
  none('bash -c "cat > file.js"');
});

step('GAP: an interpreter writing through its own API is not seen', () => {
  none('node -e "require(\'fs\').writeFileSync(\'a.js\',\'x\')"');
});

console.log('\nbash-writes — robustness');

step('non-string input', () => {
  for (const v of [null, undefined, 42, {}, []]) assert.deepEqual(bashWriteTargets(v), []);
});
step('empty and whitespace', () => {
  none('');
  none('   \n  ');
});
step('targets are de-duplicated', () => {
  assert.deepEqual(targets('cat > a.txt; echo x > a.txt'), ['a.txt']);
});

// The same name under a different cwd is a different file, so it must survive dedup.
step('the same name in two directories is two targets', () => {
  assert.equal(bashWriteTargets('cat > a.txt; cd /tmp && cat > a.txt').length, 2);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
