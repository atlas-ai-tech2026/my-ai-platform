// ─── backup-verify-routes.js ─────────────────────────────────────────────────
// Runs the restore verification, records the result, and exposes it.
//
// The schedule is monthly, matching RESTORE.md's drill — except nobody has to
// remember it. It also runs shortly after boot the FIRST time only, so a fresh
// deploy answers "can we restore?" within minutes instead of within a month.
//
// EVERY RESULT IS RECORDED, pass or fail. A check that only writes rows when
// something is wrong cannot tell "all clear" apart from "stopped running" —
// and that distinction is the entire reason the alert exists.

import {
  parseArchive, verifyParsed, collectRows, verifyLoadable, fetchLatestOffsite,
  CRITICAL_TABLES,
} from './backup-verify.js';
import { offsiteConfigured, encryptionConfigured } from './backup-offsite.js';

export async function ensureVerifyTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_verifications (
      id           BIGSERIAL PRIMARY KEY,
      checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      ok           BOOLEAN     NOT NULL,
      archive_key  TEXT,
      archive_size BIGINT,
      exported_at  TIMESTAMPTZ,
      rows_total   INTEGER,
      tables_seen  INTEGER,
      load_tested  BOOLEAN     NOT NULL DEFAULT FALSE,
      problems     JSONB       NOT NULL DEFAULT '[]'::jsonb,
      detail       JSONB       NOT NULL DEFAULT '{}'::jsonb,
      duration_ms  INTEGER
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS backup_verifications_checked_idx
       ON backup_verifications (checked_at DESC)`);
}

/** The newest result, for the alert fact and the panel. */
export async function latestVerification(pool) {
  const { rows } = await pool.query(
    `SELECT checked_at, ok, archive_key, exported_at, rows_total, tables_seen,
            load_tested, problems, detail, duration_ms
       FROM backup_verifications ORDER BY checked_at DESC LIMIT 1`);
  return rows[0] || null;
}

/**
 * Do the whole thing: fetch the offsite archive, prove it decrypts, parse it,
 * check it against its own manifest, optionally load rows into a throwaway
 * schema, and record the outcome.
 *
 * Never throws. A verification that crashes must still be RECORDED as a
 * failure — an exception that escapes to the scheduler would leave no row, and
 * "no row" is the one state that must not be ambiguous.
 */
export async function runRestoreVerification(pool, {
  env = process.env,
  loadTest = true,
  fetcher = fetchLatestOffsite,
} = {}) {
  const started = Date.now();
  const record = async (ok, problems, extra = {}) => {
    try {
      await ensureVerifyTable(pool);
      await pool.query(
        `INSERT INTO backup_verifications
           (ok, archive_key, archive_size, exported_at, rows_total, tables_seen,
            load_tested, problems, detail, duration_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
        [ok, extra.key || null, extra.size || null, extra.exportedAt || null,
         extra.rowsTotal ?? null, extra.tables ?? null, !!extra.loadTested,
         JSON.stringify(problems), JSON.stringify(extra.detail || {}),
         Date.now() - started]);
    } catch (e) {
      console.error('[restore-verify] could not record the result:', e.message);
    }
    const tag = ok ? '✅ restorable' : '❌ NOT RESTORABLE';
    console.log(`[restore-verify] ${tag}${problems.length ? ' — ' + problems.join(' · ') : ''}`);
    return { ok, problems, ...extra };
  };

  // Misconfiguration is a real finding, not a reason to skip quietly. If the
  // passphrase is unset then nothing that has been written is decryptable.
  if (!encryptionConfigured(env)) {
    return record(false, ['BACKUP_ENCRYPTION_PASSPHRASE is not set — nothing written can be decrypted']);
  }
  if (!offsiteConfigured(env)) {
    return record(false, ['the offsite bucket is not configured — there is only one copy']);
  }

  let archive;
  try {
    archive = await fetcher(env);
  } catch (e) {
    return record(false, [`could not fetch the offsite archive: ${e.message}`]);
  }

  let parsed;
  try {
    parsed = parseArchive(archive.body, env.BACKUP_ENCRYPTION_PASSPHRASE);
  } catch (e) {
    // The headline failure: the archive exists and cannot be read.
    return record(false, [`the archive could not be decrypted or decompressed: ${e.message}`],
      { key: archive.key, size: archive.size });
  }

  const v = verifyParsed(parsed);
  const problems = [...v.problems];
  const detail = { counts: v.counts, mismatches: v.mismatches, warnings: v.warnings };

  // The load test needs real rows, and only runs if the archive is otherwise
  // sound — loading rows out of an archive already known to be broken would
  // add noise, not information.
  let loadTested = false;
  if (loadTest && v.ok) {
    try {
      parsed.rowsByTable = collectRows(archive.body, env.BACKUP_ENCRYPTION_PASSPHRASE,
        { tables: CRITICAL_TABLES, limit: 500 });
      const load = await verifyLoadable(pool, parsed, { tables: CRITICAL_TABLES });
      loadTested = true;
      detail.load = load.results;
      if (!load.ok) problems.push(...load.problems);
    } catch (e) {
      problems.push(`the load test could not run: ${e.message}`);
    }
  }

  return record(problems.length === 0, problems, {
    key: archive.key, size: archive.size, exportedAt: v.exportedAt,
    rowsTotal: v.rowsTotal, tables: v.tables, loadTested, detail,
  });
}

