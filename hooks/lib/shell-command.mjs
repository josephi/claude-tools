// Helpers for reading a shell command line.
//
// Two symmetric mistakes come from matching the raw string:
//
//   git commit -m "fix --amend handling"   -> a bare --amend suppressed the nudge
//   grep -rn "git commit" docs/            -> a bare `git commit` triggered it
//
// Anchoring to a command boundary fixes the second but not the first, because the
// flag genuinely does appear at a word boundary — just inside a quoted argument.
// Blanking quoted runs fixes both, and keeps offsets intact so anchors still mean
// what they say.

/**
 * Blank the contents of quoted runs so a pattern meant for a command's flags stops
 * reading its arguments.
 *
 * Now a thin alias for maskShellSyntax, which does the same job and more: it also
 * blanks comments and heredoc bodies, and — the reason this stopped being its own
 * implementation — it does not blank the rest of the command when it meets an
 * unterminated quote. Keeping two maskers meant keeping two failure directions, and
 * the wrong one was still reachable from the nudge and banner matchers.
 */
export const blankQuoted = (command) => maskShellSyntax(command);

const WRITE_OPS = new Set(['>', '>>', '>|']);
const SEPARATORS = new Set([';', '|', '&', '(', ')', '\n']);

/**
 * The closing quote of a run, or -1.
 *
 * `\"` does not close a double-quoted run. A single-quoted run has no escapes at all
 * — except in `$'…'`, where it does, which is what `honourEscapes` is for.
 */
function findClosingQuote(s, start, quote, honourEscapes = quote === '"') {
  for (let k = start + 1; k < s.length; k++) {
    if (honourEscapes && s[k] === '\\') { k++; continue; }
    if (s[k] === quote) return k;
  }
  return -1;
}

/**
 * Blank every construct whose contents must not be read as shell syntax — quoted
 * runs, `#` comments, `(( ))`, `[[ ]]`, heredoc bodies — preserving length so the
 * result stays offset-aligned with the input.
 *
 * One scan, not a pipeline of passes, because quotes and comments each suppress the
 * other and no fixed order gets both right: blanking quotes first makes an
 * apostrophe in `# don't clobber` open a run that never closes, and blanking
 * comments first makes `echo "a # b" > f.txt` lose half its argument.
 *
 * An UNTERMINATED construct is treated as a literal character and the rest of the
 * line stays visible. Blanking to end-of-string instead was a silent bypass: one
 * apostrophe in a comment hid every write on every following line. A command with
 * an unbalanced quote does not run in a shell anyway, so the worst cost of this
 * direction is a denial nobody could have executed; the cost of the other direction
 * is a write nobody sees.
 */
