// ─── alerts-routes.js ────────────────────────────────────────────────────────
// Gathering the facts, persisting the verdicts, and the admin API behind them.
// The deciding lives in alerts-engine.js; this file is the plumbing.
//
// One rule runs through the whole file: a check that cannot run must SAY it
// could not run. Returning "no alerts" because the provider was unreachable is
// the exact failure this feature exists to end — the kie sweep once reported
// success while discarding all 98 models, and a balance check ran hourly for
// weeks into a log nobody opened.

import {
  evaluateAll, withDefaults, shouldEmail, subjectFor, bySeverity, SEVERITY,
} from './alerts-engine.js';
import { sendEmail, mailConfigured } from './mailer.js';
import { ourMediaHosts } from './media-health.js';
import { READ_SQL as SYNC_READ_SQL, SYNC_FLAG, syncStaleAlert } from './sync-heartbeat.js';

const SETTINGS_COLS = [
  'kie_balance_min', 'stuck_charge_hours', 'failure_rate_pct',
  'failure_min_attempts', 'catalogue_stale_hours', 'email_enabled', 'email_to',
];

export async function loadSettings(pool) {
  const { rows } = await pool.query(
    `SELECT ${SETTINGS_COLS.join(', ')}, last_check_at FROM alert_settings WHERE id = 1`);
  return { ...withDefaults(rows[0]), last_check_at: rows[0]?.last_check_at || null };
}

/**
 * Everything the checks need, read in one pass.
 *
 * `getKieCredits` is injected so a provider outage is visible as its own alert
 * rather than as an absence of alerts.
 */
