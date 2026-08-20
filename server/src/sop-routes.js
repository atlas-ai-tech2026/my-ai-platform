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
import { buildToday, summarise, line, STATE } from './sop-engine.js';
import { latestVerification, runRestoreVerification, ensureVerifyTable } from './backup-verify-routes.js';
import { runSmokeChecks, summariseSmoke } from './sop-smoke.js';
import { runIntegrityChecks } from './sop-integrity.js';
import { runWrittenChecks } from './sop-written.js';
import { measureUsage as spacesUsage, versioningStatus, listKeys } from './storage.js';
import { measureOffsiteUsage as offsiteUsage, measureOffsiteMedia as offsiteMedia,
         listOffsite } from './backup-offsite.js';
import { judgeBackups } from './backup-freshness.js';
import { recordUsage, usageHistory, judgeUsage, judgeMediaBackup, ALLOWANCES } from './storage-usage.js';
import { runPostureChecks } from './sop-posture.js';
import {
  readSchedule, writeSchedule, markRan, isDue, ensureScheduleTable, JOBS,
} from './sop-schedule.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

    // ── WHEN WAS THE LAST BACKUP, ASKED OF THE BUCKETS ───────────────────
    // Not of a variable in this process. facts.autoBackup is wiped by every
    // restart and the backup runs five minutes after boot, so on an app that
    // deploys several times a day that line spent much of its life saying
    // "not checked" while backups ran perfectly — indistinguishable from "the
    // job is dead". The owner refused to accept it, and was right.
    //
    // BOTH destinations, judged separately: a single green light that hides a
    // dead offsite copy defeats the reason the offsite copy exists.
    try {
      const [primary, offsite] = await Promise.all([
        listKeys('backups/').then((objects) => ({ objects })).catch((e) => ({ error: e.message })),
        listOffsite('backups/').then((objects) => ({ objects })).catch((e) => ({ error: e.message })),
      ]);
      facts.backupFreshness = judgeBackups({ primary, offsite });
    } catch (e) {
      // Left undefined rather than guessed — backupLine falls back and says
      // plainly that it could not look, which is not the same as a failure.
      console.error('[sop] could not read the backup buckets:', e.message);
    }

    const { rows } = await pool.query(`SELECT * FROM alert_settings WHERE id = 1`).catch(() => ({ rows: [] }));
    const settings = withDefaults(rows[0] || {});
    const today = buildToday(facts, settings);

    // SMOKE — actually exercises the running system, unlike the build-time
    // test suite, which proves nothing about this process right now.
    let smoke = [];
    try { smoke = await runSmokeChecks(pool); } catch (e) {
      smoke = [{ name: 'smoke checks', ok: false, detail: e.message, ms: 0 }];
    }
    const smokeState = summariseSmoke(smoke);
    const failing = smoke.filter((r) => r.ok === false);
    const unknown = smoke.filter((r) => r.ok === null);
    today.push(line({
      key: 'smoke', zone: 'today', label: 'System smoke checks', state: smokeState,
      value: `${smoke.filter((r) => r.ok === true).length}/${smoke.length} passing`,
      checkedAt: new Date().toISOString(),
      info: 'Five checks that EXERCISE the running system rather than describe it: read the '
        + 'database, write and roll back, resolve the pricing table, reach storage, and confirm '
        + 'the settings that keep mail and backups working. The test suite runs at build time '
        + 'against mocks and cannot tell you any of this.',
      detail: failing.length ? failing.map((r) => `${r.name}: ${r.detail}`).join(' · ')
        : unknown.length ? unknown.map((r) => `${r.name}: ${r.detail}`).join(' · ')
        : smoke.map((r) => r.name).join(' · '),
      action: failing.length ? 'A core capability of the live server is not working — read the detail above.'
        : unknown.length ? 'Something could not be determined. It is not a failure, and it is not a pass.'
        : '',
    }));

    // ── STORAGE QUOTAS ────────────────────────────────────────────────────
    // Asked for in the plainest possible words on 2026-08-19: "tell me I will
    // start or become to exceed the limit to start, make a subscription".
    // Not "you are over" — "you are ABOUT to be over."
    //
    // That difference is everything. A quota found by exceeding it is an
    // outage: the offsite copy stops and the first symptom is a customer
    // noticing broken history weeks later. A quota found 40 days out is a
    // diary entry. So each line carries a RATE and a DATE, never just a
    // percentage — 83% could be six days away or six months.
    for (const [provider, measure] of [
      ['spaces', () => spacesUsage()],
      ['offsite', () => offsiteUsage()],
    ]) {
      try {
        const measurement = await measure();
        // Recorded even when it looks boring: today's size is only useful
        // because it becomes yesterday's, and a growth rate needs history
        // nobody thought to keep.
        if (!measurement.error) {
          await recordUsage(pool, {
            provider, bucket: measurement.bucket || '?',
            bytes: measurement.bytes, objects: measurement.objects,
          }).catch(() => {});
        }
        const history = await usageHistory(pool, provider).catch(() => []);
        const v = judgeUsage({ provider, measurement, history });
        today.push(line({
          key: `usage-${provider}`, zone: 'today',
          label: `Storage used — ${v.label || provider}`,
          state: v.state === 'critical' ? STATE.CRITICAL
            : v.state === 'warn' ? STATE.WARN
            : v.state === 'unknown' ? STATE.UNKNOWN : STATE.OK,
          value: v.bytes == null ? 'not checked'
            : `${v.pct}% of ${ALLOWANCES[provider]?.limitLabel || 'allowance'}`,
          checkedAt: new Date().toISOString(),
          info: `${ALLOWANCES[provider]?.label} — ${ALLOWANCES[provider]?.included}, then `
            + `${ALLOWANCES[provider]?.overage}. Measured daily so the growth rate is real rather `
            + 'than assumed; the projection needs three daily readings before it will say anything.',
          detail: v.detail,
          action: v.action || '',
        }));
      } catch (e) {
        // A quota that could not be measured is never rendered as healthy.
        today.push(line({
          key: `usage-${provider}`, zone: 'today',
          label: `Storage used — ${provider}`, state: STATE.UNKNOWN,
          value: 'not checked', checkedAt: new Date().toISOString(),
          info: 'Daily storage measurement against the plan allowance.',
          detail: e.message,
          action: 'An unmeasured quota is not a safe one — find out why this could not be read.',
        }));
      }
    }

    // ── CAN A DELETED FILE BE RECOVERED? ─────────────────────────────────
    // Versioning turns a delete into a delete MARKER — the bytes stay. It is
    // enabled at boot, but "we called the API" is not the same as "it is on",
    // and this project has been bitten enough times by that difference. So the
    // screen reads it back from the bucket every time.
    try {
      const v = await versioningStatus();
      const on = v.status === 'Enabled';
      today.push(line({
        key: 'versioning', zone: 'today', label: 'Deleted files recoverable',
        state: v.error ? STATE.UNKNOWN : on ? STATE.OK : STATE.WARN,
        value: v.error ? 'not checked' : on ? 'yes' : 'NO',
        checkedAt: new Date().toISOString(),
        info: 'Object versioning on the media bucket. With it on, deleting a file writes a marker and '
          + 'the file stays recoverable; overwrites keep the previous copy too. It protects against a '
          + 'mistake, NOT against losing the bucket or the account — versions live inside the bucket '
          + 'and die with it, which is why the offsite copy is a separate line.',
        detail: v.error
          ? (v.denied
            ? `the app’s key is not allowed to read bucket configuration on ${v.bucket} — which is `
              + 'expected for a correctly scoped key, and means this cannot be confirmed from here'
            : v.error)
          : on ? `enabled on ${v.bucket} — a deleted file can be brought back`
            : `NOT enabled on ${v.bucket} — a delete is permanent and immediate`,
        action: v.error
          ? 'Confirm it in the DigitalOcean console under the bucket’s Settings instead.'
          : on ? ''
            : 'Run server/scripts/enable-versioning.mjs once with a TEMPORARY full-access key, then delete '
              + 'that key. The app cannot do this itself: DigitalOcean grants bucket configuration only to '
              + 'full-access keys, and giving the app one permanently would undo the scoping done on 19 August.',
      }));
    } catch (e) {
      today.push(line({
        key: 'versioning', zone: 'today', label: 'Deleted files recoverable',
        state: STATE.UNKNOWN, value: 'not checked', checkedAt: new Date().toISOString(),
        info: 'Object versioning on the media bucket.',
        detail: e.message,
        action: 'Unverified protection is not protection — find out why this could not be read.',
      }));
    }

    // ── IS CUSTOMER MEDIA ACTUALLY BACKED UP? ────────────────────────────
    // Counted, never assumed. 66 GiB of customer work has existed in exactly
    // one place for weeks and this screen has never once said so — which is
    // the same failure as every other thing found this week: true, invisible,
    // and therefore not acted on.
    //
    // It clears itself. The moment files are genuinely in the offsite bucket
    // this line goes quiet, and not one moment before — unlike a reminder
    // somebody can tick off while nothing has been copied.
    try {
      const [src, off] = await Promise.all([spacesUsage(), offsiteMedia()]);
      const v = judgeMediaBackup({ source: src, offsite: off });
      today.push(line({
        key: 'media-backup', zone: 'today', label: 'Customer media backed up',
        state: v.state === 'critical' ? STATE.CRITICAL
          : v.state === 'warn' ? STATE.WARN
          : v.state === 'unknown' ? STATE.UNKNOWN : STATE.OK,
        value: v.state === 'ok' ? 'protected' : v.state === 'critical' ? 'NOT protected' : v.state,
        checkedAt: new Date().toISOString(),
        info: 'The daily database backup covers every generation’s metadata and its URL, but NOT the '
          + 'image or video that URL points at. Those live in the Spaces bucket. This counts how many '
          + 'of them have been copied to Backblaze — by listing the objects, not by trusting a setting.',
        detail: v.detail,
        action: v.action || '',
      }));
    } catch (e) {
      today.push(line({
        key: 'media-backup', zone: 'today', label: 'Customer media backed up',
        state: STATE.UNKNOWN, value: 'not checked', checkedAt: new Date().toISOString(),
        info: 'Counts how much customer media has reached the offsite bucket.',
        detail: e.message,
        action: 'An unverified backup is not a backup — find out why this could not be read.',
      }));
    }

    return { lines: today, summary: summarise(today), smoke };
  }

  /** Structure zone — source-vs-database, so only rebuilt on demand. */
  async function collectIntegrity() {
    const r = await runIntegrityChecks(pool, { root: REPO_ROOT });
    const out = [];
    const mk = (key, label, items, info, action) => out.push(line({
      key, zone: 'integrity', label,
      state: items.length ? STATE.WARN : STATE.OK,
      value: String(items.length), checkedAt: r.checked_at, info,
      detail: items.length ? items.slice(0, 6).join(' · ') : 'none found',
      action: items.length ? action : '',
    }));

    mk('dead-paths', 'Screens calling nothing', r.dead_paths,
      'A page asking for an endpoint that does not exist. This is exactly what the /edit waitlist '
      + 'did — it collected emails through a form that posted nowhere, and said thank you.',
      'Each one is a screen promising something the server cannot do.');
    mk('null-columns', 'Columns never written', r.null_columns.map((c) => `${c.column} (${c.rows} rows)`),
      'A column that is empty in EVERY row is a promise nothing keeps. model_label sat this way '
      + 'through 3,046 rows, which is why "which video model is fastest" had no answer.',
      'Either something should be writing this, or the column should go.');
    mk('uncalled-routes', 'Endpoints nothing calls', r.uncalled_routes,
      'A route the server answers that no screen asks for. Often means a feature was built without '
      + 'a face — or an old one left behind.',
      'Give it a screen, or remove it.');
    mk('unused-tables', 'Tables nothing reads', r.unreferenced_tables,
      'A table no server file mentions. Dead data that still grows and still gets backed up.',
      'Confirm it is unused, then drop it.');

    // ── the gap the check above could not see ─────────────────────────────
    // "Columns never written" finds a column empty in EVERY row. The Node
    // canvas bug made generation_events.model_label empty for one SURFACE
    // only — direct generations kept the column well over half full, so that
    // check reported nothing while every canvas generation was missing from
    // the Reliability and Speed screens.
    //
    // A column can be mostly written and still completely broken for one of
    // the ways people use the product. This asks the narrower question: is
    // each column that MATTERS still being written, in the last few days.
    const w = await runWrittenChecks(pool);
    for (const f of w.findings) {
      // 'quiet' means too few rows to judge — not a finding, and not a pass
      // either. Reporting it as OK would be the same lie as a green tick on
      // a check that never ran.
      if (f.state === 'ok' || f.state === 'quiet') continue;
      out.push(line({
        key: `written-${f.column}`, zone: 'integrity',
        label: `Still being written: ${f.column}`,
        state: f.state === 'unknown' ? STATE.UNKNOWN : STATE.WARN,
        value: f.state === 'unknown' ? 'not checked' : 'gaps',
        checkedAt: r.checked_at,
        info: f.why,
        detail: f.detail,
        action: f.action || 'Find out why this could not be measured — an unchecked column is not a healthy one.',
      }));
    }
    // Say the healthy ones were looked at, so a short list reads as "checked
    // and fine" rather than "nobody ran this".
    const clean = w.findings.filter((f) => f.state === 'ok').map((f) => f.column);
    if (clean.length) {
      out.push(line({
        key: 'written-ok', zone: 'integrity', label: 'Columns still being written',
        state: STATE.OK, value: `${clean.length}/${w.summary.checked}`, checkedAt: r.checked_at,
        info: 'Columns that must be populated for the reports to mean anything, measured over the '
          + 'last 7 days rather than all of history — the question is whether they are being '
          + 'written NOW, and old gaps that can never be filled would otherwise sit red forever.',
        detail: clean.join(' · '),
      }));
    }
    return out;
  }

  /**
   * Security posture — what is still OPEN, and what could silently come UNDONE.
   * Deliberately NOT a list of the eighteen completed findings: eighteen
   * permanent green ticks is a plaque, and it would bury the few real items.
   */
  async function collectPosture() {
    const p = runPostureChecks({ root: REPO_ROOT });
    const out = [];

    // The assertion most likely to catch a real regression. Routes get added
    // most weeks; one without the gate is an unauthenticated hole that no
    // lint, type check or existing test would notice.
    out.push(line({
      key: 'admin-gate', zone: 'posture', label: 'Admin routes are all gated',
      state: p.ungated_admin_routes.length ? STATE.CRITICAL : STATE.OK,
      value: p.ungated_admin_routes.length ? String(p.ungated_admin_routes.length) : 'all',
      checkedAt: p.checked_at,
      info: 'Every /api/admin/* endpoint must sit behind adminGate. A new admin route added '
        + 'without it is reachable by anyone, and nothing else in the build would notice — not '
        + 'the tests, not the linter, not the type checks.',
      detail: p.ungated_admin_routes.length ? p.ungated_admin_routes.join(' · ')
        : `${p.scanned_files} server files scanned, every admin route gated`,
      action: p.ungated_admin_routes.length
        ? 'These endpoints are reachable WITHOUT authentication. Add adminGate now.' : '',
    }));

    out.push(line({
      key: 'runtime', zone: 'posture', label: 'Node runtime supported',
      state: { critical: STATE.CRITICAL, warn: STATE.WARN, unknown: STATE.UNKNOWN, ok: STATE.OK }[p.runtime.state],
      value: process.version, checkedAt: p.checked_at,
      info: 'Whether this Node version still receives security patches. A NEWER version existing '
        + 'is noise; a version past END OF LIFE is a deadline. Production ran Node 20 for 110 days '
        + 'after it stopped being patched, and nothing said so.',
      detail: p.runtime.detail,
      action: p.runtime.state === 'ok' ? '' : 'Bump engines.node in package.json and redeploy.',
    }));

    const cfg = p.config;
    out.push(line({
      key: 'security-config', zone: 'posture', label: 'Security settings',
      state: cfg.problems.length ? STATE.CRITICAL : STATE.OK,
      value: cfg.problems.length ? `${cfg.problems.length} problem(s)` : 'set',
      checkedAt: p.checked_at,
      info: 'Settings that must be true for the system to be safe: mail actually sending, the '
        + 'backup passphrase present so archives can be read, the auth secret set, and the origin '
        + 'guard either configured properly or deliberately inert.',
      detail: [...cfg.problems, ...cfg.notes].join(' · '),
      action: cfg.problems.length ? 'Fix these in the DigitalOcean environment variables.' : '',
    }));

    // Open items are WARN, never critical: each is a decision waiting on the
    // owner, not something breaking right now. Critical would cry wolf daily.
    for (const item of p.open_items) {
      out.push(line({
        key: `open-${item.key}`, zone: 'posture', label: item.label,
        state: STATE.WARN, value: 'open', checkedAt: p.checked_at,
        info: item.detail, detail: item.detail, action: item.action,
      }));
    }
    return out;
  }

  app.get('/api/admin/sop', adminGate, async (req, res) => {
    if (!dbReady()) {
      return res.status(503).json({ error: 'The database is not reachable, so nothing can be checked.' });
    }
    try {
      const { lines, summary } = await collect();
      const latest = await latestVerification(pool).catch(() => null);
      let integrity = [];
      try { integrity = await collectIntegrity(); } catch (e) {
        console.error('[sop] integrity zone failed:', e.message);
      }
      let posture = [];
      try { posture = await collectPosture(); } catch (e) {
        console.error('[sop] posture zone failed:', e.message);
      }
      const schedule = await readSchedule(pool).catch(() => []);
      res.json({
        generated_at: new Date().toISOString(),
        zones: { today: lines, integrity, posture },
        summary,
        schedule,
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
      let integrity = [];
      try { integrity = await collectIntegrity(); } catch (e) {
        console.error('[sop] integrity zone failed:', e.message);
      }
      let posture = [];
      try { posture = await collectPosture(); } catch (e) {
        console.error('[sop] posture zone failed:', e.message);
      }
      const schedule = await readSchedule(pool).catch(() => []);
      res.json({
        generated_at: new Date().toISOString(),
        zones: { today: lines, integrity, posture },
        summary,
        schedule,
        restore,
        restore_cooldown_min: cooldownRemaining(latest?.checked_at),
      });
    } catch (e) {
      console.error('[sop] rebuild after check failed:', e.message);
      res.status(500).json({ error: 'The checks ran, but the screen could not be rebuilt.' });
    }
  });

  // ── the schedule the owner controls ──────────────────────────────────────
  app.get('/api/admin/sop/schedule', adminGate, async (req, res) => {
    try { res.json({ schedule: await readSchedule(pool), jobs: JOBS }); }
    catch (e) {
      console.error('[sop] schedule read failed:', e.message);
      res.status(500).json({ error: 'Could not read the schedule.' });
    }
  });

  app.put('/api/admin/sop/schedule', adminGate, async (req, res) => {
    try {
      const r = await writeSchedule(pool, {
        job: req.body?.job,
        enabled: req.body?.enabled,
        every: req.body?.every,
        hourKuwait: req.body?.hour_kuwait,
      });
      if (!r.ok) return res.status(400).json({ error: r.error });
      console.log(`[sop] schedule updated: ${req.body?.job} → every ${req.body?.every} `
        + `at ${req.body?.hour_kuwait}:00 Kuwait, ${req.body?.enabled ? 'enabled' : 'disabled'}`);
      res.json({ ok: true, schedule: await readSchedule(pool) });
    } catch (e) {
      console.error('[sop] schedule write failed:', e.message);
      res.status(500).json({ error: 'Could not save the schedule.' });
    }
  });
}

/**
 * The scheduler.
 *
 * A SHORT TICK asking "is anything due?", NOT a long timer. `setInterval(run,
 * 30 days)` overflows a 32-bit signed integer and Node silently substitutes
 * 1 ms — that ran the restore check 294 times in five seconds and exhausted
 * the provider's daily cap. And this app redeploys many times a day, so a
 * timer set weeks ahead on a process that lives hours would fire never.
 * Due-ness lives in the database, which survives restarts.
 */
export function scheduleSopJobs(pool, dbReady, { tickMs = 15 * 60 * 1000 } = {}) {
  let inFlight = false;

  const tick = async () => {
    if (!dbReady() || inFlight) return;
    inFlight = true;
    try {
      await ensureScheduleTable(pool);
      const rows = await readSchedule(pool);
      for (const row of rows) {
        const v = isDue(row, { lastRunIso: row.last_run_at });
        if (!v.due) continue;
        console.log(`[sop-schedule] ${row.job} is due (${v.reason}) — running`);
        try {
          if (row.job === 'restore') await runRestoreVerification(pool);
          else if (row.job === 'smoke') await runSmokeChecks(pool);
          else if (row.job === 'integrity') await runIntegrityChecks(pool, { root: REPO_ROOT });
          await markRan(pool, row.job);
        } catch (e) {
          // Record the attempt even on failure, or a job that always throws
          // retries every tick forever.
          console.error(`[sop-schedule] ${row.job} failed:`, e.message);
          await markRan(pool, row.job).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[sop-schedule] tick failed:', e.message);
    } finally { inFlight = false; }
  };

  setTimeout(tick, 5 * 60 * 1000).unref?.();
  setInterval(tick, tickMs).unref?.();
}

export { STATE };
