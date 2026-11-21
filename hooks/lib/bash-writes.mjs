// Which files a Bash command is about to write.
//
// The write guard denies Edit/Write/MultiEdit/NotebookEdit on a base branch, but
// `cat > file`, `tee`, `sed -i` and friends reach the filesystem without touching
// any of those tools. Until this existed, the guard's own deny message asked the
// model not to shell around it — prose requesting compliance, which is the exact
// thing the guard exists to replace.
//
// READ THIS BEFORE TRUSTING IT: this is a best-effort deterrent, not a control. It
// is known to be bypassable through shell quoting, and it always will be — nine
// review passes found six different constructs that slipped past, each one a quoting
// or grouping form the previous fix did not model. Assume there are more.
//
// The guard that cannot be bypassed is the `pre-commit` hook in
// base-branch-precommit.sh, which needs no understanding of shell at all: by the
// time it runs, git already knows the branch. Enforcement lives there. This file
// exists to catch the ordinary cases early and explain them, while the write is
// still the thing being discussed.
//
// Both directions of error matter, differently. A FALSE POSITIVE denies a read-only
// command, and the model's only escape is the global BENCH_ALLOW_BASE_EDITS,
// which turns the guard off everywhere. UNDER-DETECTION is quieter: the write just
// happens — which is what happens with no guard at all, so it is a shortfall rather
// than a regression.
//
// The line is tokenized rather than pattern-matched: everything that must not be
// read as syntax is blanked length-preservingly into a structural view, values are
// read from the original at the same offsets, and `>` counts only where the
// tokenizer says it is an operator. Note what this cannot give you — a masker's only
// operation is blanking, so "blanked more than bash would, and saw nothing" is its
// native failure mode. Every silent bypass found so far was exactly that.
//
// Known gaps, all of which fall through to "allowed": a nested interpreter
// (`bash -c "…"`, `eval "…"`, `python -c`, `node -e`, `awk '{print > "f"}'`) hides
// its redirect inside a quoted run, `xargs`/`find -exec` pass the write to a child,
// and open-ended output flags (`sort -o`, `curl -o`, `git archive -o`) are not
// enumerated. A filename containing a colon before its first slash
// (`report:final.md`) is read as an rsync host and skipped. This list is what is
// KNOWN, not what exists.
//
// What would make this converge, if it is ever worth the effort: a differential fuzz
// harness — generate commands, run each in a throwaway directory under a real bash,
// and diff the files actually created against what this reports. Every bug found so
// far has been in semantics, and nothing here tests semantics against the real shell.

import { basename, isAbsolute } from 'node:path';
import { maskShellSyntax, shellTokens, isWriteRedirect } from './shell-command.mjs';

// Not real files. The /dev/* sinks are how output gets discarded.
const NOT_A_FILE = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', '-']);

// `user@host:/path` — an rsync/scp destination is remote, so resolving it as a
// local relative path would judge the wrong thing entirely. The host part must
// contain a letter or `@` and be at least two characters, so `12:30.log` stays a
// file and a Windows `C:\repo\file` is judged rather than dismissed as a host.
const REMOTE_TARGET = /^(?=[^:]*[A-Za-z@])[^/\\\s:]{2,}:/;

// An in-place edit flag: `-i`, `-i.bak`, `-pi`, `-Ei`, `--in-place`. The `i` has to
// END the cluster (optionally followed by a backup suffix). "Any cluster containing
// an i" read `perl -Ilib` and `perl -MList::Util` as in-place editing.
const IN_PLACE = /^(?:--in-place(?:=\S*)?|-[a-zA-Z]*i(?:\.\S+)?)$/;

// Destination is positionally last, so only that operand is written.
const COPY_COMMANDS = new Set(['cp', 'mv', 'install', 'rsync']);

// EVERY file operand is written. Taking only the last one meant `touch keep.txt
// /tmp/x` was allowed, because one out-of-repo operand at the end hid the rest.
const MULTI_TARGET_COMMANDS = new Set(['touch', 'truncate', 'tee']);