export function registerBackupVerifyRoutes(app, pool, requireAdmin) {
  // Read the last result.
  app.get('/api/admin/backup/verification', requireAdmin, async (req, res) => {
    try {
      await ensureVerifyTable(pool);
      const latest = await latestVerification(pool);
      const { rows: history } = await pool.query(
        `SELECT checked_at, ok, archive_key, rows_total, load_tested, duration_ms
           FROM backup_verifications ORDER BY checked_at DESC LIMIT 12`);
      res.json({ latest, history });
    } catch (e) {
      console.error('[restore-verify] read failed:', e.message);
      res.status(500).json({ error: 'Could not read the verification history.' });
    }
  });

  // Run it now. Deliberately available on demand: the answer to "are we safe?"
  // should never be "wait a month and find out".
  app.post('/api/admin/backup/verify', requireAdmin, async (req, res) => {
    try {
      const result = await runRestoreVerification(pool, { loadTest: req.body?.load_test !== false });
      res.json(result);
    } catch (e) {
      console.error('[restore-verify] manual run failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
}

/** Run when the newest recorded verification is older than this. */
export const DUE_AFTER_DAYS = 30;
/** How often to ASK whether one is due. Nothing runs unless it is due. */
export const TICK_MS = 60 * 60 * 1000;

/**
 * Ask hourly whether a verification is due; run one only if it is.
 *
 * ⚠️ NOT `setInterval(run, 30 days)`. That was the first version and it was a
 * real, deployed bug: 30 days is 2,592,000,000 ms, which does not fit in a
 * 32-bit signed integer, so **Node silently coerces the delay to 1 ms**. The
 * "monthly" check ran 294 times in five seconds against the offsite bucket
 * before I saw it in the logs. Anything longer than ~24.8 days must never be
 * handed to setTimeout/setInterval.
 *
 * Driving it from the LAST RECORDED RESULT rather than from a timer is also
 * simply correct, for a reason that has nothing to do with the overflow: this
 * app restarts on every deploy, and a timer set for a month away on a process
 * that lives for days would have fired approximately never. The database
 * remembers across restarts; a timer does not.
 */
export function scheduleRestoreVerification(pool, dbReady, {
  tickMs = TICK_MS, dueAfterDays = DUE_AFTER_DAYS, firstDelayMs = 10 * 60 * 1000,
} = {}) {
  // One run at a time. Without this, a verification slower than the tick would
  // stack up — the same shape of failure as the overflow, arrived at politely.
  let inFlight = false;

  const tick = async () => {
    if (!dbReady() || inFlight) return;
    inFlight = true;
    try {
      await ensureVerifyTable(pool);
      const latest = await latestVerification(pool);
      const ageDays = latest
        ? (Date.now() - new Date(latest.checked_at).getTime()) / 864e5
        : Infinity;
      if (ageDays < dueAfterDays) return;

      console.log(latest
        ? `[restore-verify] last check was ${Math.floor(ageDays)} days ago — running one now`
        : '[restore-verify] no verification has ever been recorded — running one now');
      await runRestoreVerification(pool);
    } catch (e) {
      console.error('[restore-verify] scheduled pass failed:', e.message);
    } finally {
      inFlight = false;
    }
  };

  setTimeout(tick, firstDelayMs).unref?.();
  setInterval(tick, tickMs).unref?.();
}
