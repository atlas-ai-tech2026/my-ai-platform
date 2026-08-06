// ─── offers-routes.js ────────────────────────────────────────────────────────
// Admin API for the CRM Offers screen. Own module for the same reason costing
// has one: index.js is long past the split threshold in CLAUDE.md and this is
// self-contained.
//
// It reuses, and never duplicates: the Costing engine's settings (margin
// target, credit value), `pricing_settings`, `pricing_plans`, the admin gate,
// and `pricing_audit_log` (entity='offer').
//
// NOTHING here charges a customer or grants credits. Approving an offer writes
// rows in `offers`/`offer_codes` and an audit entry — the redemption path that
// would actually move money does not exist yet, because Voxel has no checkout.

import {
  offerMargin, marginImpact, violatesFloor, validateForApproval,
  marginFloorOf, effectiveStatus, requiresCheckout, OFFER_TYPES,
} from './offers-engine.js';
import { previewSegment, buildSegmentQuery, UnknownFilterError } from './offers-segments.js';

/** Email has no sender. The single integration point, and it refuses loudly. */
export class NotConfiguredError extends Error {
  constructor(message = 'Email campaigns are on hold — no mail server is configured.') {
    super(message);
    this.name = 'NotConfiguredError';
    this.status = 503;
  }
}

