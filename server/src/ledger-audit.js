// ─── ledger-audit.js ─────────────────────────────────────────────────────────
// Were the files copied while the backup was BLIND actually there?
//
// ── THE WINDOW ─────────────────────────────────────────────────────────────
// From 2026-08-20, when the socket leak was introduced along with the
// verification itself, until 2026-08-31 07:39 UTC when it was fixed, the sync
// recorded a file as backed up because its upload did not throw. Nothing was
// ever read back. Every row written in that window carries `verified = TRUE`
// by default, and that default is the only reason it says so.
//
// The copies are very probably fine — Backblaze's own console showed 201.3 GB
// of media arriving throughout, and the writer's client was demonstrably
// healthy the whole time. "Very probably" is not the standard for a backup.
//
// ── WHY A SAMPLE AND NOT ALL OF THEM ───────────────────────────────────────
// There are on the order of 17,000 rows. Reading every one back is about an
// hour of requests to answer a question a sample answers in under a minute:
// if 200 randomly chosen files from that window all read back at the right
// size, widespread loss is not what happened. If ANY fail, that is not a
// sample any more — it is a finding, and the full sweep becomes worth its
// hour.
//
// So: press once, get an answer. Escalate only on evidence.
//
// ── AND IT WRITES NOTHING ──────────────────────────────────────────────────
// Deliberately read-only. A row that fails its check is REPORTED, not deleted
// and not flipped to unverified — because "delete the row so it re-copies"
// is a repair, and a repair should be a separate decision made by a person
// looking at the evidence, not a side effect of looking.

/** When the verification was blind. Both ends are real, dated events. */
export const BLIND_FROM = '2026-08-20T00:00:00Z';
export const BLIND_UNTIL = '2026-08-31T07:39:00Z';

/** Enough to be conclusive about widespread loss, small enough to be one press. */
export const DEFAULT_SAMPLE = 200;

/**
 * A random sample of rows written while nothing was being read back.
 *
 * TABLESAMPLE is deliberately NOT used: it samples PAGES, so on a table
 * clustered by insertion time it would pick a few contiguous runs and miss the
 * rest of the window entirely — which is the one thing a sample here must not
 * do. ORDER BY random() is slower and correct.
 */
export const SAMPLE_SQL = `
  SELECT object_key, bytes
    FROM offsite_media
   WHERE copied_at >= $1 AND copied_at < $2
   ORDER BY random()
   LIMIT $3`;

export const COUNT_SQL = `
  SELECT COUNT(*)::int AS total
    FROM offsite_media
   WHERE copied_at >= $1 AND copied_at < $2`;

/**
 * Read each sampled file back and compare its size.
 *
 * @param deps.rows   [{object_key, bytes}]
 * @param deps.read   (key) => Promise<{contentLength}>   throws if unreadable
 */
export async function auditSample({ rows = [], read, log = console } = {}) {
  const bad = [];
  let ok = 0;

  for (const r of rows) {
    const key = r?.object_key;
    if (!key) continue;
    try {
      const got = await read(key);
      const found = Number(got?.contentLength);
      // A row with no recorded size cannot be size-checked. It still proves
      // the object EXISTS, which is most of the question — counted as ok and
      // said out loud rather than quietly treated as a pass.
      const expected = Number(r.bytes);
      if (!Number.isFinite(found)) {
        bad.push({ key, expected, found: null, why: 'read back but reported no size' });
      } else if (Number.isFinite(expected) && expected > 0 && found !== expected) {
        bad.push({ key, expected, found, why: 'size does not match' });
      } else {
        ok += 1;
      }
    } catch (e) {
      bad.push({ key, expected: Number(r.bytes), found: null, why: e?.message || String(e) });
    }
  }

  const checked = ok + bad.length;
  if (bad.length) {
    log.error?.(`[ledger-audit] ${bad.length} of ${checked} sampled files did NOT read back: `
      + bad.slice(0, 3).map((b) => `${b.key} (${b.why})`).join(' · '));
  } else {
    log.log?.(`[ledger-audit] ${ok} of ${checked} sampled files read back correctly`);
  }
  return { checked, ok, bad };
}

/**
 * Turn the numbers into a sentence somebody can act on.
 *
 * ── ZERO CHECKED IS NOT A PASS ─────────────────────────────────────────────
 * The trap this project keeps hitting: `0 of 0 failed` is arithmetically true
 * and means nothing was looked at. It must never read as reassurance.
 */
export function verdict({ checked = 0, ok = 0, bad = [], total = null } = {}) {
  if (!checked) {
    return {
      tone: 'unknown',
      headline: 'Nothing was checked.',
      detail: total === 0
        ? 'There are no ledger rows from the period when the backup was blind — nothing to check.'
        : 'No rows came back to sample. This is not a pass: it means the check could not run.',
    };
  }
  if (bad.length) {
    return {
      tone: 'bad',
      headline: `${bad.length} of ${checked} sampled files are NOT what the ledger claims.`,
      detail: 'This is a finding, not a sample. Every file recorded while the backup was blind '
        + 'now needs reading back, not just a sample of them. '
        + bad.slice(0, 5).map((b) => `${b.key}: ${b.why}`).join(' · '),
    };
  }
  const scope = total ? ` out of ${total.toLocaleString()} recorded in that period` : '';
  return {
    tone: 'ok',
    headline: `All ${ok} sampled files read back correctly.`,
    detail: `A random sample of ${ok}${scope}, every one present at the recorded size. `
      + 'Widespread loss during the blind period is ruled out. This is a sample, so it '
      + 'cannot prove every single file — but it is the difference between believing and checking.',
  };
}
