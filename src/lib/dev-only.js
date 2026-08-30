// ─── dev-only.js ─────────────────────────────────────────────────────────────
// Hosts that are ours to break.
//
// The same rule edit-cut-flag.js uses, pulled out so a second dev-only screen
// does not copy the list and let the two drift. Deliberately NOT a refactor of
// edit-cut-flag: that flag has an env override, a documented safety property
// and its own tests, and rewriting a working production gate to save four
// lines is how a working production gate stops working.
//
// EXACT matches only. A substring test would accept `dev.voxel-ai.ai.evil.com`,
// and a gate that a hostname can spoof is not a gate.

export const DEV_HOSTS = new Set([
  'dev.voxel-ai.ai',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

/** True only on our own machines. Fails towards HIDDEN for every input —
 *  undefined, null, empty, a lookalike domain. */
export function isDevHost(hostname) {
  return DEV_HOSTS.has(String(hostname || '').trim().toLowerCase());
}

/** The live answer, for components. Wrapped so tests never touch globals. */
export function devOnlyVisible() {
  return isDevHost(typeof location !== 'undefined' ? location.hostname : '');
}