export async function gatherFacts(pool, { getKieCredits, now = new Date() } = {}) {
  const facts = { now: now.toISOString(), recent: [], models: [], pending: 0,
    oldestHours: null, credits: null, burnPerDay: null, lastSweepIso: null, providerError: null,
    // Left as null, NOT zero. The SOP line reads null as "could not tell" and
    // shows UNKNOWN; a zero would show a green light meaning "I did not look".
    mediaAtRiskToday: null, mediaAtRiskTotal: null, mediaDurable: null };

  // Failures in the last hour — the only way fal's empty account is ever seen,
  // since fal publishes no balance endpoint.
  const recent = await pool.query(
    `SELECT reason FROM credits_history
      WHERE action = 'refund' AND created_at > NOW() - INTERVAL '1 hour'`);
  facts.recent = recent.rows;

  // How many of the last hour's generations came back as refunds.
  //
  // Deliberately NOT per model: a refund row records why the provider refused
  // but never which model was asked, so any per-model rate today would be
  // invented. Tier 1.3 records model + outcome together; until then this is
  // the number that is actually true.
  const rate = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE action = 'spend')::int  AS spends,
            COUNT(*) FILTER (WHERE action = 'refund')::int AS failures
       FROM credits_history WHERE created_at > NOW() - INTERVAL '1 hour'`);
  facts.spends = rate.rows[0]?.spends || 0;
  facts.failures = rate.rows[0]?.failures || 0;
  facts.models = [];

  const stuck = await pool.query(
    `SELECT COUNT(*)::int AS pending,
            EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/3600 AS oldest_hours
       FROM pending_video_charges WHERE status = 'pending'`);
  facts.pending = stuck.rows[0]?.pending || 0;
  facts.oldestHours = stuck.rows[0]?.oldest_hours != null ? Number(stuck.rows[0].oldest_hours) : null;

  const sweep = await pool.query(`SELECT catalog_synced_at FROM pricing_settings WHERE id = 1`);
  facts.lastSweepIso = sweep.rows[0]?.catalog_synced_at
    ? new Date(sweep.rows[0].catalog_synced_at).toISOString() : null;

  // ── ARE NEW FILES REACHING OUR BUCKET? ──────────────────────────────────
  // Every generation is meant to be copied into Spaces, because provider
  // links expire. persistOrFallback keeps the provider link when that copy
  // fails — silently, so the customer still gets their file. That silence is
  // why this is counted: a file stranded TODAY means copying is broken today.
  //
  // The 24h window is the STATE; the total is context only. A line reporting
  // a known 12,567 every morning is one nobody reads by the third day.
  try {
    const hosts = ourMediaHosts({
      endpoint: process.env.SPACES_ENDPOINT,
      bucket: process.env.SPACES_BUCKET,
      cdnBase: process.env.SPACES_CDN_BASE,
    });
    if (hosts.length) {
      const media = await pool.query(`
        SELECT
          count(*) FILTER (
            WHERE COALESCE(data->>'result_url','') <> ''
              AND split_part(split_part(data->>'result_url','://',2),'/',1) <> ALL($1::text[])
              AND created_date > NOW() - INTERVAL '24 hours'
          )::int AS at_risk_today,
          count(*) FILTER (
            WHERE COALESCE(data->>'result_url','') <> ''
              AND split_part(split_part(data->>'result_url','://',2),'/',1) <> ALL($1::text[])
          )::int AS at_risk_total,
          count(*) FILTER (
            WHERE split_part(split_part(data->>'result_url','://',2),'/',1) = ANY($1::text[])
          )::int AS durable
        FROM entities WHERE name = 'GenerationHistory'`, [hosts]);
      facts.mediaAtRiskToday = media.rows[0]?.at_risk_today ?? null;
      facts.mediaAtRiskTotal = media.rows[0]?.at_risk_total ?? null;
      facts.mediaDurable = media.rows[0]?.durable ?? null;
    }
  } catch (e) {
    // Left null on purpose — the line shows UNKNOWN rather than a green zero.
    console.error('[sop] media durability count failed:', e.message);
  }

  // Burn rate, for turning "4,180 left" into "runs out Saturday" — the form
  // that actually prompts a top-up.
  const burn = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric / 7 AS per_day
       FROM credits_history
      WHERE action = 'spend' AND created_at > NOW() - INTERVAL '7 days'`);
  facts.burnPerDay = Number(burn.rows[0]?.per_day) || null;

  // The last restore verification. Left UNDEFINED rather than null if the
  // table does not exist yet, so a database that has not migrated is not
  // reported as "never verified" — that would be alarming about the wrong
  // thing on the first boot after this ships.
  try {
    const v = await pool.query(
      `SELECT checked_at, ok, problems FROM backup_verifications
        ORDER BY checked_at DESC LIMIT 1`);
    facts.backupVerify = v.rows[0]
      ? { checked_at: v.rows[0].checked_at, ok: v.rows[0].ok, problems: v.rows[0].problems }
      : null;
  } catch {
    facts.backupVerify = { checked_at: new Date().toISOString(), ok: true, problems: [] };
  }

  if (typeof getKieCredits === 'function') {
    try {
      facts.credits = await getKieCredits();
    } catch (e) {
      // Unreadable is NOT zero, and it is NOT fine. Left null so the balance
      // check abstains, and surfaced separately so the silence is explained.
      facts.credits = null;
      facts.providerError = e.message;
    }
  }
  return facts;
}

