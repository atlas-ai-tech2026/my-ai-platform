// ─── pnl-routes.js ───────────────────────────────────────────────────────────
// Organisations, workshops, and the P&L that joins them to what was actually
// spent with the suppliers.
//
// The join that makes this possible at all is the promo code: attendees are
// identified by the code they redeemed, so a workshop's cohort is knowable and
// therefore so is its supplier cost. Without that link there would be no way
// to attribute a kie bill to the session that caused it.
//
// Everything here reads; nothing charges. pricing.js remains the only thing
// that takes a credit off a customer (finding C1).

import { costIndex, attributeCost, workshopPnl, summarise } from './pnl-engine.js';

/**
 * Spend per model, attributed to ONE workshop per generation.
 *
 * The naive version — "everyone who redeemed this code" — double counts. 194
 * people hold 461 redemptions between them, so anyone who redeemed two codes
 * had their spend charged against both workshops. Summing the seven August
 * cohorts that way produced $5,247 of supplier cost for a fortnight in which
 * the whole platform only spent $2,040: an impossible number that would have
 * made every workshop look unprofitable.
 *
 * So each generation is attributed to the code the user had redeemed MOST
 * RECENTLY BEFORE it. Someone who genuinely attended two workshops has their
 * early work counted against the first and their later work against the
 * second, and no credit is ever counted twice.
 */
async function cohortSpend(pool, code) {
  const { rows } = await pool.query(
    `WITH attributed AS (
        SELECT h.reason, h.amount,
               (SELECT upper(p.code)
                  FROM promo_redemptions r
                  JOIN promo_codes p ON p.id = r.code_id
                 WHERE r.user_id = h.user_id
                   AND r.created_at <= h.created_at
                 ORDER BY r.created_at DESC
                 LIMIT 1) AS code
          FROM credits_history h
         WHERE h.action = 'spend' AND h.reason IS NOT NULL)
     SELECT regexp_replace(reason, '^(image|video|audio): ', '') AS model,
            ABS(SUM(amount))::numeric AS credits,
            COUNT(*)::int             AS uses
       FROM attributed
      WHERE code = upper($1)
      GROUP BY 1
      ORDER BY 2 DESC`, [code]);
  return rows;
}

/** Headcount and refunds for the same cohort — context the margin needs. */
async function cohortFacts(pool, code) {
  const { rows } = await pool.query(
    `WITH cohort AS (
        SELECT DISTINCT r.user_id
          FROM promo_redemptions r
          JOIN promo_codes p ON p.id = r.code_id
         WHERE upper(p.code) = upper($1))
     SELECT (SELECT COUNT(*)::int FROM cohort)                                    AS attendees,
            (SELECT COUNT(*)::int FROM credits_history
              WHERE action = 'refund' AND user_id IN (SELECT user_id FROM cohort)) AS refunds,
            (SELECT COALESCE(SUM(credits), 0)::numeric FROM users
              WHERE id IN (SELECT user_id FROM cohort))                            AS credits_left,
            (SELECT COUNT(*)::int FROM credits_history
              WHERE action = 'spend' AND reason IS NULL
                AND user_id IN (SELECT user_id FROM cohort))                       AS unattributed_spends`,
    [code]);
  return rows[0] || {};
}