// Flags whose next operand is a VALUE, not a file — per command, because the same
// short flag means different things: `-m` takes a mode for `install` but is a bare
// "modification time only" for `touch`, and consuming its operand there swallowed
// the only file (`touch -m notes.md` reported nothing). `-o` is the same story
// between `install` and `truncate`.
const VALUE_FLAGS_BY_COMMAND = {
  touch: new Set(['-d', '--date', '-r', '--reference', '-t']),
  truncate: new Set(['-s', '--size', '-r', '--reference']),
  install: new Set(['-m', '--mode', '-o', '--owner', '-g', '--group', '-t', '--target-directory', '--suffix', '-S']),
  cp: new Set(['-t', '--target-directory', '-S', '--suffix']),
  mv: new Set(['-t', '--target-directory', '-S', '--suffix']),
  rsync: new Set(['--exclude', '--include', '--files-from', '-e', '--rsh', '--chmod']),
  tee: new Set([]),
  // `-e`/`-f` supply the script itself, so their operands are never files. Missing
  // `-f` reported the .sed script file as something the command writes.
  sed: new Set(['-e', '--expression', '-f', '--file', '-l', '--line-length']),
  perl: new Set(['-e', '-E', '-f', '-I', '-M', '-m']),
};
const NO_VALUE_FLAGS = new Set();

/** @returns {boolean} usable as a local path we can judge */
function isPathish(word) {
  if (!word || word.unresolvable) return false;
  const value = word.value;
  return Boolean(value)
    && !value.startsWith('-')
    && !NOT_A_FILE.has(value)
    && !REMOTE_TARGET.test(value);
}

/**
 * The structural view: everything that must not be read as shell syntax, blanked.
 * Values come from the command itself, since the tokenizer only reads offsets the
 * mask left visible.
 */
function maskedView(command) {
  return { masked: maskShellSyntax(command), source: command };
}

/**
 * Index of the `)` matching the `(` at `open`, or -1.
 *
 * Skips quoted runs: a body like `echo '(' ; tee c.txt` never balances otherwise, and
 * an unbalanced scan returned -1, which silently dropped the whole substitution —
 * including the write inside it.
 */
function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '"' || ch === "'") {
      const close = text.indexOf(ch, i + 1);
      if (close === -1) return -1;
      i = close;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * The bodies of `$( … )` and backtick command substitutions.
 *
 * A redirect inside one is a real write — `X="$(tee out.txt)"` creates out.txt — and
 * it is ordinary bash, not a nested interpreter. Inside double quotes the body was
 * blanked along with the rest of the quoted run, so the write was invisible while
 * the unquoted form was caught: an asymmetry with no justification. Bodies are
 * scanned recursively instead.
 */
export function commandSubstitutions(command) {
  const out = [];
  // Substitution is suppressed inside single quotes, comments, and quoted heredoc
  // bodies — that text is inert, and denying on it blocked real commands
  // (`git commit -m 'run $(tee build.log) to capture'` writes nothing). This view
  // blanks exactly those regions while leaving double-quoted runs visible, where
  // substitution IS live.
  const live = maskShellSyntax(command, { keepDoubleQuoted: true });

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\') { i++; continue; }
    if (live[i] !== ch) continue;

    // `$((…))` is arithmetic, not a command: recursing into it read the `>` in
    // `$(( 5 > 3 ))` as a redirect and reported `3` as a file.
    if (ch === '$' && command[i + 1] === '(' && command[i + 2] !== '(') {
      const end = matchingParen(command, i + 1);
      if (end !== -1) { out.push(command.slice(i + 2, end)); i = end; }
      continue;
    }

    if (ch === '`') {
      const end = command.indexOf('`', i + 1);
      if (end !== -1) { out.push(command.slice(i + 1, end)); i = end; }
    }
  }
  return out;
}

/**
 * The files an in-place `sed`/`perl` rewrites.
 *
 * Positional, not pattern-matched: unless the script was supplied with `-e`/`-f`,
 * the FIRST non-flag operand is the script and the rest are files. Recognising
 * script text by shape missed `tr/a/b/` and would keep missing whatever came next.
 */
function inPlaceFiles(operands, cmd) {
  // `-E` is perl's "script with a feature bundle" but sed's extended-regex switch,
  // which takes no operand — reading it as "the script came from a flag" left the
  // positional script in the file list and denied on `sed -i -E 's/a/b/' f`.
  const scriptFlag = cmd === 'perl'
    ? /^-{1,2}(e|E|f|expression|file)$/
    : /^-{1,2}(e|f|expression|file)$/;
  const scriptGivenByFlag = operands.some((w) => scriptFlag.test(w.value));

  // BSD `sed -i ''` takes the backup suffix as a separate operand, so on macOS the
  // empty string occupied the script's slot and the script became a phantom file.
  const files = fileOperands(operands, cmd).filter((w) => w.value.trim() !== '');
  return scriptGivenByFlag ? files : files.slice(1);
}

