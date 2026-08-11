// ─── notifications-routes.js ─────────────────────────────────────────────────
// Two audiences, one module:
//   • /api/admin/notifications/*  — the CRM: compose, automations, history
//   • /api/notifications/*        — the signed-in CUSTOMER: their own bell
//
// The split matters. Admin routes go through `adminGate` (cookie-only session
// + CSRF, per N3). Customer routes go through `verifyJwt` + `requireNotBanned`
// and may ONLY ever touch rows belonging to req.user.id — a notification list
// is per-person, and a missing ownership check here would let any signed-in
// customer read another's messages by guessing an id.
//
// Reuses, never duplicates: the Offers audience engine (offers-segments.js),
// the existing admin gate, and pricing_audit_log for the trail.

import {
  TYPES, MANUAL_TYPES, AUTOMATIONS, isSystemType,
  renderTemplate, unresolvedVariables, applyFrequencyCap,
  validateCompose, isSafeCtaUrl, DEFAULT_DAILY_MARKETING_CAP,
} from './notifications-engine.js';
import { previewSegment, buildSegmentQuery, UnknownFilterError } from './offers-segments.js';
import {
  sendEmail, mailConfigured, missingMailConfig, sendingDomain,
  isOwnDomainAddress, escapeHtml, MAIL_KINDS,
} from './mailer.js';

/** Email has no sender behind it. Single integration point, and it refuses. */
export class NotConfiguredError extends Error {
  constructor(message = 'Email notifications are on hold — no mail server is configured.') {
    super(message);
    this.name = 'NotConfiguredError';
    this.status = 503;
  }
}

/**
 * Send one notification by email. Replaces the deliberate refusal that stood
 * here while the mail server was on hold.
 *
 * THREE GATES, all of which must pass. Any one of them failing means the bell
 * notification is still written — only the email is skipped, and the reason is
 * returned rather than swallowed.
 *
 *   1. the email channel is switched ON (default OFF)
 *   2. Resend is actually configured
 *   3. the recipient has NOT unsubscribed — marketing only; a password reset
 *      is not something you can opt out of
 */
