// ─── customer-routes.js ──────────────────────────────────────────────────────
// Everything about one person, gathered under their name. Tier 2.2.
//
// THE SITUATION THIS IS FOR. An attendee emails "my video didn't work". Today
// answering that means: find them in Users, open the history modal, read a raw
// ledger of charges and refunds, and work out by eye which refund cancels which
// charge. The data has always been there; nothing has ever assembled it.
//
// So the work here is not fetching — it is PAIRING. A charge on its own does
// not say whether the customer got anything. The answer to their question is
// "two Omni attempts failed, both already refunded", and that sentence exists
// nowhere in the database until this endpoint builds it.
//
// Two sources, deliberately combined:
//   · generation_events — exact, but only from 2026-08-16 onward.
//   · credits_history   — the whole history, where the outcome must be
//                         inferred by matching a refund to the charge it
//                         reverses (same person, same amount, within 30 min).
// Rows carry which source they came from, so "inferred" is never dressed up as
// recorded.

const RECENT_LIMIT = 40;

export function registerCustomerRoutes(app, { pool, dbReady, adminGate }) {
  app.get('/api/admin/customers/:id/overview', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id.' });

    try {
      const [profile, codes, totals, recent, events] = await Promise.all([
        pool.query(
          `SELECT id, email, display_name, credits, credit_limit, role, banned, package,
                  created_at, last_login_at, expires_at
             FROM users WHERE id = $1`, [id]),

        // Which workshop they came from — and its title if one has been
        // recorded, which is what turns a code into a place and a date.
        pool.query(
          `SELECT upper(p.code) AS code, r.created_at AS redeemed_at,
                  w.title AS workshop, w.workshop_date, o.name AS organisation
             FROM promo_redemptions r
             JOIN promo_codes p ON p.id = r.code_id
             LEFT JOIN workshops w ON upper(w.promo_code) = upper(p.code)
             LEFT JOIN organisations o ON o.id = w.organisation_id
            WHERE r.user_id = $1
            ORDER BY r.created_at DESC`, [id]),

        pool.query(
          `SELECT COUNT(*) FILTER (WHERE action = 'spend')::int   AS generations,
                  COUNT(*) FILTER (WHERE action = 'refund')::int  AS refunds,
                  COALESCE(ABS(SUM(amount) FILTER (WHERE action = 'spend')), 0)::numeric  AS spent,
                  COALESCE(SUM(amount) FILTER (WHERE action = 'refund'), 0)::numeric      AS refunded,
                  MIN(created_at) FILTER (WHERE action = 'spend') AS first_generation,
                  MAX(created_at) FILTER (WHERE action = 'spend') AS last_generation
             FROM credits_history WHERE user_id = $1`, [id]),

        // Each charge with the refund that reverses it, if there is one. This
        // pairing IS the feature — it is what makes the ledger answer a
        // customer's question instead of merely listing money.
        pool.query(
          `SELECT h.id, h.created_at, h.amount, h.reason,
                  regexp_replace(h.reason, '^(image|video|audio): ', '') AS model,
                  split_part(h.reason, ':', 1) AS kind,
                  r.reason AS refund_reason, r.created_at AS refunded_at
             FROM credits_history h
             LEFT JOIN LATERAL (
               SELECT x.reason, x.created_at
                 FROM credits_history x
                WHERE x.user_id = h.user_id AND x.action = 'refund'
                  AND x.created_at >= h.created_at
                  AND x.created_at <  h.created_at + INTERVAL '30 minutes'
                  AND ABS(x.amount) = ABS(h.amount)
                ORDER BY x.created_at ASC LIMIT 1) r ON TRUE
            WHERE h.user_id = $1 AND h.action = 'spend'
            ORDER BY h.created_at DESC
            LIMIT $2`, [id, RECENT_LIMIT]),

        // Exact outcomes, where they exist. Recording began 2026-08-16, so
        // this is empty for anything older — hence the pairing above.
        pool.query(
          `SELECT created_at, model_label, kind, outcome, duration_ms, failure_reason
             FROM generation_events WHERE user_id = $1
            ORDER BY created_at DESC LIMIT $2`, [id, RECENT_LIMIT]),
      ]);

      if (!profile.rows[0]) return res.status(404).json({ error: 'No such customer.' });

      // Prefer a recorded outcome over an inferred one, matched on the minute.
      const exact = new Map();
      for (const e of events.rows) {
        exact.set(`${e.model_label}|${new Date(e.created_at).toISOString().slice(0, 16)}`, e);
      }

      const generations = recent.rows.map((g) => {
        const key = `${g.model}|${new Date(g.created_at).toISOString().slice(0, 16)}`;
        const e = exact.get(key);
        const refunded = !!g.refunded_at;
        return {
          at: g.created_at,
          model: g.model,
          kind: g.kind,
          charged: Math.abs(Number(g.amount)),
          outcome: e ? e.outcome : (refunded ? 'failed' : 'delivered'),
          // The honesty flag. Before 2026-08-16 "delivered" means only "no
          // refund followed", which is not the same as knowing it arrived.
          source: e ? 'recorded' : 'inferred',
          duration_ms: e?.duration_ms ?? null,
          failure_reason: e?.failure_reason || g.refund_reason || null,
          refunded,
        };
      });

      const t = totals.rows[0] || {};
      const failed = generations.filter((g) => g.outcome === 'failed').length;

      res.json({
        customer: profile.rows[0],
        workshops: codes.rows,
        totals: {
          ...t,
          // Over the rows shown, not all time — stated as such by the client.
          recent_failure_pct: generations.length
            ? Math.round((failed / generations.length) * 1000) / 10 : null,
        },
        generations,
        recorded_from: events.rows.length ? events.rows[events.rows.length - 1].created_at : null,
      });
    } catch (err) {
      console.error('[customer] overview failed:', err);
      res.status(500).json({ error: 'Could not load this customer.' });
    }
  });
}