/** File operands only: flags dropped, and the values those flags consume dropped too. */
function fileOperands(operands, cmd = '') {
  const valueFlags = VALUE_FLAGS_BY_COMMAND[cmd] ?? NO_VALUE_FLAGS;
  const out = [];
  for (let i = 1; i < operands.length; i++) {
    const w = operands[i];
    if (w.value.startsWith('-')) {
      if (valueFlags.has(w.value)) i++;
      continue;
    }
    out.push(w);
  }
  return out;
}

/**
 * The destination named by `-t DIR` or `--target-directory=DIR`.
 *
 * Returns null when there is no such flag, and `{dir: null}` when the flag is there
 * but its value is unusable — the caller must tell those apart. Collapsing both to
 * null made `cp -t "$DEST" a.txt` fall through to the positional guess and deny on
 * `a.txt`, a SOURCE file, with a message claiming the command writes it.
 */
function targetDirectoryFlag(operands) {
  for (let i = 1; i < operands.length; i++) {
    const w = operands[i];
    if (w.value === '-t' || w.value === '--target-directory') {
      const next = operands[i + 1];
      return { dir: isPathish(next) ? next.value : null };
    }
    // The value may be unresolvable (`--target-directory="$D"`), in which case the
    // token keeps the literal prefix and only the expansion is missing.
    if (w.value.startsWith('--target-directory=')) {
      const value = w.value.slice('--target-directory='.length);
      const usable = !w.unresolvable && value && isPathish({ value });
      return { dir: usable ? value : null };
    }
  }
  return null;
}

/**
 * The destination operand of a cp/mv/rsync-shaped command: positionally the last
 * file operand. Returns '' when that operand is not a local path — scanning further
 * back would report the SOURCE as the write target, which is both wrong and a
 * denial of a command that writes somewhere else entirely.
 */
function destinationOperand(operands, cmd = '') {
  const files = fileOperands(operands, cmd);
  if (!files.length) return '';
  const last = files[files.length - 1];
  return isPathish(last) ? last.value : '';
}

// `mv` and `rsync --remove-source-files` delete their sources, so a source is a
// write too: `mv src/app.js backups/` changes the repo as much as an edit does.
function removesSources(cmd, operands) {
  if (cmd === 'mv') return true;
  return cmd === 'rsync' && operands.some((w) => w.value === '--remove-source-files');
}

function sourceOperands(operands, cmd, destinationIsAFlag) {
  const files = fileOperands(operands, cmd);
  const sources = destinationIsAFlag ? files : files.slice(0, -1);
  return sources.filter(isPathish).map((w) => w.value);
}

/**
 * The directory a `cd`/`pushd`/`popd` segment moves to.
 * `dir: null` means it cannot be pinned down from the command text alone.
 */
function cdArgument(words) {
  const cmd = basename(words[0]?.value ?? '');
  if (cmd === 'popd') return { isCd: true, isPopd: true };
  if (cmd !== 'cd' && cmd !== 'pushd') return { isCd: false };

  const isPushd = cmd === 'pushd';
  const arg = words[1];
  // `cd -` goes back to $OLDPWD and `cd` with no argument goes home; neither is
  // resolvable from the command text alone.
  if (!arg || arg.unresolvable || arg.value === '-' || !arg.value.trim()) {
    return { isCd: true, isPushd, dir: null };
  }
  return { isCd: true, isPushd, dir: arg.value };
}

/**
 * @param {string} command
 * @returns {Array<{target: string, dir: string|null, unknownDir: boolean}>}
 *   `dir` is the directory in effect where that write happens, relative to the
 *   session cwd; `unknownDir` means the cwd at that point could not be determined
 *   and a relative target must not be guessed at.
 *
 * State is tracked while walking, not summarised for the whole command, because a
 * `cd` only affects the writes that come AFTER it — `echo hi > f.txt; cd /tmp`
 * writes into the session cwd, and a whole-command "a cd happened" flag excused it.
 */