/** Write the verdicts, keeping one open row per condition. */
export async function persist(pool, alerts, { now = new Date() } = {}) {
  const seen = new Set();
  const opened = [];
  for (const a of alerts) {
    seen.add(a.key);
    const { rows } = await pool.query(
      `INSERT INTO alerts (key, kind, severity, title, detail, value, last_seen)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) WHERE status <> 'resolved'
       DO UPDATE SET severity = EXCLUDED.severity, title = EXCLUDED.title,
                     detail = EXCLUDED.detail, value = EXCLUDED.value,
                     last_seen = EXCLUDED.last_seen,
                     seen_count = alerts.seen_count + 1
       RETURNING id, key, severity, title, detail, notified_at,
                 (xmax = 0) AS is_new`,
      [a.key, a.kind, a.severity, a.title, a.detail, a.value, now]);
    if (rows[0]) opened.push(rows[0]);
  }
  // Anything previously open that no longer fires has fixed itself. Kept, not
  // deleted — "it resolved on its own" is information, and a condition that
  // keeps returning is a pattern worth being able to see.
  //
  // Two things this statement got wrong the first time, both invisible to the
  // unit tests and both immediate on real Postgres:
  //   · the "nothing firing" branch still referenced $2 while binding one
  //     parameter, so a HEALTHY system threw on every pass — the failure mode
  //     you would notice last;
  //   · `key = ANY($1::text[])` with a JS array has no inferable type. The cast is
  //     required, not decorative.
  // Kept as ONE statement with a constant parameter list so the two branches
  // cannot drift apart again.
  const resolved = await pool.query(
    `UPDATE alerts SET status = 'resolved', resolved_at = $2
      WHERE status <> 'resolved'
        AND NOT (key = ANY($1::text[]))
      RETURNING key`,
    [[...seen], now]);
  return { opened, resolved: resolved.rows.map((r) => r.key) };
}

/** Email, once per condition, then only daily and only while critical. */
export async function notify(pool, opened, settings, { send = sendEmail, now = new Date(), env = process.env } = {}) {
  if (!settings.email_enabled || !mailConfigured(env)) return { sent: 0, skipped: opened.length };
  const to = (settings.email_to || '').trim() || (env.MAIL_FROM || '').trim();
  if (!to) return { sent: 0, skipped: opened.length };

  const due = opened.filter((a) => shouldEmail(a, { notifiedAt: a.notified_at, now, enabled: true }));
  if (!due.length) return { sent: 0, skipped: opened.length };

  const body = due.sort(bySeverity)
    .map((a) => `<p><b>${a.severity.toUpperCase()} — ${a.title}</b><br>${a.detail || ''}</p>`)
    .join('');
  try {
    await send({
      to, subject: subjectFor(due), kind: 'system',
      title: due.length > 1 ? `${due.length} alerts need your attention` : 'An alert needs your attention',
      body,
      ctaText: 'Open the control panel',
      ctaUrl: `${(env.PUBLIC_BASE_URL || 'https://voxel-ai.ai').replace(/\/+$/, '')}/x7k9-control-panel-mh2024`,
      footerNote: 'You are receiving this because alert emails are switched on in the control panel.',
    }, { env });
    // ::bigint[] for the same reason as the resolve statement — an untyped JS
    // array gives Postgres nothing to infer from. This one would only have
    // thrown on the path that matters most: when an alert actually emails.
    await pool.query(
      `UPDATE alerts SET notified_at = $2 WHERE id = ANY($1::bigint[])`,
      [due.map((a) => a.id), now]);
    return { sent: due.length, skipped: opened.length - due.length };
  } catch (e) {
    // A mailer failure must never take the check down — the alert is already
    // recorded and visible on screen, which is the more important half.
    console.error('[alerts] email failed:', e.message);
    return { sent: 0, skipped: opened.length, error: e.message };
  }
}

