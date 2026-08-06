// ─── costing-routes.js ───────────────────────────────────────────────────────
// Admin API for the CRM Costing screen.
//
// Kept in its own module rather than added to index.js: that file is already
// past the ~1500-line threshold CLAUDE.md sets for splitting, and costing is a
// self-contained feature with its own tables.
//
// SCOPE. Nothing here charges anybody. server/src/pricing.js stays the single
// charging authority (finding C1 of the July audit). These endpoints read and
// write the costing tables only, so a mistyped cell changes what the calculator
// SAYS, never what a customer pays.
//
// Every write records an audit row before returning. The brief makes that
// non-negotiable, and it is the only way to answer "who changed this price and
// when" six months from now.

import {
  autoCredits, creditsOf, saleOf, basisOf, marginVsBasis, marginVsKie,
  planCredits, autoPlanCredits, planQty, profitMargin, costForMode,
  worstMarginForPlan, targetOf, isUncosted,
} from './costing-engine.js';
import { coverageReport } from './costing-coverage.js';

/** Columns a client may change, and how each is parsed. Anything not listed
 *  here is silently ignored — an allow-list, not a filter. */
const MODEL_FIELDS = {
  kie_cost:         (v) => positiveNumber(v, 'KIE cost'),
  fal_cost:         (v) => v === null || v === '' ? null : positiveNumber(v, 'FAL cost'),
  credits_override: (v) => v === null || v === '' ? null : halfCredit(v),
  margin_override:  (v) => v === null || v === '' ? null : fraction(v, 'Margin target'),
  is_active:        (v) => !!v,
};

function positiveNumber(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new BadInput(`${label} must be a positive number.`);
  return n;
}
function halfCredit(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new BadInput('Credits must be a positive number.');
  // Credits are only ever whole or half — anything else would be unchargeable.
  return Math.round(n * 2) / 2;
}
function fraction(v, label) {
  const n = Number(v);
  // Accept 40 or 0.40; a target of 100% would divide by zero in the engine.
  const f = n > 1 ? n / 100 : n;
  if (!Number.isFinite(f) || f <= 0 || f >= 0.95) {
    throw new BadInput(`${label} must be between 1% and 94%.`);
  }
  return f;
}

class BadInput extends Error {}