// TODO(email-on-hold): the owner will ask for the email phase once his mail
// server is ready and he has supplied the requirements. Until then this is the
// only place email would be wired, and it must stay a refusal — never a silent
// no-op, which would make an offer look delivered when nobody was reached.
export async function sendOfferCampaign() {
  throw new NotConfiguredError();
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

export function registerOffersRoutes(app, { pool, dbReady, adminGate }) {
  // ── shared loaders ────────────────────────────────────────────────
  async function settingsAndPlans() {
    const [s, p] = await Promise.all([
      pool.query('SELECT * FROM pricing_settings ORDER BY id LIMIT 1'),
      pool.query('SELECT id, name, price_usd FROM pricing_plans ORDER BY sort_order'),
    ]);
    const settings = s.rows[0] || {};
    return {
      settings: {
        ...settings,
        margin_target: Number(settings.margin_target),
        margin_floor: marginFloorOf(settings),
      },
      plans: p.rows.map((r) => ({ ...r, price_usd: Number(r.price_usd) })),
    };
  }

  async function loadOffers() {
    const { rows } = await pool.query(`
      SELECT o.*,
             c.code,
             COALESCE(c.uses, 0)                                    AS code_uses,
             (SELECT COUNT(*)::int FROM offer_redemptions r WHERE r.offer_id = o.id) AS uses,
             (SELECT COUNT(*)::int FROM offer_picked_clients pc WHERE pc.offer_id = o.id) AS picked_count
        FROM offers o
        LEFT JOIN offer_codes c ON c.offer_id = o.id
       ORDER BY o.created_at DESC`);
    return rows.map(decorateOffer);
  }

  function decorateOffer(o) {
    return {
      ...o,
      value: Number(o.value),
      effective_status: effectiveStatus(o),
      // The two price types have nothing to discount until a checkout exists.
      // Surfacing this per row is what stops an approved offer from LOOKING
      // live when no customer could ever use it.
      requires_checkout: requiresCheckout(o.type),
    };
  }

  async function auditOffer(id, field, oldV, newV, who, note) {
    await pool.query(
      `INSERT INTO pricing_audit_log (entity, entity_id, field, old_value, new_value, changed_by, note)
       VALUES ('offer', $1, $2, $3, $4, $5, $6)`,
      [id, field, oldV == null ? null : String(oldV).slice(0, 80),
       newV == null ? null : String(newV).slice(0, 80), who, note ? String(note).slice(0, 200) : null]
    ).catch(() => {});
  }

  const who = (req) => req.user?.email || 'admin';
  const guard = (res) => {
    if (!dbReady()) { res.status(503).json({ error: 'Database not configured.' }); return true; }
    return false;
  };

  // ── list ──────────────────────────────────────────────────────────
  app.get('/api/offers', adminGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const [offers, sp] = await Promise.all([loadOffers(), settingsAndPlans()]);
      res.json({ offers, plans: sp.plans, settings: sp.settings });
    } catch (e) {
      console.error('[offers/list]', e);
      res.status(500).json({ error: 'Could not load offers.' });
    }
  });

  // ── margin impact (live, while the owner types) ───────────────────
  app.post('/api/offers/margin-impact', adminGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const { type, value, plan_ids } = req.body || {};
      const { settings, plans } = await settingsAndPlans();
      const selected = Array.isArray(plan_ids) && plan_ids.length
        ? plans.filter((p) => plan_ids.includes(p.id))
        : plans;
      const impact = marginImpact({ type, value, plans: selected, settings });
      res.json({
        impact,
        margin_target: settings.margin_target,
        margin_floor: settings.margin_floor,
        cost_share: 1 - settings.margin_target,
        violates_floor: violatesFloor(impact),
        requires_checkout: requiresCheckout(type),
      });
    } catch (e) {
      console.error('[offers/margin-impact]', e);
      res.status(500).json({ error: 'Could not compute margin impact.' });
    }
  });

  // ── segment preview ───────────────────────────────────────────────
  app.post('/api/offers/segment/preview', adminGate, async (req, res) => {
    if (guard(res)) return;
    try {
      const { count, sample } = await previewSegment(pool, req.body?.filters || {});
      res.json({ count, sample });
    } catch (e) {
      if (e instanceof UnknownFilterError) return res.status(400).json({ error: e.message });
      console.error('[offers/segment/preview]', e);
      res.status(500).json({ error: 'Could not preview that segment.' });
    }
  });

  // ── create / edit ─────────────────────────────────────────────────
  function readBody(b = {}) {
    return {
      name: String(b.name || '').trim().slice(0, 80),
      type: OFFER_TYPES.includes(b.type) ? b.type : null,
      value: Number(b.value),
      plan_ids: Array.isArray(b.plan_ids) ? b.plan_ids.map(Number).filter(Number.isInteger) : [],
      audience_mode: ['all', 'segment', 'picked'].includes(b.audience_mode) ? b.audience_mode : 'all',
      segment_json: b.segment_json && typeof b.segment_json === 'object' ? b.segment_json : null,
      renewal_rule: ['first', 'months', 'forever'].includes(b.renewal_rule) ? b.renewal_rule : 'first',
      renewal_months: b.renewal_months == null ? null : Math.max(1, parseInt(b.renewal_months, 10) || 1),
      delivery_code: !!b.delivery_code,
      delivery_auto: !!b.delivery_auto,
      delivery_email: !!b.delivery_email,
      starts_at: b.starts_at || null,
      ends_at: b.ends_at || null,
      max_per_client: Math.max(1, parseInt(b.max_per_client, 10) || 1),
      max_total: b.max_total == null || b.max_total === '' ? null : Math.max(1, parseInt(b.max_total, 10)),
      picked_client_ids: Array.isArray(b.picked_client_ids)
        ? b.picked_client_ids.map(Number).filter(Number.isInteger) : [],
      code: String(b.code || '').trim().toUpperCase().slice(0, 30),
    };
  }

  async function writePickedAndCode(offerId, body) {
    if (body.audience_mode === 'picked') {
      await pool.query('DELETE FROM offer_picked_clients WHERE offer_id = $1', [offerId]);
      for (const cid of body.picked_client_ids) {
        await pool.query(
          `INSERT INTO offer_picked_clients (offer_id, client_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`, [offerId, cid]
        ).catch(() => {});   // a deleted user must not fail the whole save
      }
    }
    if (body.delivery_code && body.code) {
      await pool.query(
        `INSERT INTO offer_codes (offer_id, code) VALUES ($1,$2)
         ON CONFLICT (code) DO UPDATE SET offer_id = EXCLUDED.offer_id
         WHERE offer_codes.offer_id = EXCLUDED.offer_id`,
        [offerId, body.code]
      );
    }
  }

  app.post('/api/offers', adminGate, async (req, res) => {
    if (guard(res)) return;
    const b = readBody(req.body);
    if (!b.type) return res.status(400).json({ error: 'Choose a valid offer type.' });
    if (!b.starts_at || !b.ends_at) return res.status(400).json({ error: 'Set a start and end date.' });
    if (b.delivery_code && b.code && !CODE_RE.test(b.code)) {
      return res.status(400).json({ error: 'A code is 3–30 characters: A–Z, 0–9, hyphen or underscore.' });
    }
    try {
      if (b.delivery_code && b.code) {
        const clash = await pool.query('SELECT 1 FROM offer_codes WHERE code = $1', [b.code]);
        if (clash.rows.length) return res.status(409).json({ error: `The code ${b.code} is already in use.` });
      }
      const { rows } = await pool.query(
        `INSERT INTO offers (name, type, value, plan_ids, audience_mode, segment_json,
            renewal_rule, renewal_months, delivery_code, delivery_auto, delivery_email,
            starts_at, ends_at, max_per_client, max_total, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16)
         RETURNING *`,
        [b.name, b.type, b.value, b.plan_ids, b.audience_mode,
         b.segment_json ? JSON.stringify(b.segment_json) : null,
         b.renewal_rule, b.renewal_months, b.delivery_code, b.delivery_auto, b.delivery_email,
         b.starts_at, b.ends_at, b.max_per_client, b.max_total, who(req)]
      );
      const offer = rows[0];
      await writePickedAndCode(offer.id, b);
      await auditOffer(offer.id, 'created', null, offer.name, who(req), `${b.type} ${b.value}`);
      res.json({ offer: decorateOffer(offer), offers: await loadOffers() });
    } catch (e) {
      console.error('[offers/create]', e);
      res.status(500).json({ error: 'Could not create the offer.' });
    }
  });

  app.patch('/api/offers/:id', adminGate, async (req, res) => {
    if (guard(res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    try {
      const cur = await pool.query('SELECT * FROM offers WHERE id = $1', [id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'Offer not found.' });
      // Editing a LIVE offer would silently change the terms under clients who
      // already saw it. Only drafts are editable in place.
      if (cur.rows[0].status !== 'draft') {
        return res.status(409).json({
          error: 'Only a draft can be edited. Pause this offer and create a new one to change its terms.',
        });
      }
      const b = readBody({ ...cur.rows[0], ...req.body });
      const { rows } = await pool.query(
        `UPDATE offers SET name=$2, type=$3, value=$4, plan_ids=$5, audience_mode=$6,
            segment_json=$7, renewal_rule=$8, renewal_months=$9, delivery_code=$10,
            delivery_auto=$11, delivery_email=$12, starts_at=$13, ends_at=$14,
            max_per_client=$15, max_total=$16
          WHERE id=$1 RETURNING *`,
        [id, b.name, b.type, b.value, b.plan_ids, b.audience_mode,
         b.segment_json ? JSON.stringify(b.segment_json) : null,
         b.renewal_rule, b.renewal_months, b.delivery_code, b.delivery_auto, b.delivery_email,
         b.starts_at, b.ends_at, b.max_per_client, b.max_total]
      );
      await writePickedAndCode(id, b);
      await auditOffer(id, 'edited', cur.rows[0].name, b.name, who(req), null);
      res.json({ offer: decorateOffer(rows[0]), offers: await loadOffers() });
    } catch (e) {
      console.error('[offers/edit]', e);
      res.status(500).json({ error: 'Could not update the offer.' });
    }
  });

  // ── approve ───────────────────────────────────────────────────────
  app.post('/api/offers/:id/approve', adminGate, async (req, res) => {
    if (guard(res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    const belowFloorApproved = req.body?.below_floor_approved === true;
    try {
      const cur = await pool.query(
        `SELECT o.*, c.code,
                (SELECT COUNT(*)::int FROM offer_picked_clients pc WHERE pc.offer_id=o.id) AS picked_count
           FROM offers o LEFT JOIN offer_codes c ON c.offer_id=o.id WHERE o.id=$1`, [id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'Offer not found.' });
      const o = cur.rows[0];
      const { settings, plans } = await settingsAndPlans();

      let audienceCount = null;
      if (o.audience_mode === 'segment') {
        audienceCount = (await previewSegment(pool, o.segment_json || {}, { sample: 1 })).count;
      }

      const errs = validateForApproval({
        ...o,
        value: Number(o.value),
        picked_client_ids: Array(o.picked_count).fill(0),
        audience_count: audienceCount,
        code: o.code,
      }, { plans, settings, belowFloorApproved });

      if (errs.length) return res.status(400).json({ error: errs.join(' · '), errors: errs });

      const selected = plans.filter((p) => (o.plan_ids || []).includes(p.id));
      const impact = marginImpact({ type: o.type, value: Number(o.value), plans: selected, settings });
      const below = violatesFloor(impact);

      const { rows } = await pool.query(
        `UPDATE offers SET status = $2, approved_by = $3, approved_at = NOW(),
                           below_floor_approved = $4
          WHERE id = $1 RETURNING *`,
        [id, effectiveStatus({ ...o, status: 'active' }), who(req), below && belowFloorApproved]
      );
      await auditOffer(id, 'approved', o.status, rows[0].status, who(req),
        below ? `BELOW FLOOR (${(marginFloorOf(settings) * 100).toFixed(1)}%) approved explicitly` : null);
      // Logged as its own entry too: a below-floor approval is the one action
      // here with a lasting margin consequence, and it should be findable
      // without reading every 'approved' row.
      if (below && belowFloorApproved) {
        await auditOffer(id, 'below_floor_approved', 'false', 'true', who(req), o.name);
      }
      res.json({ offer: decorateOffer(rows[0]), offers: await loadOffers() });
    } catch (e) {
      console.error('[offers/approve]', e);
      res.status(500).json({ error: 'Could not approve the offer.' });
    }
  });

  // ── pause / resume ────────────────────────────────────────────────
  for (const [path, next] of [['pause', 'paused'], ['resume', 'active']]) {
    app.post(`/api/offers/:id/${path}`, adminGate, async (req, res) => {
      if (guard(res)) return;
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
      try {
        const cur = await pool.query('SELECT * FROM offers WHERE id=$1', [id]);
        if (!cur.rows.length) return res.status(404).json({ error: 'Offer not found.' });
        if (cur.rows[0].status === 'draft') {
          return res.status(409).json({ error: 'A draft is not running — approve it first.' });
        }
        // Resuming recomputes from the dates rather than blindly writing
        // 'active': an offer paused before its window and resumed after it
        // ended must not come back to life.
        const target = next === 'active'
          ? effectiveStatus({ ...cur.rows[0], status: 'active' })
          : 'paused';
        const { rows } = await pool.query(
          'UPDATE offers SET status=$2 WHERE id=$1 RETURNING *', [id, target]);
        await auditOffer(id, path, cur.rows[0].status, target, who(req), cur.rows[0].name);
        res.json({ offer: decorateOffer(rows[0]), offers: await loadOffers() });
      } catch (e) {
        console.error(`[offers/${path}]`, e);
        res.status(500).json({ error: `Could not ${path} the offer.` });
      }
    });
  }

  // ── stats ─────────────────────────────────────────────────────────
  app.get('/api/offers/:id/stats', adminGate, async (req, res) => {
    if (guard(res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    try {
      const [offer, totals, recent, audit] = await Promise.all([
        pool.query('SELECT * FROM offers WHERE id=$1', [id]),
        pool.query(`SELECT COUNT(*)::int AS redemptions,
                           COALESCE(SUM(amount_saved),0)          AS discount_given,
                           COALESCE(SUM(bonus_credits_granted),0) AS credits_granted
                      FROM offer_redemptions WHERE offer_id=$1`, [id]),
        pool.query(`SELECT r.*, u.email FROM offer_redemptions r
                      JOIN users u ON u.id = r.client_id
                     WHERE r.offer_id=$1 ORDER BY r.redeemed_at DESC LIMIT 50`, [id]),
        pool.query(`SELECT * FROM pricing_audit_log
                     WHERE entity='offer' AND entity_id=$1
                     ORDER BY changed_at DESC LIMIT 50`, [id]),
      ]);
      if (!offer.rows.length) return res.status(404).json({ error: 'Offer not found.' });
      const t = totals.rows[0];
      res.json({
        offer: decorateOffer(offer.rows[0]),
        stats: {
          redemptions: t.redemptions,
          discount_given: Number(t.discount_given),
          credits_granted: Number(t.credits_granted),
        },
        redemptions: recent.rows,
        audit: audit.rows,
      });
    } catch (e) {
      console.error('[offers/stats]', e);
      res.status(500).json({ error: 'Could not load offer stats.' });
    }
  });

  // ── margin floor setting ──────────────────────────────────────────
  app.patch('/api/offers/settings', adminGate, async (req, res) => {
    if (guard(res)) return;
    const floor = Number(req.body?.margin_floor);
    if (!Number.isFinite(floor) || floor < 0 || floor >= 1) {
      return res.status(400).json({ error: 'The margin floor must be between 0 and 1.' });
    }
    try {
      const before = await pool.query('SELECT margin_floor FROM pricing_settings ORDER BY id LIMIT 1');
      await pool.query('UPDATE pricing_settings SET margin_floor = $1', [floor]);
      await auditOffer(null, 'margin_floor', before.rows[0]?.margin_floor, floor, who(req), null);
      const sp = await settingsAndPlans();
      res.json({ settings: sp.settings, offers: await loadOffers(), plans: sp.plans });
    } catch (e) {
      console.error('[offers/settings]', e);
      res.status(500).json({ error: 'Could not update the margin floor.' });
    }
  });
}