export function registerPnlRoutes(app, { pool, dbReady, adminGate }) {
  // ── organisations ────────────────────────────────────────────────────────
  app.get('/api/admin/organisations', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const { rows } = await pool.query(
        `SELECT o.*, COUNT(w.id)::int AS workshops
           FROM organisations o LEFT JOIN workshops w ON w.organisation_id = o.id
          GROUP BY o.id ORDER BY o.name`);
      res.json({ organisations: rows });
    } catch (err) {
      console.error('[pnl] organisations failed:', err);
      res.status(500).json({ error: 'Could not load organisations.' });
    }
  });

  app.post('/api/admin/organisations', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A name is required.' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO organisations (name, contact_name, contact_email, notes)
              VALUES ($1,$2,$3,$4)
         ON CONFLICT (lower(name)) DO UPDATE SET
              contact_name  = COALESCE(EXCLUDED.contact_name,  organisations.contact_name),
              contact_email = COALESCE(EXCLUDED.contact_email, organisations.contact_email)
         RETURNING *`,
        [name, req.body?.contact_name || null, req.body?.contact_email || null, req.body?.notes || null]);
      res.json(rows[0]);
    } catch (err) {
      console.error('[pnl] create organisation failed:', err);
      res.status(500).json({ error: 'Could not save the organisation.' });
    }
  });

  // ── workshops + the P&L ──────────────────────────────────────────────────
  app.get('/api/admin/workshops', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const [ws, models, settings] = await Promise.all([
        pool.query(`SELECT w.*, o.name AS organisation
                      FROM workshops w LEFT JOIN organisations o ON o.id = w.organisation_id
                     ORDER BY w.workshop_date DESC NULLS LAST, w.id DESC`),
        pool.query(`SELECT model_name, fal_cost, kie_cost FROM pricing_models WHERE is_active`),
        pool.query(`SELECT credit_value FROM pricing_settings WHERE id = 1`),
      ]);
      const idx = costIndex(models.rows);
      const creditValueUsd = Number(settings.rows[0]?.credit_value) || 0.06333333;

      const rows = [];
      for (const w of ws.rows) {
        // No code means no cohort, so no supplier cost can be attributed —
        // reported as such rather than as zero.
        const spend = w.promo_code ? await cohortSpend(pool, w.promo_code) : [];
        const facts = w.promo_code ? await cohortFacts(pool, w.promo_code) : {};
        const cost = attributeCost(spend, idx, { creditValueUsd });
        rows.push({
          ...w,
          ...workshopPnl(w, cost),
          coverage: cost,
          attendees: facts.attendees ?? null,
          refunds: facts.refunds ?? null,
          credits_left: facts.credits_left ?? null,
          // 13,736 historical spend rows carry no model name. Where a cohort
          // has those, its cost is under-counted and the screen must say so
          // rather than quietly reporting a rosy margin.
          unattributed_spends: facts.unattributed_spends ?? null,
        });
      }

      // Which codes exist but have no workshop recorded — the fastest way for
      // the owner to see what is missing rather than guess.
      const unlinked = await pool.query(
        `SELECT p.code, COUNT(DISTINCT r.user_id)::int AS attendees,
                to_char(MIN(r.created_at), 'YYYY-MM-DD') AS first_redeemed
           FROM promo_codes p JOIN promo_redemptions r ON r.code_id = p.id
          WHERE upper(p.code) NOT IN (
                SELECT upper(promo_code) FROM workshops WHERE promo_code IS NOT NULL)
          GROUP BY p.code HAVING COUNT(r.user_id) > 0
          ORDER BY MIN(r.created_at) DESC`);

      res.json({ workshops: rows, summary: summarise(rows), unlinked_codes: unlinked.rows });
    } catch (err) {
      console.error('[pnl] workshops failed:', err);
      res.status(500).json({ error: 'Could not load workshops.' });
    }
  });

  const FIELDS = ['organisation_id', 'title', 'workshop_date', 'seats', 'promo_code',
    'invoiced_amount', 'currency', 'invoice_ref', 'invoice_status', 'paid_at', 'notes'];

  const clean = (body) => {
    const cols = [], vals = [];
    for (const f of FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, f)) continue;
      let v = body[f];
      if (v === '' || v === undefined) v = null;
      if (v !== null && (f === 'seats' || f === 'organisation_id')) {
        v = parseInt(v, 10);
        if (!Number.isFinite(v)) return { error: `${f} must be a whole number.` };
      }
      if (v !== null && f === 'invoiced_amount') {
        v = Number(v);
        if (!Number.isFinite(v) || v < 0) return { error: 'Invoiced amount must be 0 or more.' };
      }
      if (v !== null && f === 'invoice_status' && !['draft', 'issued', 'paid'].includes(v)) {
        return { error: 'Status must be draft, issued or paid.' };
      }
      cols.push(f); vals.push(v);
    }
    return { cols, vals };
  };

  app.post('/api/admin/workshops', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const { cols, vals, error } = clean(req.body || {});
    if (error) return res.status(400).json({ error });
    if (!cols.length) return res.status(400).json({ error: 'Nothing to save.' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO workshops (${cols.join(',')})
              VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
      res.json(rows[0]);
    } catch (err) {
      console.error('[pnl] create workshop failed:', err);
      res.status(500).json({ error: 'Could not save the workshop.' });
    }
  });

  app.put('/api/admin/workshops/:id', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const { cols, vals, error } = clean(req.body || {});
    if (error) return res.status(400).json({ error });
    if (!cols.length) return res.status(400).json({ error: 'Nothing to update.' });
    try {
      const { rows } = await pool.query(
        `UPDATE workshops SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')},
                updated_at = NOW()
          WHERE id = $${cols.length + 1} RETURNING *`, [...vals, req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'No such workshop.' });
      res.json(rows[0]);
    } catch (err) {
      console.error('[pnl] update workshop failed:', err);
      res.status(500).json({ error: 'Could not update the workshop.' });
    }
  });

  app.delete('/api/admin/workshops/:id', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const { rows } = await pool.query(`DELETE FROM workshops WHERE id = $1 RETURNING id`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'No such workshop.' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[pnl] delete workshop failed:', err);
      res.status(500).json({ error: 'Could not delete the workshop.' });
    }
  });
}
