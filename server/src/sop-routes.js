// ─── sop-routes.js ───────────────────────────────────────────────────────────
// Serves the daily operations picture, and runs the expensive checks on demand.
//
// TWO KINDS OF CHECK, and conflating them is how you get a bill:
//
//   CHEAP  — reading the database and in-memory status. Milliseconds. Computed
//            fresh on EVERY request, so the screen is never stale and needs no
//            schedule at all.
//   COSTLY — the restore verification DOWNLOADS A 5.3 MB ARCHIVE from
//            Backblaze. On 2026-08-17 a timer bug of mine ran it 294 times in
//            five seconds and exhausted the provider's daily cap. A "Check
//            now" button with no guard is that same bug with a human finger on
//            it, so it carries a COOLDOWN: pressing again inside the window
//            returns the last result and says plainly that it did.

import { gatherFacts } from './alerts-routes.js';
import { withDefaults } from './alerts-engine.js';
import { buildToday, summarise, STATE } from './sop-engine.js';
import { latestVerification, runRestoreVerification, ensureVerifyTable } from './backup-verify-routes.js';

/** Minutes before the restore verification may be re-run by hand. */
export const RESTORE_COOLDOWN_MIN = 60;

export function cooldownRemaining(lastIso, now = Date.now(), minutes = RESTORE_COOLDOWN_MIN) {
  if (!lastIso) return 0;
  const elapsedMin = (now - new Date(lastIso).getTime()) / 60000;
  if (!Number.isFinite(elapsedMin) || elapsedMin < 0) return 0;
  return Math.max(0, Math.ceil(minutes - elapsedMin));
}

export function registerSopRoutes(app, {
  pool, dbReady, adminGate, getKieCredits, getAutoBackupStatus,
}) {
  /** Everything the screen needs, always computed fresh. */
  async function collect() {
    const facts = await gatherFacts(pool, { getKieCredits });
    facts.autoBackup = getAutoBackupStatus ? getAutoBackupStatus() : null;

    // gatherFacts substitutes a healthy stub when the table is missing, which
    // is right for the ALERT (do not alarm about an un-migrated database) and
    // wrong here: this screen must say "not checked" rather than invent OK.
    try {
      await ensureVerifyTable(pool);
      facts.backupVerify = await latestVerification(pool);
    } catch {
      facts.backupVerify = undefined;      // renders as UNKNOWN, never as OK
    }

    const { rows } = await pool.query(`SELECT * FROM alert_settings WHERE id = 1`).catch(() => ({ rows: [] }));
    const settings = withDefaults(rows[0] || {});
    const lines = buildToday(facts, settings);
    return { lines, summary: summarise(lines) };
  }

  app.get('/api/admin/sop', adminGate, async (req, res) => {
    if (!dbReady()) {
      return res.status(503).json({ error: 'The database is not reachable, so nothing can be checked.' });
    }
    try {
      const { lines, summary } = await collect();
      const latest = await latestVerification(pool).catch(() => null);
      res.json({
        generated_at: new Date().toISOString(),
        zones: { today: lines },
        summary,
        // So the button can show "available in 42 min" instead of failing.
        restore_cooldown_min: cooldownRemaining(latest?.checked_at),
      });
    } catch (e) {
      console.error('[sop] read failed:', e.message);
      res.status(500).json({ error: 'Could not build the operations picture.' });
    }
  });

  /**
   * Re-run the checks now.
   *
   * The cheap ones are recomputed by simply asking again — they were never
   * cached. Only the restore verification is genuinely re-run, and only if the
   * cooldown allows, because it costs real bandwidth.
   */
  app.post('/api/admin/sop/check-now', adminGate, async (req, res) => {
    if (!dbReady()) {
      return res.status(503).json({ error: 'The database is not reachable, so nothing can be checked.' });
    }
    const wantRestore = req.body?.restore !== false;
    let restore = { ran: false, reason: 'not requested' };

    if (wantRestore) {
      try {
        await ensureVerifyTable(pool);
        const latest = await latestVerification(pool);
        const wait = cooldownRemaining(latest?.checked_at);
        if (wait > 0) {
          restore = { ran: false, reason: `cooling down — available in ${wait} min`, cooldown_min: wait };
        } else {
          const r = await runRestoreVerification(pool);
          restore = { ran: true, ok: r.ok, problems: r.problems || [] };
        }
      } catch (e) {
        console.error('[sop] restore check failed:', e.message);
        restore = { ran: false, reason: `could not run: ${e.message}` };
      }
    }

    try {
      const { lines, summary } = await collect();
      const latest = await latestVerification(pool).catch(() => null);
      res.json({
        generated_at: new Date().toISOString(),
        zones: { today: lines },
        summary,
        restore,
        restore_cooldown_min: cooldownRemaining(latest?.checked_at),
      });
    } catch (e) {
      console.error('[sop] rebuild after check failed:', e.message);
      res.status(500).json({ error: 'The checks ran, but the screen could not be rebuilt.' });
    }
  });
}

export { STATE };
