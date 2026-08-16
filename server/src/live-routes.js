// ─── live-routes.js ──────────────────────────────────────────────────────────
// The screen for the two hours you are standing in a room with 170 people.
// Tier 2.1.
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
// REPLAY. Everything below is anchored to a timestamp rather than to NOW(),
// so the same screen can be pointed at a past session. That started as a way
// to check the screen when the platform is quiet — with no workshop running
// there is nothing to look at — but it is the more useful half: reviewing how
// a finished workshop actually went is a real question, and this is the only
// screen shaped to answer it.
//
// The immediate cause for building it: on 8 August roughly 415 generations
// failed in front of a live cohort because the supplier account was empty.
// Everyone was auto-refunded, so nothing surfaced it as a problem — it just
// looked, from the room, like the platform did not work.

const ACTIVE_WINDOW_MIN = 20;   // "here right now"
const FAIL_WINDOW_MIN = 10;     // short enough to catch a fault as it starts

/** The busiest hour in the recent past — the most interesting thing to replay. */
async function busiestPast(pool, days = 45) {
  const { rows } = await pool.query(
    `SELECT date_trunc('hour', created_at) + INTERVAL '1 hour' AS anchor,
            COUNT(*)::int AS n
       FROM credits_history
      WHERE action = 'spend' AND created_at > NOW() - ($1 || ' days')::INTERVAL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [days]);
  return rows[0]?.anchor || null;
}

export function registerLiveRoutes(app, { pool, dbReady, adminGate }) {
  app.get('/api/admin/live', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      // `replay` points the whole screen at a past moment. Explicit anchor
      // wins; otherwise the busiest hour we can find.
      let anchor = null;
      if (req.query.replay) {
        anchor = req.query.at ? new Date(req.query.at) : await busiestPast(pool);
        if (anchor && Number.isNaN(anchor.getTime())) anchor = null;
        if (!anchor) {
          return res.json({ live: false, replay: true, no_history: true,
            active_window_min: ACTIVE_WINDOW_MIN, fail_window_min: FAIL_WINDOW_MIN,
            active_now: 0, generating_now: { n: 0, video: 0, image: 0 }, failed_recent: 0,
            generations_recent: 0, credits_per_min: 0, per_minute: [], top_models: [],
            workshop: null, attention: [] });
        }
      }
      // One expression used everywhere below, so live and replay cannot drift
      // into measuring different things.
      // Each query binds the anchor at its OWN position — a single shared
      // placeholder string silently assumed every query put it at $3, which
      // only the first one does. `at(n)` keeps the two in step.
      const at = (n) => (anchor ? `$${n}::timestamptz` : 'NOW()');
      const AT = at(3);
      const args = () => (anchor
        ? [ACTIVE_WINDOW_MIN, FAIL_WINDOW_MIN, anchor]
        : [ACTIVE_WINDOW_MIN, FAIL_WINDOW_MIN]);

      const [pulse, generating, perMinute, byModel, cohort] = await Promise.all([
        pool.query(
          `SELECT
             (SELECT COUNT(DISTINCT user_id)::int FROM credits_history
               WHERE action = 'spend' AND created_at > ${AT} - ($1 || ' minutes')::INTERVAL
                 AND created_at <= ${AT}) AS active_now,
             (SELECT COUNT(*)::int FROM credits_history
               WHERE action = 'spend' AND created_at > ${AT} - ($1 || ' minutes')::INTERVAL
                 AND created_at <= ${AT}) AS gens_recent,
             (SELECT COUNT(*)::int FROM credits_history
               WHERE action = 'refund' AND created_at > ${AT} - ($2 || ' minutes')::INTERVAL
                 AND created_at <= ${AT}) AS failed_recent,
             (SELECT COALESCE(ABS(SUM(amount)), 0)::numeric FROM credits_history
               WHERE action = 'spend' AND created_at > ${AT} - ($1 || ' minutes')::INTERVAL
                 AND created_at <= ${AT}) AS credits_recent,
             (SELECT MIN(created_at) FROM credits_history
               WHERE action = 'spend' AND created_at > ${AT} - INTERVAL '6 hours'
                 AND created_at <= ${AT}) AS session_started`, args()),

        // Attempts still open — the closest thing to "spinning right now".
        // Meaningless in replay (they have long since resolved), so skipped.
        anchor
          ? Promise.resolve({ rows: [{ n: 0, video: 0, image: 0 }] })
          : pool.query(
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
            WHERE action = 'spend'
              AND created_at > ${at(1)} - INTERVAL '30 minutes' AND created_at <= ${at(1)}
            GROUP BY 1 ORDER BY 1`, anchor ? [anchor] : []),

        // Failures clustered on one model is the actionable case: switch the
        // demo. Failures spread across all of them means something else.
        pool.query(
          `SELECT regexp_replace(h.reason, '^(image|video|audio): ', '') AS model,
                  COUNT(*)::int AS attempts
             FROM credits_history h
            WHERE h.action = 'spend' AND h.reason IS NOT NULL
              AND h.created_at > ${at(2)} - ($1 || ' minutes')::INTERVAL
              AND h.created_at <= ${at(2)}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
          anchor ? [FAIL_WINDOW_MIN, anchor] : [FAIL_WINDOW_MIN]),

        // Which cohort is in the room — the code with the most activity.
        pool.query(
          `WITH act AS (
              SELECT (SELECT upper(p.code)
                        FROM promo_redemptions r JOIN promo_codes p ON p.id = r.code_id
                       WHERE r.user_id = h.user_id AND r.created_at <= h.created_at
                       ORDER BY r.created_at DESC LIMIT 1) AS code,
                     h.user_id
                FROM credits_history h
               WHERE h.action = 'spend'
                 AND h.created_at > ${at(1)} - INTERVAL '6 hours'
                 AND h.created_at <= ${at(1)})
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
            ORDER BY 2 DESC LIMIT 1`, anchor ? [anchor] : []),
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
        replay: !!anchor,
        replay_at: anchor ? anchor.toISOString() : null,
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
