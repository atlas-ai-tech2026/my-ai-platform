// ─── sop-sources.js ──────────────────────────────────────────────────────────
// Where every line on the SOP screen gets its facts — declared, and enforced.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// On 2026-08-20 the owner said the thing that made this necessary:
//
//   "When you build that SOP, you give me proof it's working fine... When you
//    said you build it and it's working fine, I must believe you. But now after
//    this has happened, we need to verify everything in SOP, and this is
//    wasting of time."
//
// They were right. The "Daily backup" line read a module-level object that
// every restart wipes, so it reported "not checked" while backups ran
// perfectly — and once ONE line has lied, every other line has to be re-checked
// by hand. My assurance that the rest were fine is worth exactly nothing,
// because it is the same assurance I gave about the broken one.
//
// So the answer is a check, not a promise. Every line must DECLARE where its
// facts come from, and the test suite refuses any line whose source cannot
// survive a restart — or any new line that forgets to say.
//
// ── THE PROPERTY BEING PROTECTED ───────────────────────────────────────────
// A check must be able to tell "this is broken" apart from "this process
// started a minute ago". Anything held in process memory cannot: a redeploy
// resets it, and on an app that deploys several times a day the difference is
// invisible exactly when it matters.

export const KIND = {
  /** A table. Survives restarts and deploys. */
  DATABASE: 'database',
  /** Listed or read from object storage. The object itself is the evidence. */
  BUCKET: 'bucket',
  /** A call to the provider, made now. */
  LIVE_API: 'live-api',
  /** Parsed from the repository at request time. */
  SOURCE_FILE: 'source-file',
  /** Read from process.env or process.version — set by the platform, not by us. */
  ENV: 'env',
  /**
   * A hand-maintained list. ALLOWED, but it is a record rather than a check:
   * it can go stale if someone fixes a thing and forgets to edit the list.
   * It can show a false RED. It cannot show a false green, which is why it is
   * permitted at all.
   */
  STATIC_LIST: 'static-list',
  /** FORBIDDEN. Wiped by every restart; cannot tell broken from just-started. */
  IN_MEMORY: 'in-memory',
};

/** The one kind no line may use. */
export const FORBIDDEN = [KIND.IN_MEMORY];

/**
 * Every line, and where it looks.
 *
 * `prefix: true` means the key is built at runtime (`usage-spaces`,
 * `written-<column>`, `open-<item>`) and this entry covers the family.
 */
export const LINE_SOURCES = {
  // ── TODAY ────────────────────────────────────────────────────────────────
  backup: {
    kind: KIND.BUCKET,
    why: 'Lists backups/ in BOTH buckets and reports the age of the newest archive in each. '
      + 'Was in-memory until 2026-08-20 and reported "not checked" after every deploy.',
  },
  restore: { kind: KIND.DATABASE, why: 'The backup_verifications table.' },
  balance: { kind: KIND.LIVE_API, why: 'A live call to kie.ai for the account balance.' },
  stuck: { kind: KIND.DATABASE, why: 'pending_video_charges, counted now.' },
  failures: { kind: KIND.DATABASE, why: 'credits_history over the last hour.' },
  sweep: { kind: KIND.DATABASE, why: 'pricing_settings.catalog_synced_at.' },
  smoke: {
    kind: KIND.LIVE_API,
    why: 'Actually exercises the running system — reads the database, writes and rolls back, '
      + 'resolves pricing, reaches storage.',
  },
  versioning: { kind: KIND.BUCKET, why: 'Reads the bucket’s versioning setting on every load.' },
  'media-backup': {
    kind: KIND.BUCKET,
    why: 'Counts objects in both buckets. Deliberately not a flag anybody can tick — it goes '
      + 'quiet only when the files are genuinely there.',
  },
  'usage-': { prefix: true, kind: KIND.BUCKET, why: 'Lists each bucket and measures it.' },
  'written-': { prefix: true, kind: KIND.DATABASE, why: 'Counts nulls over a rolling window.' },

  // ── INTEGRITY ────────────────────────────────────────────────────────────
  'dead-paths': { kind: KIND.SOURCE_FILE, why: 'Parses the client and server sources.' },
  'null-columns': { kind: KIND.DATABASE, why: 'pg_stats, then an exact count to confirm.' },
  'uncalled-routes': { kind: KIND.SOURCE_FILE, why: 'Parses registered routes against requested paths.' },
  'unused-tables': { kind: KIND.DATABASE, why: 'information_schema, cross-checked against the sources.' },

  // ── POSTURE ──────────────────────────────────────────────────────────────
  'admin-gate': { kind: KIND.SOURCE_FILE, why: 'Parses every admin route for its gate.' },
  runtime: { kind: KIND.ENV, why: 'process.version against the Node end-of-life dates.' },
  'security-config': { kind: KIND.ENV, why: 'Reads the settings that must be present.' },
  'open-': {
    prefix: true, kind: KIND.STATIC_LIST,
    why: 'The known-open audit items. A RECORD, not a check — it can go stale and show a false '
      + 'red if something is fixed and nobody edits the list. It cannot show a false green.',
  },
};

/** Find the declaration for a key, honouring prefix families. */
export function sourceFor(key) {
  if (LINE_SOURCES[key]) return LINE_SOURCES[key];
  for (const [k, v] of Object.entries(LINE_SOURCES)) {
    if (v.prefix && key.startsWith(k)) return v;
  }
  return null;
}

/** Keys with no declaration, and keys declaring a forbidden source. */
export function auditKeys(keys = []) {
  const undeclared = [];
  const forbidden = [];
  for (const key of keys) {
    const s = sourceFor(key);
    if (!s) { undeclared.push(key); continue; }
    if (FORBIDDEN.includes(s.kind)) forbidden.push(`${key} (${s.kind})`);
  }
  return { undeclared, forbidden };
}
