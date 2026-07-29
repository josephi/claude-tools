// GitHub issue-reference detection for prompt routing, statusline, and session naming.
//
// The work original matched Jira keys (`SYNC-27347`), where the letter prefix
// carries most of the signal. A GitHub issue is a bare number, which carries
// none — "fix the 42 failing tests" must never read as issue 42. So detection
// is marker-driven rather than shape-driven: a number only counts when
// something next to it says it is an issue.
//
// Recognised markers:
//   #42            the canonical form, and what `gh` prints
//   GH-42 / gh-42  used in branch and commit text where `#` is awkward
//   issue 42       prose, with or without the `#`
//
// Deliberately NOT recognised: a bare number anywhere. There is no denylist to
// maintain here precisely because nothing matches without a marker — the work
// version needed one (utf-8, sha-256, CVE-2024-1234) only because its pattern
// matched every `<letters>-<digits>` token in the language.

const HASH_RE = /(?<![\w#])#(\d{1,5})\b/g;
const GH_RE = /\bgh-(\d{1,5})\b/gi;
const PROSE_RE = /\bissues?\s+#?(\d{1,5})\b/gi;

// Highest plausible issue number. Anything larger is a year, a port, a line
// count — not an issue in a personal repo.
const MAX_ISSUE = 99999;

/**
 * Extract every GitHub issue reference from `text`.
 * @param {string} text
 * @returns {Array<{raw: string, number: string, ref: string}>}
 *   `ref` is the canonical `#42` form.
 */
export function findIssueRefs(text) {
  if (typeof text !== 'string' || text === '') return [];

  const out = [];
  const seen = new Set();

  for (const re of [HASH_RE, GH_RE, PROSE_RE]) {
    for (const m of text.matchAll(re)) {
      const number = String(Number.parseInt(m[1], 10));
      if (!Number.isFinite(Number(number)) || Number(number) < 1) continue;
      if (Number(number) > MAX_ISSUE) continue;

      const ref = `#${number}`;
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push({ raw: m[0], number, ref });
    }
  }

  // matchAll runs per-pattern, so results arrive grouped by marker rather than
  // in the order they appear. Callers render these to the user, so sort by
  // position in the original text.
  out.sort((a, b) => text.indexOf(a.raw) - text.indexOf(b.raw));
  return out;
}

/** First issue reference in `text`, or null. */
export function findIssueRef(text) {
  return findIssueRefs(text)[0] ?? null;
}

/**
 * Session / worktree name for a task, per the git-conventions branch shape:
 * `<issue-number>__<kebab-description>`, mirroring the branch tail so the
 * session, the worktree dir and the branch all read the same.
 */
export function sessionName(ref, description = '') {
  const parsed = typeof ref === 'string' ? (findIssueRef(ref) ?? bareNumber(ref)) : ref;
  if (!parsed) return null;
  const kebab = toKebab(description);
  return kebab ? `${parsed.number}__${kebab}` : parsed.number;
}

// sessionName is also called with a already-extracted number ("42"), which has
// no marker and so would not survive findIssueRef.
function bareNumber(s) {
  const m = /^\s*#?(\d{1,5})\s*$/.exec(s);
  if (!m) return null;
  const number = String(Number.parseInt(m[1], 10));
  return Number(number) >= 1 && Number(number) <= MAX_ISSUE
    ? { raw: m[0].trim(), number, ref: `#${number}` }
    : null;
}

export function toKebab(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * Issue implied by a branch name, e.g. `refactor/42_extract-producer` -> #42.
 *
 * Per git-conventions the number is the first `_`-delimited segment after the
 * `<type>/` prefix, so it is read positionally rather than by marker — a branch
 * is structured where prose is not.
 */
export function issueRefFromBranch(branch) {
  if (typeof branch !== 'string') return null;
  const tail = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch;
  const m = /^(\d{1,5})(?:_|$)/.exec(tail);
  if (!m) return null;
  const number = String(Number.parseInt(m[1], 10));
  if (Number(number) < 1 || Number(number) > MAX_ISSUE) return null;
  return { raw: m[1], number, ref: `#${number}` };
}

/** The `<short-goal>` half of `<type>/<issue-number>_<short-goal>`. */
export function branchGoal(branch) {
  if (typeof branch !== 'string') return '';
  const tail = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch;
  const us = tail.indexOf('_');
  return us === -1 ? '' : tail.slice(us + 1);
}

export { MAX_ISSUE };
