// ─── live-routes.js ──────────────────────────────────────────────────────────
// The screen for the two hours you are standing in a room with 170 people and
// something is not working. Tier 2.1.
//
// Everything else in the panel answers "what happened". This answers "what is
// happening", which is a different job with different rules:
//
//   · It must be readable from a laptop on a lectern, mid-sentence. Four
//     numbers, one shape, one short list of things needing a decision.
//   · A quiet moment must look QUIET, not broken. If nothing is running it
//     says so, rather than rendering a wall of zeros that reads as an outage.
//   · Every window is short and absolute — "in the last 10 minutes", never a
//     rolling average, because during a session you need to know about the
//     failure that started four minutes ago, not one smoothed away.
//
// The immediate cause for building it: on 8 August roughly 415 generations
// failed in front of a live cohort because the supplier account was empty.
// Everyone was auto-refunded, so nothing surfaced it as a problem — it just
// looked, from the room, like the platform did not work.

const ACTIVE_WINDOW_MIN = 20;   // "here right now"
const FAIL_WINDOW_MIN = 10;     // short enough to catch a fault as it starts

export function registerLiveRoutes(app, { pool, dbReady, adminGate }) {
  app.get('/api/admin/live', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const [pulse, generating, perMinute, byModel, cohort] = await Promise.all([
        // Who is here, what it is costing, right now.
        pool.query(
          `SELECT
             (SELECT COUNT(DISTINCT user_id)::int FROM credits_history
               WHERE action = 'spend' AND created_at > NOW() - ($1 || ' minutes')::INTERVAL) AS active_now,
             (SELECT COUNT(*)::int FROM credits_history
               WHERE action = 'spend' AND created_at > NOW() - ($1 || ' minutes')::INTERVAL) AS gens_recent,
             (SELECT COUNT(*)::int FROM credits_history
               WHERE action = 'refund' AND created_at > NOW() - ($2 || ' minutes')::INTERVAL) AS failed_recent,
             (SELECT COALESCE(ABS(SUM(amount)), 0)::numeric FROM credits_history
               WHERE action = 'spend' AND created_at > NOW() - ($1 || ' minutes')::INTERVAL) AS credits_recent,
             (SELECT MIN(created_at) FROM credits_history
               WHERE action = 'spend' AND created_at > NOW() - INTERVAL '6 hours') AS session_started`,
          [ACTIVE_WINDOW_MIN, FAIL_WINDOW_MIN]),

        // Attempts still open — the closest thing to "spinning right now".
        pool.query(
          `SELECT COUNT(*)::int AS n,
                  COUNT(*) FILTER (WHERE kind = 'video')::int AS video,
                  COUNT(*) FILTER (WHERE kind = 'image')::int AS image
             FROM generation_events
            WHERE outcome = 'pending' AND created_at > NOW() - INTERVAL '20 minutes'`),

        // The shape of the last half hour. A chart is the fastest way to see
        // "it stopped" without reading a number.
        pool.query(
          `SELECT to_char(date_trunc('minute', created_at), 'HH24:MI') AS minute,
                  COUNT(*)::int AS n
             FROM credits_history
            WHERE action = 'spend' AND created_at > NOW() - INTERVAL '30 minutes'
            GROUP BY 1 ORDER BY 1`),

        // Failures clustered on one model is the actionable case: switch the
        // demo. Failures spread across all of them means something else.
        pool.query(
          `SELECT regexp_replace(h.reason, '^(image|video|audio): ', '') AS model,
                  COUNT(*)::int AS attempts
             FROM credits_history h
            WHERE h.action = 'spend' AND h.reason IS NOT NULL
              AND h.created_at > NOW() - ($1 || ' minutes')::INTERVAL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, [FAIL_WINDOW_MIN]),

        // Which cohort is in the room — the code with the most activity today.
        pool.query(
          `WITH act AS (
              SELECT (SELECT upper(p.code)
                        FROM promo_redemptions r JOIN promo_codes p ON p.id = r.code_id
                       WHERE r.user_id = h.user_id AND r.created_at <= h.created_at
                       ORDER BY r.created_at DESC LIMIT 1) AS code,
                     h.user_id
                FROM credits_history h
               WHERE h.action = 'spend' AND h.created_at > NOW() - INTERVAL '6 hours')
           SELECT a.code,
                  COUNT(DISTINCT a.user_id)::int AS active,
                  (SELECT COUNT(DISTINCT r.user_id)::int
                     FROM promo_redemptions r JOIN promo_codes p ON p.id = r.code_id
                    WHERE upper(p.code) = a.code)                       AS cohort_size,
                  w.title, w.seats
             FROM act a
             LEFT JOIN workshops w ON upper(w.promo_code) = a.code
            WHERE a.code IS NOT NULL
            GROUP BY a.code, w.title, w.seats
            ORDER BY 2 DESC LIMIT 1`),
      ]);

      const p = pulse.rows[0] || {};
      const gens = Number(p.gens_recent) || 0;
      const credits = Number(p.credits_recent) || 0;
      const failed = Number(p.failed_recent) || 0;

      // "Live" is a judgement, and a wrong one is worse than none: a quiet
      // panel that claims a session is running sends you looking for a fault.
      const live = gens > 0;

      const attention = [];
      const worst = byModel.rows[0];
      if (failed >= 5) {
        attention.push({
          severity: failed >= 15 ? 'crit' : 'warn',
          title: `${failed} failure(s) in the last ${FAIL_WINDOW_MIN} minutes`,
          detail: worst
            ? `Most activity is on ${worst.model}. If failures cluster there, switch the demo to another model.`
            : 'Check the Alerts tab — a supplier account running dry fails every model at once.',
        });
      }
      if (cohort.rows[0]) {
        const c = cohort.rows[0];
        const missing = Number(c.cohort_size) - Number(c.active);
        if (missing > 0 && Number(c.active) > 0) {
          attention.push({
            severity: 'dim',
            title: `${missing} of ${c.cohort_size} have not generated anything`,
            detail: 'Codes redeemed but nothing created yet — they may need help signing in.',
          });
        }
      }

      res.json({
        live,
        session_started: p.session_started || null,
        active_now: Number(p.active_now) || 0,
        generating_now: generating.rows[0] || { n: 0, video: 0, image: 0 },
        failed_recent: failed,
        fail_window_min: FAIL_WINDOW_MIN,
        active_window_min: ACTIVE_WINDOW_MIN,
        generations_recent: gens,
        credits_per_min: Math.round((credits / ACTIVE_WINDOW_MIN) * 10) / 10,
        per_minute: perMinute.rows,
        top_models: byModel.rows,
        workshop: cohort.rows[0] || null,
        attention,
      });
    } catch (err) {
      console.error('[live] failed:', err);
      res.status(500).json({ error: 'Could not read live activity.' });
    }
  });
}
