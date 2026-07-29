// Atomic file replacement for the plugin's config and state writers
// (settings.local.json via ownership.mjs and sync.mjs, installed.json).
//
// A direct write truncates the file first, so a crash or full disk mid-write
// loses the user's GitHub, gcloud and Supabase tokens with no backup. Writing a temp
// file and renaming over the target is atomic on POSIX.
//
// The mode must be carried over explicitly: rename installs a NEW inode, so
// unlike an in-place write it does not inherit the original permissions — a 0600
// credential file would come back as 0666 & ~umask.

import { writeFileSync, renameSync, statSync, unlinkSync } from 'node:fs';

export function atomicWriteFileSync(path, content, { fallbackMode = 0o600 } = {}) {
  let mode = fallbackMode;
  try { mode = statSync(path).mode & 0o777; } catch { /* new file: keep the tight default */ }

  const tmp = `${path}.bench.tmp`;
  // A stale tmp from a crashed run must go first: writeFileSync's mode option
  // only applies when it CREATES the file, so reusing a leftover 0644 tmp would
  // rename the wrong permissions into place — the exact downgrade the mode
  // handling above exists to prevent.
  try { unlinkSync(tmp); } catch { /* none there */ }

  try {
    writeFileSync(tmp, content, { mode });
    renameSync(tmp, path);
  } catch (e) {
    // Do not leave a half-written copy of a credentials file lying around.
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}