/** One full pass. Safe to call on a timer and from the button. */
export async function runAlertChecks(pool, dbReady, { getKieCredits, send, now = new Date(), env = process.env } = {}) {
  if (!dbReady()) return { skipped: 'no database' };
  const settings = await loadSettings(pool);
  const facts = await gatherFacts(pool, { getKieCredits, now });
  const alerts = evaluateAll(facts, settings);

  // The provider being unreachable is itself worth saying, precisely because
  // it makes the balance check abstain.
  if (facts.providerError) {
    alerts.push({
      key: 'kie_unreachable', kind: 'kie_unreachable', severity: SEVERITY.WARNING,
      title: 'Cannot read the kie.ai balance',
      detail: `${facts.providerError} — the balance check is not running, so a low balance would NOT be caught right now.`,
      value: null,
    });
  }

  // ── HAS THE OFFSITE BACKUP STOPPED? (2026-08-28) ────────────────────────
  // On the night this was added, the media sync copied nothing for two and a
  // half hours while THIS pass logged "0 open · 0 resolved · 0 emailed" every
  // five minutes. There were alerts for the restore check going stale, for the
  // provider balance, for stuck charges — and none for the backup itself
  // having stopped, which is the one that mattered.
  //
  // Deliberately outside evaluateAll: it reads a row rather than the gathered
  // facts, and a failure to read it must not take the whole alerts pass down —
  // that would trade one blind spot for a larger one.
  try {
    const { rows } = await pool.query(SYNC_READ_SQL, [SYNC_FLAG]);
    const stale = syncStaleAlert(rows[0]?.value || null, now);
    if (stale) alerts.push(stale);
  } catch (e) {
    console.error('[alerts] could not read the backup heartbeat:', e.message);
  }

  const { opened, resolved } = await persist(pool, alerts, { now });
  const mail = await notify(pool, opened, settings, { send, now, env });
  await pool.query(`UPDATE alert_settings SET last_check_at = $1 WHERE id = 1`, [now]);
  console.log(`[alerts] ${alerts.length} open · ${resolved.length} resolved · ${mail.sent} emailed`);
  return { open: alerts.length, resolved: resolved.length, emailed: mail.sent, checked_at: now.toISOString() };
}

export function registerAlertsRoutes(app, { pool, dbReady, adminGate, getKieCredits }) {
  app.get('/api/admin/alerts', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const [open, recent, settings] = await Promise.all([
        pool.query(`SELECT * FROM alerts WHERE status <> 'resolved' ORDER BY last_seen DESC`),
        // Seven days of resolved history: "it fixed itself" is information.
        pool.query(`SELECT * FROM alerts WHERE status = 'resolved'
                     AND resolved_at > NOW() - INTERVAL '7 days'
                    ORDER BY resolved_at DESC LIMIT 50`),
        loadSettings(pool),
      ]);
      res.json({
        open: open.rows.sort(bySeverity),
        resolved: recent.rows,
        settings,
        last_check_at: settings.last_check_at,
      });
    } catch (err) {
      console.error('[alerts] list failed:', err);
      res.status(500).json({ error: 'Could not load alerts.' });
    }
  });

  app.post('/api/admin/alerts/check', adminGate, async (req, res) => {
    try {
      res.json(await runAlertChecks(pool, dbReady, { getKieCredits }));
    } catch (err) {
      console.error('[alerts] manual check failed:', err);
      res.status(500).json({ error: err.message || 'Check failed.' });
    }
  });

  // Acknowledged, not resolved: the condition is still true and the row still
  // shows. It only stops emailing. Marking a live problem "done" from a screen
  // is how it gets forgotten.
  app.post('/api/admin/alerts/:id/ack', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const { rows } = await pool.query(
        `UPDATE alerts SET status = 'acknowledged', notified_at = NOW()
          WHERE id = $1 AND status <> 'resolved' RETURNING id`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'No such open alert.' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[alerts] ack failed:', err);
      res.status(500).json({ error: 'Could not acknowledge.' });
    }
  });

  app.put('/api/admin/alerts/settings', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const body = req.body || {};
    const sets = [], vals = [];
    for (const col of SETTINGS_COLS) {
      if (!Object.prototype.hasOwnProperty.call(body, col)) continue;
      let v = body[col];
      if (col === 'email_enabled') v = !!v;
      else if (col === 'email_to') v = String(v || '').trim() || null;
      else {
        v = Number(v);
        if (!Number.isFinite(v) || v < 0) {
          return res.status(400).json({ error: `${col} must be a number of 0 or more.` });
        }
      }
      vals.push(v); sets.push(`${col} = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    try {
      await pool.query(`UPDATE alert_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE id = 1`, vals);
      res.json(await loadSettings(pool));
    } catch (err) {
      console.error('[alerts] settings failed:', err);
      res.status(500).json({ error: 'Could not save settings.' });
    }
  });
}
