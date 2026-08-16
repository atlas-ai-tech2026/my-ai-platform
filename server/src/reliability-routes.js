// ─── reliability-routes.js ───────────────────────────────────────────────────
// Which models can be trusted in front of a room, measured rather than assumed.
//
// THE INFERENCE THIS RESTS ON, stated plainly because the screen repeats it.
// Nothing in the database records "model X failed". Spend rows name the model
// ("video: Kling 3.0"); refund rows name the provider's complaint
// ("kie_threw: timed out"). So a failure is attributed to the model by matching
// each refund to the spend it almost certainly reverses — same person, same
// amount, within thirty minutes.
//
// Measured against production on 2026-08-16 that recovers 1,192 of 1,316
// refunds (91%). The unmatched 9% are counted and reported, so the screen can
// say how much of its own picture is inferred rather than pretending to none.
//
// The exact version is cheap and lands with the next change: pending_video_
// charges already HAS a model_label column and 3,046 rows, every one of them
// NULL. Writing it makes video failures a record instead of a deduction.

import { buildReport, summarise, confidenceOf, MIN_ATTEMPTS } from './reliability-engine.js';
import { costIndex } from './pnl-engine.js';
import { buildReport as buildSpeed, summarise as summariseSpeed } from './speed-engine.js';
// The SAME pattern the Alerts tab uses to spot "our supplier account is
// empty". Imported rather than retyped: two copies would drift, and the day
// they drift is the day a billing problem is reported as a model-quality one.
import { OUR_ACCOUNT_DRY_SOURCE } from './alerts-engine.js';

const WINDOW_DAYS = 30;

export function registerReliabilityRoutes(app, { pool, dbReady, adminGate }) {
  app.get('/api/costing/reliability', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || WINDOW_DAYS));
    try {
      const [rows, refundTotals, models, speedRows, speedSince] = await Promise.all([
        pool.query(
          `WITH attempts AS (
              SELECT regexp_replace(reason, '^(image|video|audio): ', '') AS model,
                     split_part(reason, ':', 1)                           AS kind,
                     COUNT(*)::int                                        AS attempts
                FROM credits_history
               WHERE action = 'spend' AND reason IS NOT NULL
                 AND created_at > NOW() - ($1 || ' days')::INTERVAL
               GROUP BY 1, 2),
            refunds AS (
              SELECT r.user_id, r.amount, r.created_at, r.reason
                FROM credits_history r
               WHERE r.action = 'refund'
                 AND r.created_at > NOW() - ($1 || ' days')::INTERVAL),
            -- CROSS JOIN LATERAL, so a refund with no plausible spend simply
            -- drops out rather than being pinned on an arbitrary model.
            matched AS (
              SELECT regexp_replace(m.reason, '^(image|video|audio): ', '') AS model,
                     r.reason AS refund_reason
                FROM refunds r
                CROSS JOIN LATERAL (
                  SELECT h.reason
                    FROM credits_history h
                   WHERE h.user_id = r.user_id
                     AND h.action = 'spend' AND h.reason IS NOT NULL
                     AND h.created_at <= r.created_at
                     AND h.created_at >  r.created_at - INTERVAL '30 minutes'
                     AND ABS(h.amount) = ABS(r.amount)
                   ORDER BY h.created_at DESC
                   LIMIT 1) m),
            -- Split at the source. A failure caused by OUR account being empty
            -- says nothing about the model — it fails whatever happens to be
            -- running — so it must never reach the verdict.
            fails AS (
              SELECT model,
                     COUNT(*)::int AS failures,
                     COUNT(*) FILTER (WHERE refund_reason ~* $2)::int AS account_dry_failures
                FROM matched GROUP BY 1)
           SELECT a.model, a.kind, a.attempts,
                  COALESCE(f.failures, 0)::int             AS failures,
                  COALESCE(f.account_dry_failures, 0)::int AS account_dry_failures
             FROM attempts a LEFT JOIN fails f ON f.model = a.model
            ORDER BY a.attempts DESC`, [days, OUR_ACCOUNT_DRY_SOURCE]),

        // How much of the picture is inferred — the honesty figure.
        pool.query(
          `WITH refunds AS (
              SELECT r.user_id, r.amount, r.created_at
                FROM credits_history r
               WHERE r.action = 'refund'
                 AND r.created_at > NOW() - ($1 || ' days')::INTERVAL)
           SELECT COUNT(*)::int AS total,
                  COUNT(m.reason)::int AS matched
             FROM refunds r
             LEFT JOIN LATERAL (
               SELECT h.reason FROM credits_history h
                WHERE h.user_id = r.user_id
                  AND h.action = 'spend' AND h.reason IS NOT NULL
                  AND h.created_at <= r.created_at
                  AND h.created_at >  r.created_at - INTERVAL '30 minutes'
                  AND ABS(h.amount) = ABS(r.amount)
                ORDER BY h.created_at DESC LIMIT 1) m ON TRUE`, [days]),

        pool.query(`SELECT model_name, fal_cost, kie_cost FROM pricing_models WHERE is_active`),

        // ── Tier 2.3, model speed ──────────────────────────────────────────
        // PERCENTILE_DISC, not _CONT: discrete returns a duration that a run
        // ACTUALLY took, where continuous would interpolate a value between
        // two real runs. This screen is read as a statement about what
        // happened, so it should only ever report what happened.
        //
        // Only DELIVERED runs are timed. A failed run's duration measures how
        // long it took to give up, which is a different question and would
        // drag a good model's median down for the wrong reason.
        pool.query(
          `SELECT model_label AS model, kind,
                  COUNT(duration_ms)::int AS timed,
                  PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY duration_ms) AS median_ms,
                  PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY duration_ms) AS slow_ms
             FROM generation_events
            WHERE duration_ms IS NOT NULL AND outcome = 'delivered'
              AND model_label IS NOT NULL
              AND created_at > NOW() - ($1 || ' days')::INTERVAL
            GROUP BY 1, 2`, [days]),

        // When recording began — so an empty speed table reads as "too early
        // to say", never as "nothing is slow".
        pool.query(`SELECT MIN(created_at) AS since FROM generation_events`),
      ]);

      const report = buildReport(rows.rows, costIndex(models.rows));
      const t = refundTotals.rows[0] || { total: 0, matched: 0 };

      // Spend rows with no model name at all — 13,736 of them historically.
      // Those attempts cannot be attributed either, so the screen says how many
      // it is working without rather than quietly excluding them.
      const unnamed = await pool.query(
        `SELECT COUNT(*)::int AS n FROM credits_history
          WHERE action = 'spend' AND reason IS NULL
            AND created_at > NOW() - ($1 || ' days')::INTERVAL`, [days]);

      res.json({
        window_days: days,
        min_attempts: MIN_ATTEMPTS,
        models: report,
        summary: summarise(report),
        speed: {
          models: buildSpeed(speedRows.rows),
          summary: summariseSpeed(buildSpeed(speedRows.rows), {
            since: speedSince.rows[0]?.since || null,
          }),
        },
        confidence: {
          ...confidenceOf(t.matched, t.total),
          matched: t.matched,
          total_refunds: t.total,
          unnamed_attempts: unnamed.rows[0]?.n || 0,
        },
      });
    } catch (err) {
      console.error('[reliability] failed:', err);
      res.status(500).json({ error: 'Could not build the reliability report.' });
    }
  });
}