export function maskShellSyntax(command, { keepDoubleQuoted = false } = {}) {
  if (typeof command !== 'string') return '';

  const n = command.length;
  const out = command.split('');
  // Newlines are kept when blanking a comment or heredoc body (they still separate
  // commands) and flattened inside a quoted run (it is one word, not two).
  const blank = (from, to, keepNewlines) => {
    for (let k = Math.max(0, from); k < Math.min(to, n); k++) {
      out[k] = keepNewlines && command[k] === '\n' ? '\n' : ' ';
    }
  };

  let i = 0;
  while (i < n) {
    const ch = command[i];

    // An escaped character is literal, so it never OPENS anything. `echo won\'t` is
    // ordinary text, and treating that apostrophe as a quote let findClosingQuote
    // pair it with a real quote lines later — blanking every write in between.
    // Skipping the pair blanks nothing, so the offset invariant is untouched.
    if (ch === '\\' && i + 1 < n) { i += 2; continue; }

    // A comment runs to end of line. Only at a token boundary, so a `#` inside a
    // path or a URL fragment is not a comment.
    if (ch === '#' && (i === 0 || /[\s;&|()]/.test(command[i - 1]))) {
      const nl = command.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      blank(i, end, false);
      i = end;
      continue;
    }

    // `$'…'` is ANSI-C quoting, where `\'` is a literal apostrophe — so the run ends
    // at the LAST quote, not the escaped one. Treating it as a plain single-quoted run
    // closed it early and left an orphaned quote to pair with a real one further on,
    // blanking every write in between. Same mechanism as the `\'` bypass, one quote
    // form over. `$"…"` is locale translation and quotes the same way.
    if (ch === '$' && (command[i + 1] === "'" || command[i + 1] === '"')) {
      const quote = command[i + 1];
      const close = findClosingQuote(command, i + 1, quote, true);
      if (close === -1) { i += 2; continue; }
      blank(i + 2, close, false);
      i = close + 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const close = findClosingQuote(command, i, ch);
      if (close === -1) { i++; continue; }
      if (keepDoubleQuoted && ch === '"') { i = close + 1; continue; }
      blank(i + 1, close, false);
      i = close + 1;
      continue;
    }

    if ((ch === '(' && command[i + 1] === '(') || (ch === '[' && command[i + 1] === '[')) {
      const closer = ch === '(' ? '))' : ']]';
      const close = command.indexOf(closer, i + 2);
      if (close === -1) { i += 2; continue; }
      blank(i, close + closer.length, true);
      i = close + closer.length;
      continue;
    }

    // `<<EOF` opens a heredoc; `<<<` is a herestring and opens nothing. Reading the
    // herestring's word as a delimiter meant hunting for a terminator that never
    // came, which blanked the rest of the command.
    if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      // Delimiters bash accepts: bare, quoted, backslash-escaped (`<<\EOF`), and
      // quoted forms containing punctuation (`<<'e-o-f'`). A narrower pattern left
      // the body unmasked, so a `>` in it became a phantom write target.
      const m = /^<<-?\s*(?:\\([^\s;&|<>]+)|'([^']+)'|"([^"]+)"|([A-Za-z_]\w*))/.exec(command.slice(i));
      const bodyStart = m ? command.indexOf('\n', i) : -1;
      if (m && bodyStart !== -1) {
        const delimiter = m[1] ?? m[2] ?? m[3] ?? m[4];
        // `<<-` strips leading tabs from the terminator; plain `<<` requires it at
        // column 0 with nothing after it. Matching loosely could end the mask early,
        // inside a body that is still going.
        const dashed = command[i + 2] === '-';
        const lines = command.slice(bodyStart + 1).split('\n');
        let offset = bodyStart + 1;
        let terminated = false;
        for (const line of lines) {
          const isEnd = dashed ? line.replace(/^\t+/, '') === delimiter : line === delimiter;
          offset += line.length + 1;
          if (isEnd) { terminated = true; break; }
        }
        if (terminated) {
          blank(bodyStart + 1, offset - 1, true);
          i = offset - 1;
          continue;
        }
      }
      i += 2;
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * Tokenize a shell command into words, redirection operators and separators.
 *
 * Two strings of the same length: `masked` supplies the STRUCTURE and `source` the
 * VALUES. Callers blank whatever must not be read as syntax (quoted runs, `[[ ]]`,
 * heredoc bodies, comments) in `masked` while leaving `source` intact, and every
 * blanking pass preserves length so offsets stay aligned. That is what lets
 * `> "my notes.md"` yield the filename instead of a lone quote character.
 *
 * Replaces a pile of regexes over the raw line. Those kept mistaking one thing for
 * another in both directions — `\>` and `(( a > b ))` read as redirects, quoted
 * targets not read at all — because a `>` means different things in different
 * places and a regex cannot see which place it is in.
 *
 * Both parameters are required: defaulting `source` to `masked` let a caller read
 * values out of the structural view and get blanks where filenames should be.
 *
 * @param {string} masked structural view; same length as source
 * @param {string} source value view — the original command
 * @returns {Array<{type: 'word'|'op'|'sep', value: string, fd?: string, unresolvable?: boolean}>}
 */
export function shellTokens(masked, source) {
  if (typeof source !== 'string') throw new TypeError('shellTokens requires both masked and source');
  if (typeof masked !== 'string') return [];

  const tokens = [];
  let word = null;
  let unresolvable = false;

  // An unresolvable word (it contained an expansion) keeps whatever literal text it
  // has and carries the flag; consumers must check `unresolvable` before treating a
  // value as a path. Emitting '' instead threw away the literal part, which lost the
  // flag name in `--target-directory="$D"` and sent the caller to a positional guess
  // that named a source file.
  const flush = () => {
    if (word === null) return;
    tokens.push({ type: 'word', value: word, unresolvable });
    word = null;
    unresolvable = false;
  };
  const add = (text) => { word = (word ?? '') + text; };

  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];

    // A backslash escape makes the next character literal, so `\>` is a comparison
    // operand rather than a redirect. This is why `test 3 \> 2` is not a write.
    //
    // Only for non-alphanumerics: `\>`, `\"`, `\$` and `\ ` are the escapes people
    // write on purpose, while a backslash before a letter is far more likely a
    // Windows separator (`C:\repo\file.txt`) than a deliberate no-op escape of `r`.
    // Backslash-newline is a line continuation: POSIX removes the pair entirely.
    // Keeping the newline put it inside the word, so `cd \<newline>/tmp` yielded a
    // directory of "\n/tmp" and the write was judged against the wrong place.
    if (ch === '\\' && masked[i + 1] === '\n') { i++; continue; }

    if (ch === '\\' && i + 1 < masked.length) {
      if (/[A-Za-z0-9]/.test(masked[i + 1])) add('\\');
      add(source[i + 1] ?? masked[i + 1]);
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const close = masked.indexOf(ch, i + 1);
      // An unterminated quote is a literal character, not the end of the line.
      // Stopping here made everything after it invisible — the same fail-blind
      // direction the masking pass had.
      if (close === -1) { add(ch); continue; }
      const inner = source.slice(i + 1, close);
      // An expansion inside the quotes is not resolvable here; mark the whole word
      // unusable rather than reporting a literal `$VAR` as a path.
      if (/[$`]/.test(inner)) unresolvable = true;
      add(inner);
      i = close;
      continue;
    }

    if (/\s/.test(ch) && ch !== '\n') { flush(); continue; }

    if (SEPARATORS.has(ch)) {
      flush();
      const two = masked.slice(i, i + 2);
      if (two === '&&' || two === '||') { tokens.push({ type: 'sep', value: two }); i++; }
      else tokens.push({ type: 'sep', value: ch });
      continue;
    }

    if (ch === '>' || ch === '<') {
      // A bare fd prefix (`2>`) is part of the operator, not a word.
      let fd = '';
      if (word !== null && /^\d+$/.test(word)) { fd = word; word = null; }
      flush();

      let op = ch;
      if (masked[i + 1] === ch) { op += ch; i++; }
      else if (ch === '>' && masked[i + 1] === '|') { op += '|'; i++; }
      tokens.push({ type: 'op', value: op, fd });
      continue;
    }

    // A `$` outside quotes is an expansion too: `cat > $OUT` is not a known path.
    if (ch === '$' || ch === '`') unresolvable = true;

    add(source[i] ?? ch);
  }

  flush();
  return tokens;
}

/** True when the operator creates or truncates a file, rather than duplicating an fd. */
export function isWriteRedirect(token) {
  return token?.type === 'op' && WRITE_OPS.has(token.value);
}