export async function sendNotificationEmail({
  to, title, body, ctaText, ctaUrl, kind = 'announce', settings = {}, suppressed = false,
} = {}) {
  if (!settings.email_enabled) return { sent: false, reason: 'email channel is off' };
  // CONSENT BEFORE CONFIGURATION. Someone who unsubscribed is skipped whether
  // or not the mail server is set up — their choice is a property of them, not
  // of our infrastructure, and we should never reach the mailer on their behalf.
  const spec = MAIL_KINDS[kind] || MAIL_KINDS.announce;
  if (spec.marketing && suppressed) return { sent: false, reason: 'unsubscribed' };
  if (!mailConfigured()) throw new NotConfiguredError();
  return sendEmail({
    to,
    subject: title,
    title,
    // The bell stores plain text; email needs paragraphs, and the text is
    // admin-authored so it must be escaped rather than trusted as markup.
    body: String(body || '').split(/\n{2,}/)
      .map((para) => `<p style="margin:0 0 14px">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
      .join(''),
    ctaText, ctaUrl, kind,
  }, { settings });
}

/** A path like /pricing is dead in an email; make it absolute. */
function absoluteUrl(path) {
  const p = String(path || '');
  if (/^https?:\/\//i.test(p)) return p;
  const base = String(process.env.PUBLIC_BASE_URL || 'https://voxel-ai.ai').replace(/\/+$/, '');
  return base + (p.startsWith('/') ? p : '/' + p);
}

export function registerNotificationsRoutes(app, { pool, dbReady, adminGate, userGate }) {
  const who = (req) => req.user?.email || 'admin';
  const guard = (res) => {
    if (!dbReady()) { res.status(503).json({ error: 'Database not configured.' }); return true; }
    return false;
  };

  async function settings() {
    const { rows } = await pool.query('SELECT * FROM notification_settings WHERE id = 1');
    const s = rows[0] || {};
    return {
      daily_marketing_cap: s.daily_marketing_cap ?? DEFAULT_DAILY_MARKETING_CAP,
      bell_enabled: s.bell_enabled ?? false,
      email_enabled: s.email_enabled ?? false,
      from_system: s.from_system || null,
      from_announce: s.from_announce || null,
      from_billing: s.from_billing || null,
      from_support: s.from_support || null,
      from_legal: s.from_legal || null,
    };
  }

  /** Seed the ten rules once, then never overwrite the owner's edits. */
  async function ensureAutomations() {
    for (const a of AUTOMATIONS) {
      await pool.query(
        `INSERT INTO notification_automations
           (key, name, icon, type, trigger_label, n, template, is_system, needs_checkout, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (key) DO NOTHING`,
        [a.key, a.name, a.icon, a.type, a.trigger, a.n, a.template,
         a.system, a.needs_checkout,
         // A rule nothing can fire ships OFF. Enabling it would put a switch in
         // the CRM that reports "on" while never sending anything.
         a.needs_checkout ? false : true]
      );
    }
  }

  async function audit(field, oldV, newV, changedBy, note, id = null) {
    await pool.query(
      `INSERT INTO pricing_audit_log (entity, entity_id, field, old_value, new_value, changed_by, note)
       VALUES ('notification', $1, $2, $3, $4, $5, $6)`,
      [id, field, oldV == null ? null : String(oldV).slice(0, 80),
       newV == null ? null : String(newV).slice(0, 80), changedBy,
       note ? String(note).slice(0, 200) : null]
    ).catch(() => {});
  }

  // ═══ ADMIN ════════════════════════════════════════════════════════

  app.get('/api/admin/notifications', adminGate, async (req, res) => {
    if (guard(res)) return;
    try {
      await ensureAutomations();
      const [autos, history, offers] = await Promise.all([
        pool.query('SELECT * FROM notification_automations ORDER BY needs_checkout, key'),
        pool.query(`
          SELECT c.*,
                 (SELECT COUNT(*)::int FROM notifications n WHERE n.campaign_id = c.id) AS delivered_now,
                 (SELECT COUNT(*)::int FROM notifications n WHERE n.campaign_id = c.id AND n.read_at IS NOT NULL) AS read_count,
                 (SELECT COUNT(*)::int FROM notifications n WHERE n.campaign_id = c.id AND n.clicked_at IS NOT NULL) AS click_count
            FROM notification_campaigns c
           ORDER BY c.created_at DESC LIMIT 100`),
        pool.query(`SELECT o.id, o.name, o.type, o.value, c.code
                      FROM offers o LEFT JOIN offer_codes c ON c.offer_id = o.id
                     WHERE o.status IN ('active','scheduled') ORDER BY o.created_at DESC`).catch(() => ({ rows: [] })),
      ]);
      res.json({
        automations: autos.rows,
        history: history.rows,
        offers: offers.rows,
        settings: await settings(),
        types: TYPES,
        mail: {
          configured: mailConfigured(),
          missing: missingMailConfig(),
          domain: sendingDomain(),
        },
      });
    } catch (e) {
      console.error('[notifications/list]', e);
      res.status(500).json({ error: 'Could not load notifications.' });
    }
  });

  /** Live audience count for the compose screen — same builder as Offers. */
  app.post('/api/admin/notifications/audience', adminGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const mode = req.body?.audience_mode;
      if (mode === 'picked') {
        const ids = (req.body?.picked_client_ids || []).map(Number).filter(Number.isInteger);
        return res.json({ count: ids.length, sample: [] });
      }
      if (mode === 'segment') {
        return res.json(await previewSegment(pool, req.body?.filters || {}));
      }
      // 'all' — the same exclusions the segment builder applies, so the count
      // the admin approves is the set that actually receives it.
      const { where, params } = buildSegmentQuery({});
      const { rows } = await pool.query(`SELECT COUNT(*)::int n FROM users u WHERE ${where}`, params);
      res.json({ count: rows[0].n, sample: [] });
    } catch (e) {
      if (e instanceof UnknownFilterError) return res.status(400).json({ error: e.message });
      console.error('[notifications/audience]', e);
      res.status(500).json({ error: 'Could not size that audience.' });
    }
  });

  /** Render the draft against a real user, so the preview is not a guess. */
  app.post('/api/admin/notifications/preview', adminGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const { rows } = await pool.query(
        `SELECT id, email, display_name, package, credits FROM users
          WHERE banned = FALSE ORDER BY last_login_at DESC NULLS LAST LIMIT 1`);
      const sample = rows[0] || {};
      res.json({
        title: renderTemplate(req.body?.title, sample),
        body: renderTemplate(req.body?.body, sample),
        sample_user: sample.email || null,
        unresolved: [...new Set([
          ...unresolvedVariables(req.body?.title),
          ...unresolvedVariables(req.body?.body),
        ])],
      });
    } catch (e) {
      console.error('[notifications/preview]', e);
      res.status(500).json({ error: 'Could not build the preview.' });
    }
  });

  /** Compose and send. Writes one row per recipient, rendered per person. */
  app.post('/api/admin/notifications/send', adminGate, async (req, res) => {
    if (guard(res)) return;
    const b = req.body || {};
    const type = MANUAL_TYPES.includes(b.type) ? b.type : null;
    try {
      // Audience first — validation needs its size.
      let recipients;
      if (b.audience_mode === 'picked') {
        const ids = (b.picked_client_ids || []).map(Number).filter(Number.isInteger);
        recipients = ids.length
          ? (await pool.query(
              `SELECT id, email, display_name, package, credits FROM users
                WHERE id = ANY($1) AND banned = FALSE`, [ids])).rows
          : [];
      } else {
        const filters = b.audience_mode === 'segment' ? (b.filters || {}) : {};
        const { where, params } = buildSegmentQuery(filters);
        recipients = (await pool.query(
          `SELECT u.id, u.email, u.display_name, u.package, u.credits
             FROM users u WHERE ${where}`, params)).rows;
      }

      const errs = validateCompose({ ...b, type }, { audienceCount: recipients.length });
      if (!isSafeCtaUrl(b.cta_url)) errs.push('the button link must be a path on this site, like /pricing');
      if (errs.length) return res.status(400).json({ error: errs.join(' · '), errors: errs });

      const settingsRow = await settings();
      const { daily_marketing_cap } = settingsRow;
      // One query for the whole audience rather than one per recipient.
      const suppressedSet = new Set(
        (await pool.query(
          `SELECT email FROM email_suppressions WHERE email = ANY($1)`,
          [recipients.map((r) => String(r.email).toLowerCase())]
        ).catch(() => ({ rows: [] }))).rows.map((r) => r.email)
      );
      let emailed = 0, emailSkipped = 0;
      // How many MARKETING notifications each recipient already got today.
      const capRows = recipients.length
        ? (await pool.query(
            `SELECT user_id, COUNT(*)::int n FROM notifications
              WHERE user_id = ANY($1) AND created_at >= date_trunc('day', NOW())
                AND type = ANY($2)
              GROUP BY user_id`,
            [recipients.map((r) => r.id), MANUAL_TYPES])).rows
        : [];
      const sentToday = Object.fromEntries(capRows.map((r) => [r.user_id, r.n]));
      const { send, skipped } = applyFrequencyCap(type, recipients, sentToday, daily_marketing_cap);

      const campaign = (await pool.query(
        `INSERT INTO notification_campaigns
           (type, title, body, cta_text, cta_url, offer_id, spotlight, audience_mode,
            segment_json, scheduled_for, expires_at, status, delivered, skipped_cap, created_by, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sent',$12,$13,$14,NOW())
         RETURNING *`,
        [type, String(b.title).slice(0, 160), String(b.body), b.cta_text || null, b.cta_url || null,
         b.offer_id || null, !!b.spotlight, b.audience_mode || 'all',
         b.audience_mode === 'segment' ? JSON.stringify(b.filters || {}) : null,
         b.scheduled_for || null, b.expires_at || null, send.length, skipped.length, who(req)]
      )).rows[0];

      // Rendered PER RECIPIENT: {name}/{plan}/{credits} differ per person, so a
      // single shared string would greet everyone by the first person's name.
      for (const u of send) {
        await pool.query(
          `INSERT INTO notifications
             (campaign_id, user_id, type, title, body, cta_text, cta_url, code, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [campaign.id, u.id, type,
           renderTemplate(b.title, u).slice(0, 160),
           renderTemplate(b.body, u),
           b.cta_text || null, b.cta_url || null, b.code || null, b.expires_at || null]
        ).catch((e) => console.error('[notifications] delivery failed for user', u.id, e.message));

        // The bell row is written FIRST and always. Email is an extra channel:
        // if it is off, unconfigured, or the person unsubscribed, they still
        // get the notification in the app — they just do not get a copy by
        // mail. A failed send must never cost someone the notification itself.
        if (settingsRow.email_enabled && b.send_email) {
          const out = await sendNotificationEmail({
            to: u.email,
            title: renderTemplate(b.title, u),
            body: renderTemplate(b.body, u),
            ctaText: b.cta_text || null,
            ctaUrl: b.cta_url ? absoluteUrl(b.cta_url) : null,
            kind: type === 'promo' ? 'promo' : 'announce',
            settings: settingsRow,
            suppressed: suppressedSet.has(String(u.email).toLowerCase()),
          }).catch((e) => ({ sent: false, reason: e.message }));
          if (out.sent) emailed++; else emailSkipped++;
        }
      }

      await audit('sent', null, campaign.title, who(req),
        `${send.length} delivered, ${skipped.length} held by the daily cap`, campaign.id);

      res.json({
        campaign,
        delivered: send.length,
        skipped_cap: skipped.length,
        emailed,
        email_skipped: emailSkipped,
      });
    } catch (e) {
      if (e instanceof UnknownFilterError) return res.status(400).json({ error: e.message });
      console.error('[notifications/send]', e);
      res.status(500).json({ error: 'Could not send the notification.' });
    }
  });

  /** Toggle or retune an automation. */
  app.patch('/api/admin/notifications/automations/:key', adminGate, async (req, res) => {
    if (guard(res)) return;
    const key = String(req.params.key);
    try {
      const cur = (await pool.query('SELECT * FROM notification_automations WHERE key = $1', [key])).rows[0];
      if (!cur) return res.status(404).json({ error: 'No such automation.' });

      // A rule with no trigger in this codebase must not be switchable to "on".
      // The switch would report armed while nothing could ever fire it.
      if (cur.needs_checkout && req.body?.enabled === true) {
        return res.status(409).json({
          error: 'This rule needs a checkout before it can run — there are no renewals or charges to trigger it yet.',
        });
      }

      const enabled = req.body?.enabled === undefined ? cur.enabled : !!req.body.enabled;
      const n = req.body?.n === undefined ? cur.n
        : (req.body.n === null || req.body.n === '' ? null : Math.max(0, parseInt(req.body.n, 10) || 0));
      const template = req.body?.template === undefined ? cur.template : String(req.body.template).slice(0, 2000);

      const { rows } = await pool.query(
        `UPDATE notification_automations
            SET enabled = $2, n = $3, template = $4, updated_by = $5, updated_at = NOW()
          WHERE key = $1 RETURNING *`,
        [key, enabled, n, template, who(req)]
      );
      if (cur.enabled !== enabled) await audit(`automation:${key}`, cur.enabled, enabled, who(req), cur.name);
      res.json({ automation: rows[0] });
    } catch (e) {
      console.error('[notifications/automation]', e);
      res.status(500).json({ error: 'Could not update that automation.' });
    }
  });

  /** Daily cap + the customer bell's master switch. */
  app.patch('/api/admin/notifications/settings', adminGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const cur = await settings();
      const cap = req.body?.daily_marketing_cap === undefined
        ? cur.daily_marketing_cap
        : Math.max(0, parseInt(req.body.daily_marketing_cap, 10) || 0);
      const bell = req.body?.bell_enabled === undefined ? cur.bell_enabled : !!req.body.bell_enabled;
      const emailOn = req.body?.email_enabled === undefined ? cur.email_enabled : !!req.body.email_enabled;

      // Sender addresses. An address off our verified domain is REFUSED rather
      // than saved: Resend cannot sign for it, and its rejection would look
      // exactly like a delivered campaign.
      const senders = {};
      for (const key of ['from_system', 'from_announce', 'from_billing', 'from_support', 'from_legal']) {
        if (req.body?.[key] === undefined) { senders[key] = cur[key] ?? null; continue; }
        const value = String(req.body[key] || '').trim();
        if (!value) { senders[key] = null; continue; }
        if (!isOwnDomainAddress(value)) {
          return res.status(400).json({
            error: `${value} is not on your sending domain — mail from it would be rejected.`,
          });
        }
        senders[key] = value;
      }
      // Turning the channel ON with nothing configured would look like it
      // worked while every message failed.
      if (emailOn && !mailConfigured()) {
        return res.status(400).json({
          error: 'Email is not configured yet — set RESEND_API_KEY and MAIL_FROM first.',
        });
      }
      await pool.query(
        `UPDATE notification_settings
            SET daily_marketing_cap = $1, bell_enabled = $2, email_enabled = $3,
                from_system = $4, from_announce = $5, from_billing = $6,
                from_support = $7, from_legal = $8, updated_at = NOW()
          WHERE id = 1`,
        [cap, bell, emailOn, senders.from_system, senders.from_announce,
         senders.from_billing, senders.from_support, senders.from_legal]);
      if (cur.bell_enabled !== bell) await audit('bell_enabled', cur.bell_enabled, bell, who(req), null);
      if (cur.email_enabled !== emailOn) await audit('email_enabled', cur.email_enabled, emailOn, who(req), null);
      if (cur.daily_marketing_cap !== cap) await audit('daily_marketing_cap', cur.daily_marketing_cap, cap, who(req), null);
      res.json({ settings: await settings() });
    } catch (e) {
      console.error('[notifications/settings]', e);
      res.status(500).json({ error: 'Could not update the settings.' });
    }
  });

  /**
   * Send one real email to the ADMIN, to prove the whole chain works before
   * any customer is involved. Deliberately cannot target anyone else.
   */
  app.post('/api/admin/notifications/test-email', adminGate, async (req, res) => {
    if (guard(res)) return;
    if (!mailConfigured()) {
      return res.status(400).json({
        error: `Email is not configured — missing ${missingMailConfig().join(' and ')}.`,
      });
    }
    const to = String(process.env.ADMIN_EMAIL || 'info@voxel-ai.ai').trim();
    try {
      const s = await settings();
      const kind = MAIL_KINDS[req.body?.kind] ? req.body.kind : 'system';
      const out = await sendEmail({
        to,
        subject: 'Voxel test email',
        title: 'Email is working',
        body: '<p style="margin:0 0 14px">If you are reading this, Voxel can send email.</p>'
            + `<p style="margin:0">Sent from the <b>${escapeHtml(kind)}</b> address. `
            + 'Nothing was sent to any customer.</p>',
        kind,
      }, { settings: s });
      await audit('test_email', null, out.sent ? 'sent' : 'failed', who(req), out.reason || null);
      if (!out.sent) return res.status(502).json({ error: out.reason || 'Send failed.' });
      res.json({ ok: true, to: out.to, from: out.from, test_mode: out.testMode });
    } catch (e) {
      console.error('[notifications/test-email]', e);
      res.status(500).json({ error: e.message || 'Could not send the test email.' });
    }
  });

  // ═══ CUSTOMER ═════════════════════════════════════════════════════
  // Every query below is scoped to req.user.id. There is no route that takes a
  // user id from the client — that is the whole ownership model.

  app.get('/api/notifications', userGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const { bell_enabled } = await settings();
      // The bell ships dark on production until the owner has seen it working.
      // Returning an empty list (rather than 404) keeps the client simple.
      if (!bell_enabled) return res.json({ enabled: false, notifications: [], unread: 0 });

      const { rows } = await pool.query(
        `SELECT id, type, title, body, cta_text, cta_url, code, pinned, read_at, clicked_at, created_at
           FROM notifications
          WHERE user_id = $1
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY pinned DESC, created_at DESC
          LIMIT 50`, [req.user.id]);
      const unread = rows.filter((r) => !r.read_at).length;
      res.json({ enabled: true, notifications: rows, unread });
    } catch (e) {
      console.error('[notifications/mine]', e);
      res.status(500).json({ error: 'Could not load your notifications.' });
    }
  });

  app.post('/api/notifications/read', userGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
      if (ids && ids.length) {
        // AND user_id = $2 is the ownership check. Without it, any signed-in
        // customer could mark — and by extension probe — another's rows.
        await pool.query(
          `UPDATE notifications SET read_at = NOW()
            WHERE id = ANY($1) AND user_id = $2 AND read_at IS NULL`, [ids, req.user.id]);
      } else {
        await pool.query(
          `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[notifications/read]', e);
      res.status(500).json({ error: 'Could not update your notifications.' });
    }
  });

  app.post('/api/notifications/:id/click', userGate, async (req, res) => {
    if (guard(res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    try {
      const { rows } = await pool.query(
        `UPDATE notifications SET clicked_at = COALESCE(clicked_at, NOW()), read_at = COALESCE(read_at, NOW())
          WHERE id = $1 AND user_id = $2 RETURNING cta_url`, [id, req.user.id]);
      if (!rows.length) return res.status(404).json({ error: 'Not found.' });
      res.json({ ok: true, cta_url: rows[0].cta_url });
    } catch (e) {
      console.error('[notifications/click]', e);
      res.status(500).json({ error: 'Could not record that.' });
    }
  });
}

/**
 * Write one notification for one user, from an automation.
 * Fire-and-forget by design: a failed notification must never break the action
 * that triggered it — a customer whose generation succeeded should not see an
 * error because the "it's ready" message could not be written.
 */
export async function notifyUser(pool, userId, { key, type, title, body, ctaText, ctaUrl, code, extra = {} }) {
  try {
    const auto = key
      ? (await pool.query('SELECT * FROM notification_automations WHERE key = $1', [key])).rows[0]
      : null;
    if (auto && (!auto.enabled || auto.needs_checkout)) return { sent: false, reason: 'disabled' };

    const user = (await pool.query(
      `SELECT id, email, display_name, package, credits FROM users WHERE id = $1`, [userId])).rows[0];
    if (!user) return { sent: false, reason: 'no such user' };

    const finalType = type || auto?.type || 'announce';
    if (!isSystemType(finalType)) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int n FROM notifications
          WHERE user_id = $1 AND created_at >= date_trunc('day', NOW()) AND type = ANY($2)`,
        [userId, MANUAL_TYPES]);
      const cap = (await pool.query('SELECT daily_marketing_cap FROM notification_settings WHERE id = 1'))
        .rows[0]?.daily_marketing_cap ?? DEFAULT_DAILY_MARKETING_CAP;
      if (rows[0].n >= cap) return { sent: false, reason: 'daily cap' };
    }

    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, cta_text, cta_url, code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, finalType,
       renderTemplate(title || auto?.name || '', user, extra).slice(0, 160),
       renderTemplate(body || auto?.template || '', user, extra),
       ctaText || null, ctaUrl || null, code || null]);
    return { sent: true };
  } catch (e) {
    console.error('[notifications] notifyUser failed:', e.message);
    return { sent: false, reason: e.message };
  }
}