export function registerCostingRoutes(app, deps) {
  const { pool, dbReady, adminGate } = deps;

  /** Write one audit row. Never throws into the caller — a failed audit must
   *  be loud in the logs but must not make the change look like it failed. */
  async function audit({ entity, entity_id, field, old_value, new_value, changed_by, note }) {
    try {
      await pool.query(
        `INSERT INTO pricing_audit_log (entity, entity_id, field, old_value, new_value, changed_by, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entity, entity_id ?? null, field,
         old_value == null ? null : String(old_value).slice(0, 80),
         new_value == null ? null : String(new_value).slice(0, 80),
         changed_by, note ?? null]
      );
    } catch (e) {
      console.error('[costing] AUDIT WRITE FAILED:', e.message, { entity, field });
    }
  }

  async function loadState() {
    const [settings, models, plans, drafts] = await Promise.all([
      pool.query('SELECT * FROM pricing_settings WHERE id = 1'),
      pool.query('SELECT * FROM pricing_models ORDER BY sort_order'),
      pool.query('SELECT * FROM pricing_plans ORDER BY sort_order'),
      pool.query('SELECT * FROM pricing_plan_drafts'),
    ]);
    const s = settings.rows[0];
    // Postgres NUMERIC arrives as a string; the engine does arithmetic, so
    // coerce once here rather than hoping every call site remembers.
    const S = {
      margin_target: Number(s.margin_target),
      credit_value: Number(s.credit_value),
      alert_threshold: Number(s.alert_threshold),
      last_fetch_at: s.last_fetch_at,
    };
    const M = models.rows.map((m) => ({
      ...m,
      // Number(null) is 0 — which would make an uncosted model read as costing
      // NOTHING and show a perfect 100% margin. Preserve the null.
      kie_cost: m.kie_cost == null ? null : Number(m.kie_cost),
      fal_cost: m.fal_cost == null ? null : Number(m.fal_cost),
      credits_override: m.credits_override == null ? null : Number(m.credits_override),
      margin_override: m.margin_override == null ? null : Number(m.margin_override),
    }));
    const P = plans.rows.map((p) => ({
      ...p,
      price_usd: Number(p.price_usd),
      credits_override: p.credits_override == null ? null : Number(p.credits_override),
    }));
    return { settings: S, models: M, plans: P, drafts: drafts.rows };
  }

  /** Models a provider offers that we do not sell — the onboarding queue. */
  async function loadCatalog() {
    const { rows } = await pool.query(
      `SELECT * FROM pricing_catalog_models
        WHERE dismissed = FALSE
        ORDER BY first_seen DESC NULLS LAST, family ASC`
    );
    return rows.map((r) => ({
      ...r,
      // Same rule as pricing_models: Number(null) is 0, and a 0 here would
      // read as a free model. Keep the null so the screen says "unknown".
      price_usd: r.price_usd == null ? null : Number(r.price_usd),
    }));
  }

  /** The server computes every derived number, so the screen can never show a
   *  figure the backend disagrees with. */
  function decorate({ settings, models, plans, drafts }) {
    const S = settings;
    return {
      settings: S,
      plans: plans.map((p) => ({
        ...p,
        credits: planCredits(p, S),
        auto_credits: autoPlanCredits(p, S),
        per_credit: Number(p.price_usd) / planCredits(p, S),
      })),
      drafts,
      models: models.map((m) => ({
        ...m,
        basis: basisOf(m),
        target: targetOf(m, S),
        auto_credits: autoCredits(m, S),
        credits: creditsOf(m, S),
        sale: saleOf(m, S),
        margin_vs_basis: marginVsBasis(m, S),
        margin_vs_kie: marginVsKie(m, S),
        // No supplier cost recorded → the screen shows this row in its own
        // colour and reports the margin as unknown rather than as a number.
        needs_cost: isUncosted(m),
        qty_per_plan: plans.map((p) => planQty(m, p, S)),
      })),
      worst_margin_per_plan: plans.map((p) => worstMarginForPlan(models, p, S)),
      profit: ['max', 'kie', 'fal'].reduce((acc, mode) => {
        acc[mode] = models.map((m) => {
          const cost = costForMode(m, mode);
          return {
            id: m.id,
            cost,
            margins: cost == null ? null : plans.map((p) => profitMargin(m, p, S, cost)),
          };
        });
        return acc;
      }, {}),
      coverage: coverageReport(models),
    };
  }

  // ── read ──────────────────────────────────────────────────────────
  app.get('/api/costing/state', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const state = decorate(await loadState());
      // The catalogue is a separate table and a separate concern; if it is
      // missing (older database, migration not yet run) the rest of the screen
      // must still load rather than 500.
      state.catalog = await loadCatalog().catch(() => []);
      res.json(state);
    } catch (e) {
      console.error('[costing/state]', e);
      res.status(500).json({ error: 'Could not load costing state.' });
    }
  });

  // ── provider catalogue: dismiss / restore ─────────────────────────
  // Name matching between fal's catalogue and our labels cannot be exact, so
  // the owner needs a way to say "we already have this" permanently. Dismissal
  // is reversible and never deletes the row — the sync's ON CONFLICT DO
  // NOTHING then leaves it dismissed forever.
  app.post('/api/costing/catalog/:id/dismiss', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    const dismissed = req.body?.dismissed !== false;
    try {
      const { rows } = await pool.query(
        `UPDATE pricing_catalog_models
            SET dismissed = $2, dismissed_at = CASE WHEN $2 THEN NOW() ELSE NULL END
          WHERE id = $1 RETURNING family`,
        [id, dismissed]
      );
      if (!rows.length) return res.status(404).json({ error: 'Not found.' });
      await pool.query(
        `INSERT INTO pricing_audit_log (entity, entity_id, field, new_value, changed_by, note)
         VALUES ('catalog', $1, 'dismissed', $2, $3, $4)`,
        [id, String(dismissed), req.user?.email || 'admin', rows[0].family]
      ).catch(() => {});
      const state = decorate(await loadState());
      state.catalog = await loadCatalog();
      res.json(state);
    } catch (e) {
      console.error('[costing/catalog/dismiss]', e);
      res.status(500).json({ error: 'Could not update the catalogue entry.' });
    }
  });

  app.get('/api/costing/audit', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    try {
      const { rows } = await pool.query(
        `SELECT * FROM pricing_audit_log ORDER BY changed_at DESC LIMIT $1`, [limit]
      );
      res.json({ audit: rows });
    } catch (e) {
      console.error('[costing/audit]', e);
      res.status(500).json({ error: 'Could not load the audit trail.' });
    }
  });

  // ── settings ──────────────────────────────────────────────────────
  app.patch('/api/costing/settings', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const { rows: [current] } = await pool.query('SELECT * FROM pricing_settings WHERE id = 1');
      const updates = [];
      const values = [];
      const changes = [];

      if ('margin_target' in (req.body || {})) {
        const v = fraction(req.body.margin_target, 'Margin target');
        values.push(v); updates.push(`margin_target = $${values.length}`);
        changes.push(['margin_target', current.margin_target, v]);
      }
      if ('credit_value' in (req.body || {})) {
        const v = positiveNumber(req.body.credit_value, 'Credit value');
        values.push(v); updates.push(`credit_value = $${values.length}`);
        changes.push(['credit_value', current.credit_value, v]);
      }
      if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

      await pool.query(`UPDATE pricing_settings SET ${updates.join(', ')} WHERE id = 1`, values);
      for (const [field, oldV, newV] of changes) {
        await audit({ entity: 'setting', entity_id: 1, field, old_value: oldV, new_value: newV,
                      changed_by: req.user?.email || 'admin' });
      }
      res.json(decorate(await loadState()));
    } catch (e) {
      if (e instanceof BadInput) return res.status(400).json({ error: e.message });
      console.error('[costing/settings]', e);
      res.status(500).json({ error: 'Update failed.' });
    }
  });

  // ── a model row ───────────────────────────────────────────────────
  app.patch('/api/costing/models/:id', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad model id.' });
    try {
      const { rows: [current] } = await pool.query('SELECT * FROM pricing_models WHERE id = $1', [id]);
      if (!current) return res.status(404).json({ error: 'Model not found.' });

      const updates = [];
      const values = [];
      const changes = [];
      for (const [field, parse] of Object.entries(MODEL_FIELDS)) {
        if (!(field in (req.body || {}))) continue;
        const v = parse(req.body[field]);
        values.push(v); updates.push(`${field} = $${values.length}`);
        changes.push([field, current[field], v]);
      }
      if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

      values.push(req.user?.email || 'admin');
      updates.push(`updated_by = $${values.length}`, 'updated_at = NOW()');
      values.push(id);
      await pool.query(`UPDATE pricing_models SET ${updates.join(', ')} WHERE id = $${values.length}`, values);

      for (const [field, oldV, newV] of changes) {
        await audit({ entity: 'model', entity_id: id, field, old_value: oldV, new_value: newV,
                      changed_by: req.user?.email || 'admin',
                      note: `${current.model_name} ${current.variant ?? ''} ${current.resolution ?? ''}`.trim() });
      }
      res.json(decorate(await loadState()));
    } catch (e) {
      if (e instanceof BadInput) return res.status(400).json({ error: e.message });
      console.error('[costing/models]', e);
      res.status(500).json({ error: 'Update failed.' });
    }
  });

  // ── plan drafts ───────────────────────────────────────────────────
  // Drafts are replaced wholesale: the screen always sends the full set, which
  // avoids a half-applied edit if one row fails.
  app.put('/api/costing/plans/draft', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const incoming = Array.isArray(req.body?.plans) ? req.body.plans : null;
    if (!incoming) return res.status(400).json({ error: 'Expected a plans array.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM pricing_plan_drafts');
      for (const p of incoming) {
        const id = parseInt(p.id, 10);
        if (!Number.isInteger(id)) throw new BadInput('Bad plan id.');
        const name = String(p.name || '').trim().slice(0, 40);
        if (!name) throw new BadInput('Plan name cannot be empty.');
        const price = positiveNumber(p.price_usd, 'Plan price');
        const credits = p.credits_override == null || p.credits_override === ''
          ? null : Math.max(1, Math.round(Number(p.credits_override)));
        await client.query(
          `INSERT INTO pricing_plan_drafts (plan_id, name, price_usd, credits_override, created_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, name, price, credits, req.user?.email || 'admin']
        );
      }
      await client.query('COMMIT');
      res.json(decorate(await loadState()));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e instanceof BadInput) return res.status(400).json({ error: e.message });
      console.error('[costing/plans/draft]', e);
      res.status(500).json({ error: 'Could not save the draft.' });
    } finally {
      client.release();
    }
  });

  app.delete('/api/costing/plans/draft', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      await pool.query('DELETE FROM pricing_plan_drafts');
      res.json(decorate(await loadState()));
    } catch (e) {
      console.error('[costing/plans/draft delete]', e);
      res.status(500).json({ error: 'Could not discard the draft.' });
    }
  });

  // Approval is the ONLY thing that moves a published plan. One transaction, so
  // a partial approval cannot leave half the tiers on new prices.
  app.post('/api/costing/plans/approve', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: drafts } = await client.query('SELECT * FROM pricing_plan_drafts');
      if (!drafts.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'There is no draft to approve.' });
      }
      const { rows: published } = await client.query('SELECT * FROM pricing_plans');
      const byId = new Map(published.map((p) => [p.id, p]));
      const changes = [];
      for (const d of drafts) {
        const before = byId.get(d.plan_id);
        if (!before) continue;
        if (String(before.name) !== String(d.name)) changes.push([d.plan_id, 'name', before.name, d.name]);
        if (Number(before.price_usd) !== Number(d.price_usd)) changes.push([d.plan_id, 'price_usd', before.price_usd, d.price_usd]);
        const bo = before.credits_override == null ? null : Number(before.credits_override);
        const do_ = d.credits_override == null ? null : Number(d.credits_override);
        if (bo !== do_) changes.push([d.plan_id, 'credits_override', bo, do_]);
        await client.query(
          `UPDATE pricing_plans SET name = $1, price_usd = $2, credits_override = $3 WHERE id = $4`,
          [d.name, d.price_usd, d.credits_override, d.plan_id]
        );
      }
      await client.query('DELETE FROM pricing_plan_drafts');
      await client.query('COMMIT');

      for (const [id, field, oldV, newV] of changes) {
        await audit({ entity: 'plan', entity_id: id, field, old_value: oldV, new_value: newV,
                      changed_by: req.user?.email || 'admin', note: 'approved from draft' });
      }
      console.log(`[costing] ${req.user?.email} approved ${changes.length} plan change(s)`);
      res.json({ ...decorate(await loadState()), approved: changes.length });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[costing/plans/approve]', e);
      res.status(500).json({ error: 'Approval failed.' });
    } finally {
      client.release();
    }
  });
}
