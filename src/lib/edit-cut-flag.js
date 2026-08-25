// ─── edit-cut-flag.js ────────────────────────────────────────────────────────
// Whether Voxel Edit Cut is visible to a signed-in customer.
//
// ── WHY THIS EXISTS (2026-08-25, approved by Amr) ──────────────────────────
// 91 commits sat on dev waiting to reach production, and they are INTERLEAVED:
// 39 of them are Edit Cut, 37 are not, 15 touch both. Among the 37 are three
// live production bugs — nobody could sign in on an iPad in landscape, the
// Enhance button was dead, and the library downloaded a customer's entire
// history to paint one grid.
//
// Cherry-picking 37 interleaved commits onto main is where a bad deploy gets
// made: several of them depend on Edit Cut files, and the module that fixes
// Enhance shares a file with the agent. So instead everything ships, and the
// one thing that is not ready is switched off.
//
// ── THE SAFETY PROPERTY THAT MATTERS ───────────────────────────────────────
// The flag can only ever turn Edit Cut ON. There is no value of the
// environment — missing, empty, misspelled, a leftover from another app — that
// reveals it by accident. Production needs NO variable set and NO change to
// .do/app.yaml, which means shipping this cannot alter production
// infrastructure even by mistake.
//
// A flag whose default is "hidden" fails towards the waitlist customers
// already see. A flag whose default is "shown" fails towards a half-finished
// editor in front of paying customers, and you find out from them.

/** Hosts that are ours to break. Exact matches only — a substring test would
 *  match `dev.voxel-ai.ai.evil.com`, and a flag that can be spoofed by a
 *  hostname is not a flag. */
const DEV_HOSTS = new Set([
  'dev.voxel-ai.ai',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

/**
 * @param {object}  opts.env       import.meta.env, injectable for tests
 * @param {string}  opts.hostname  location.hostname, injectable for tests
 */
export function editCutEnabled({ env, hostname } = {}) {
  // A default parameter only fills in for `undefined`, NOT for null — so
  // `{ env: null }` would sail past `env = {}` and throw on the next line.
  // This runs during render, and an exception here is a blank page, which is
  // worse than either answer the function could have given. Found by the
  // "it never throws" test, which is the only reason it is not a live bug.
  const e = env || {};
  const host = String(hostname || '').trim().toLowerCase();

  // 1. An explicit ON wins everywhere, including production. This is the
  //    switch Amr flips when Edit Cut is ready: one variable in the
  //    DigitalOcean panel, no code change, no pull request.
  const flag = String(e.VITE_EDIT_CUT ?? '').trim().toLowerCase();
  if (flag === 'on' || flag === 'true' || flag === '1') return true;

  // 2. An explicit OFF wins over the host rule, so dev can be made to look
  //    exactly like production for a check without editing code.
  if (flag === 'off' || flag === 'false' || flag === '0') return false;

  // 3. Otherwise: our own machines yes, everywhere else no.
  return DEV_HOSTS.has(host);
}

/** The live answer, for components. Wrapped so tests never touch globals. */
export function editCutVisible() {
  const env = typeof import.meta !== 'undefined' ? import.meta.env : {};
  const hostname = typeof location !== 'undefined' ? location.hostname : '';
  return editCutEnabled({ env, hostname });
}
