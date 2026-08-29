// ─── offsite-ledger.js ───────────────────────────────────────────────────────
// Remember what we have copied offsite, so the backup stops depending on
// listing a remote bucket.
//
// ── THE PROBLEM THIS REMOVES ───────────────────────────────────────────────
// Every fifteen minutes the sync LISTS THE ENTIRE OFFSITE BUCKET over the
// internet to work out what is missing. That single operation has been
// unreliable since 20 August, and when it fails the backup stops completely —
// on 29 August, for seventeen hours, while customers generated all day.
//
// Three fixes have been tried on three nights, each assuming a different cause,
// and the failure keeps returning. So rather than a fourth attempt at making
// the listing reliable: STOP NEEDING IT.
//
// We are the ones doing the copying. We know what we copied. That belongs in
// our own database, which is up when we are up.
//
// ── THE ONE WAY A LEDGER LIKE THIS DESTROYS A BACKUP ───────────────────────
// By recording a copy that did not happen. The key is then skipped FOREVER,
// the file is never backed up, and every screen says the backup is complete.
// A wrong "yes" here is silent and permanent — far worse than the listing
// failure it replaces, which at least announces itself.
//
// So: nothing is recorded until the write has been VERIFIED, the recording is
// a separate step after that verification, and a failure to record leaves the
// key looking uncopied — which costs one duplicate upload and loses nothing.
// Given the choice between copying twice and not copying at all, this always
// chooses twice.
//
// ── AND THE LISTING IS NOT DELETED, IT IS DEMOTED ──────────────────────────
// When a listing DOES succeed it is used to reconcile: anything found offsite
// that we never recorded gets recorded. That seeds the ledger from the 17,000
// objects already there — so this ships without re-uploading 72 GB — and it
// self-heals if a record is ever lost. But nothing waits for it.

export const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS offsite_media (
    object_key TEXT PRIMARY KEY,
    bytes      BIGINT,
    copied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified   BOOLEAN     NOT NULL DEFAULT TRUE
  );
`;

/** Recorded only after a verified write. ON CONFLICT so a re-copy is harmless. */
export const RECORD_SQL = `
  INSERT INTO offsite_media (object_key, bytes)
  VALUES ($1, $2)
  ON CONFLICT (object_key) DO UPDATE SET bytes = EXCLUDED.bytes, copied_at = NOW()`;

/** Bulk seed from a real listing. Same statement, many rows. */
export const SEED_SQL = `
  INSERT INTO offsite_media (object_key, bytes)
  SELECT * FROM UNNEST($1::text[], $2::bigint[])
  ON CONFLICT (object_key) DO NOTHING`;

/** Which of these source keys have we NOT copied? */
export const MISSING_SQL = `
  SELECT k FROM UNNEST($1::text[]) AS k
   WHERE NOT EXISTS (SELECT 1 FROM offsite_media o WHERE o.object_key = k)`;

export const COUNT_SQL = `SELECT count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS bytes FROM offsite_media`;

/**
 * What still needs copying, WITHOUT asking the remote bucket.
 *
 * @param sourceKeys  every media key in our own bucket (that listing works —
 *                    it is our own storage, in the same region, and has never
 *                    been the failing one)
 * @param known       (keys) => keys[]  which of these the ledger already has
 */
export async function planFromLedger(sourceKeys, { known, limit = 400 } = {}) {
  const keys = (sourceKeys || []).filter((k) => typeof k === 'string' && k);
  if (!keys.length) return { considered: 0, missing: [], truncated: false };

  const missing = await known(keys);
  return {
    considered: keys.length,
    // Capped per run so one pass cannot take an hour. The rest come next time.
    missing: missing.slice(0, limit),
    // Reported, never silent — a truncated plan that says nothing reads as
    // "everything is copied", which is the lie this whole module exists to
    // avoid.
    truncated: missing.length > limit,
    remaining: Math.max(0, missing.length - limit),
  };
}

/**
 * Copy what is missing, recording ONLY what is verified.
 *
 * @param deps.copy    (key) => {bytes}   throws on failure
 * @param deps.verify  (key) => bytes|null   read back; null = could not tell
 * @param deps.record  (key, bytes) => void
 */
export async function copyAndRecord(keys, deps) {
  const report = { attempted: 0, copied: 0, recorded: 0, failed: 0, bytes: 0, problems: [] };

  for (const key of keys || []) {
    report.attempted += 1;
    try {
      const out = await deps.copy(key);
      report.copied += 1;

      // VERIFY BEFORE RECORDING. A write that returned success and stored
      // nothing would otherwise be remembered as done, and the file would
      // never be copied again by anything.
      const size = await deps.verify(key);
      if (size === null || size === undefined) {
        report.problems.push({ key, why: 'copied but could not be verified — not recorded' });
        continue;
      }
      if (out?.bytes && size !== out.bytes) {
        report.problems.push({ key, why: `stored ${size} bytes, sent ${out.bytes} — not recorded` });
        continue;
      }

      await deps.record(key, size);
      report.recorded += 1;
      report.bytes += size;
    } catch (e) {
      report.failed += 1;
      report.problems.push({ key, why: e?.message || String(e) });
    }
  }
  return report;
}

/**
 * How complete is the backup, answered from OUR OWN records.
 *
 * This is what the SOP line can use when the remote bucket cannot be listed.
 * It is a weaker claim than counting the far side, and it says so: this is
 * "we copied and verified N files", not "N files are there right now".
 */
export function describeCoverage({ sourceCount, ledgerCount, listingWorked = false }) {
  // ── Number(null) IS 0, AND 0 IS FINITE ──
  // Third time this trap has been hit in one day — "0 days left" on a picture
  // with no date, "last day" on a recovery screen, and here, where an
  // unreadable count would have rendered as "no customer media yet" and put a
  // green tick on a BACKUP screen that had read nothing at all.
  //
  // Missing is not zero. Checked explicitly, before Number() gets a chance.
  const missingInput = (v) => v === null || v === undefined || v === '';
  if (missingInput(sourceCount) || missingInput(ledgerCount)) {
    return { state: 'unknown', detail: 'the numbers could not be read' };
  }
  const src = Number(sourceCount);
  const led = Number(ledgerCount);
  if (!Number.isFinite(src) || !Number.isFinite(led)) {
    return { state: 'unknown', detail: 'the numbers could not be read' };
  }
  const missing = Math.max(0, src - led);
  const basis = listingWorked
    ? 'counted in the offsite bucket'
    : 'from our own record of verified copies — the offsite bucket could not be listed';

  if (!src) return { state: 'ok', detail: 'no customer media yet', missing: 0 };
  if (!led) {
    return {
      state: 'critical', missing: src,
      detail: `${src.toLocaleString()} files exist in ONE place — none recorded as copied offsite (${basis})`,
    };
  }
  if (missing > 0) {
    return {
      state: 'warn', missing,
      detail: `${led.toLocaleString()} of ${src.toLocaleString()} copied offsite — `
        + `${missing.toLocaleString()} not yet protected (${basis})`,
    };
  }
  return {
    state: 'ok', missing: 0,
    detail: `${led.toLocaleString()} of ${src.toLocaleString()} copied offsite (${basis})`,
  };
}