export function bashWriteTargets(command, depth = 0) {
  if (typeof command !== 'string' || !command.trim()) return [];

  const { masked, source } = maskedView(command);
  const tokens = shellTokens(masked, source);
  const found = [];

  let dir = null;
  let unknownDir = false;
  const record = (target) => found.push({ target, dir, unknownDir });

  // A subshell's `cd` does not outlive the subshell, so `( cd /tmp; … ); cat > f`
  // writes f in the ORIGINAL directory. Without restoring on `)`, that write was
  // attributed to /tmp and allowed — under-detection, the direction this guard must
  // not get wrong quietly.
  const subshells = [];
  // `pushd`/`popd` are a stack of their own; popd returns to the previous entry
  // rather than to anywhere we would have to guess at.
  const pushed = [];

  const runSegment = (segment) => {
    const words = [];

    for (let i = 0; i < segment.length; i++) {
      const t = segment[i];

      if (t.type === 'op') {
        const operand = segment[i + 1];
        // The operand belongs to the shell either way, so it never counts as one
        // of the command's own file arguments — that is what made `tee out < in`
        // report the input file.
        if (operand?.type === 'word') i++;
        if (isWriteRedirect(t) && operand?.type === 'word' && isPathish(operand)) {
          record(operand.value);
        }
        continue;
      }

      words.push(t);
    }

    if (!words.length) return;

    // A brace group is not a subshell — `{ cd /tmp; …; }` really does move the shell
    // — but its braces are words, so `words[0]` was `{` and the cd went unseen.
    while (words.length && ['{', '}', '!', 'time'].includes(words[0].value)) words.shift();
    if (!words.length) return;

    // Applied after this segment's own targets, so a trailing `cd` cannot reach
    // back and excuse a write that already happened.
    const cd = cdArgument(words);
    if (cd.isCd) {
      if (cd.isPopd) {
        if (pushed.length) { ({ dir, unknownDir } = pushed.pop()); }
        else unknownDir = true;
        return;
      }
      if (cd.isPushd) pushed.push({ dir, unknownDir });
      if (!cd.dir) unknownDir = true;
      else if (isAbsolute(cd.dir)) { dir = cd.dir; unknownDir = false; }
      else dir = dir ? `${dir}/${cd.dir}` : cd.dir;
      return;
    }

    let i = 0;
    while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i].value)) i++;
    if (i >= words.length) return;

    const cmd = basename(words[i].value);
    const operands = words.slice(i);

    if (MULTI_TARGET_COMMANDS.has(cmd)) {
      for (const w of fileOperands(operands, cmd)) if (isPathish(w)) record(w.value);
      return;
    }

    if (cmd === 'sed' || cmd === 'perl') {
      // In-place editing rewrites every file listed, not just the last.
      if (operands.some((w) => IN_PLACE.test(w.value))) {
        for (const w of inPlaceFiles(operands, cmd)) if (isPathish(w)) record(w.value);
      }
      return;
    }

    if (cmd === 'dd') {
      for (const w of operands) {
        if (!w.value.startsWith('of=')) continue;
        const value = w.value.slice(3);
        if (!w.unresolvable && isPathish({ value })) record(value);
      }
      return;
    }

    if (COPY_COMMANDS.has(cmd)) {
      // `-t DIR` / `--target-directory=DIR` moves the destination off the end, so
      // the positional guess would name a source file instead.
      const explicit = targetDirectoryFlag(operands);
      if (removesSources(cmd, operands)) {
        for (const source of sourceOperands(operands, cmd, Boolean(explicit))) record(source);
      }
      if (explicit) {
        if (explicit.dir) record(explicit.dir);
        return;
      }
      const target = destinationOperand(operands, cmd);
      if (target) record(target);
    }
  };

  let segment = [];
  // The directory as it was when the current pipeline started, to restore at each
  // `|` boundary: every element of a pipeline runs in its own subshell.
  let pipelineEntry = { dir: null, unknownDir: false };

  for (const t of tokens) {
    if (t.type !== 'sep') { segment.push(t); continue; }

    runSegment(segment);
    segment = [];

    if (t.value === '|') {
      dir = pipelineEntry.dir;
      unknownDir = pipelineEntry.unknownDir;
      continue;
    }

    if (t.value === '(') subshells.push({ dir, unknownDir, pushedDepth: pushed.length });
    else if (t.value === ')') {
      const outer = subshells.pop();
      if (outer) {
        dir = outer.dir;
        unknownDir = outer.unknownDir;
        pushed.length = outer.pushedDepth;
      }
    }

    // AFTER the subshell pop, not before: snapshotting first captured the inner
    // directory, so `(cd /a) | cat > f` restored a directory the shell was never in
    // and resolved the write outside the repo entirely.
    pipelineEntry = { dir, unknownDir };
  }
  runSegment(segment);

  // A substitution body is judged against the directory the command started in
  // rather than wherever a later `cd` moved to. That resolves against the session
  // cwd, which errs toward judging the write rather than skipping it.
  if (depth < 3) {
    for (const body of commandSubstitutions(command)) {
      for (const inner of bashWriteTargets(body, depth + 1)) {
        found.push({ ...inner, dir: inner.dir, unknownDir: inner.unknownDir });
      }
    }
  }

  const seen = new Set();
  return found.filter((f) => {
    const key = JSON.stringify([f.dir, f.unknownDir, f.target]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
