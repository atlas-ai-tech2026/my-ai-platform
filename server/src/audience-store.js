// ─── audience-store.js ───────────────────────────────────────────────────────
// Recording page views, and reading back the history.
//
// ── STORED AS DAILY TOTALS, NOT AS EVENTS ──────────────────────────────────
// One row per event would be the obvious design and the wrong one here. The
// database is a 10 GiB disk that does not degrade gracefully — it stops
// accepting writes, and generations fail. A busy month of raw hits would be
// hundreds of thousands of rows to answer a question that is always asked per
// day anyway.
//
// So each page view increments a counter for (day, path, referrer). Unique
// visitors need one row per person per day, which is the only per-visitor thing
// kept — and its hash is re-salted daily, so it is useless tomorrow.
//
// ── THE HISTORY COMES FROM SOMEWHERE ELSE ENTIRELY ─────────────────────────
// Visits start the day this ships. But signups and activity have always been
// dated, so "how many joined in July" and "how long did people work" reach back
// to the first customer with no new tracking at all. Two different sources on
// one screen, and the screen says which is which.

import { createHash } from 'node:crypto';
import { visitorHash, shouldCount, referrerHost, sessionsFromActions,
         dailyEngagement, fillDays, provenance } from './audience.js';

export async function ensureAudienceTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_views (
      day           DATE         NOT NULL,
      path          VARCHAR(200) NOT NULL,
      referrer_host VARCHAR(120) NOT NULL DEFAULT 'direct',
      views         INTEGER      NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path, referrer_host)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_visitors (
      day          DATE        NOT NULL,
      visitor_hash VARCHAR(32) NOT NULL,
      PRIMARY KEY (day, visitor_hash)
    )`);
  // When counting started. Written once, and it is what lets the screen say
  // "before this date is unknown" instead of drawing a zero nobody measured.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audience_meta (
      id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      started_on  DATE NOT NULL DEFAULT CURRENT_DATE
    )`);
  await pool.query(`INSERT INTO audience_meta (id) VALUES (1) ON CONFLICT DO NOTHING`);
}

/**
 * The per-day salt.
 *
 * Derived, never stored: the same value all day, a different one tomorrow, and
 * nothing on disk that could be used to re-identify yesterday's visitors. It
 * hangs off JWT_SECRET so it is not guessable from the outside.
 */
export function saltFor(day, env = process.env) {
  return createHash('sha256')
    .update(`audience|${day}|${env.JWT_SECRET || 'unset'}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/**
 * Record one page view. NEVER throws, and never delays the response.
 *
 * Analytics must not be able to break the site or slow it down — a counter that
 * takes the page with it when the database hiccups is a worse trade than losing
 * the count. Errors are logged once and swallowed.
 */
export async function recordView(pool, { path, referer, ip, userAgent, ownHosts, now = new Date() }) {
  try {
    const day = new Date(now).toISOString().slice(0, 10);
    const host = referrerHost(referer, ownHosts);
    await pool.query(
      `INSERT INTO page_views (day, path, referrer_host, views) VALUES ($1,$2,$3,1)
       ON CONFLICT (day, path, referrer_host) DO UPDATE SET views = page_views.views + 1`,
      [day, String(path).slice(0, 200), host]);

    const hash = visitorHash({ ip, userAgent, day, salt: saltFor(day) });
    if (hash) {
      await pool.query(
        `INSERT INTO page_visitors (day, visitor_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [day, hash]);
    }
  } catch (e) {
    console.error('[audience] could not record a view:', e.message);
  }
}

/** Express middleware. Decides with the pure rules, then records out of band. */
export function audienceMiddleware(pool, { dbReady, resolveIp, ownHosts = [] }) {
  return (req, res, next) => {
    next();                                   // never make a visitor wait for us
    try {
      if (!dbReady()) return;
      const verdict = shouldCount({
        path: req.path,
        method: req.method,
        userAgent: req.get('user-agent') || '',
        accept: req.get('accept') || '',
      });
      if (!verdict.count) return;
      recordView(pool, {
        path: verdict.path,
        referer: req.get('referer') || '',
        ip: resolveIp(req),
        userAgent: req.get('user-agent') || '',
        ownHosts,
      });
    } catch { /* analytics must never break a page load */ }
  };
}

// ── READING IT BACK ────────────────────────────────────────────────────────

/** Everything the tab shows, in one call. */
export async function audienceReport(pool, { days = 90, now = new Date() } = {}) {
  await ensureAudienceTables(pool);
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(new Date(now).getTime() - (days - 1) * 86400000)
    .toISOString().slice(0, 10);

  const [meta, views, visitors, byPath, byReferrer, signups, actions, earliest] =
    await Promise.all([
      pool.query(`SELECT started_on FROM audience_meta WHERE id = 1`),
      pool.query(
        `SELECT day::text AS day, SUM(views)::int AS views FROM page_views
          WHERE day BETWEEN $1 AND $2 GROUP BY day ORDER BY day`, [from, to]),
      pool.query(
        `SELECT day::text AS day, COUNT(*)::int AS visitors FROM page_visitors
          WHERE day BETWEEN $1 AND $2 GROUP BY day ORDER BY day`, [from, to]),
      pool.query(
        `SELECT path, SUM(views)::int AS views FROM page_views
          WHERE day BETWEEN $1 AND $2 GROUP BY path ORDER BY views DESC LIMIT 15`, [from, to]),
      pool.query(
        `SELECT referrer_host, SUM(views)::int AS views FROM page_views
          WHERE day BETWEEN $1 AND $2 GROUP BY referrer_host ORDER BY views DESC LIMIT 15`,
        [from, to]),
      // ── HISTORY, from dates that were always kept ──────────────────────
      pool.query(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS signups
           FROM users WHERE created_at >= $1::date GROUP BY 1 ORDER BY 1`, [from]),
      // Activity, for session lengths. credits_history goes back furthest —
      // every spend has always been timestamped, so this needed no new tracking.
      pool.query(
        `SELECT user_id, created_at AS at FROM credits_history
          WHERE created_at >= $1::date AND action = 'spend'
          ORDER BY created_at`, [from]),
      pool.query(`SELECT to_char(MIN(created_at), 'YYYY-MM-DD') AS first FROM users`),
    ]);

  const sessions = sessionsFromActions(actions.rows);
  const engagement = dailyEngagement(sessions);

  return {
    range: { from, to, days },
    // Zero is a real reading; a chart that skips quiet days makes a flat week
    // look busy because the empty days simply are not drawn.
    views: fillDays(views.rows, from, to, { views: 0 }),
    visitors: fillDays(visitors.rows, from, to, { visitors: 0 }),
    topPages: byPath.rows,
    referrers: byReferrer.rows,
    signups: fillDays(signups.rows, from, to, { signups: 0 }),
    engagement: fillDays(engagement, from, to, { people: 0, actions: 0, medianMinutes: 0, longestMinutes: 0 }),
    totals: {
      views: views.rows.reduce((n, r) => n + r.views, 0),
      visitors: visitors.rows.reduce((n, r) => n + r.visitors, 0),
      signups: signups.rows.reduce((n, r) => n + r.signups, 0),
    },
    provenance: provenance({
      trackingStartedOn: meta.rows[0]?.started_on
        ? new Date(meta.rows[0].started_on).toISOString().slice(0, 10) : null,
      earliestUser: earliest.rows[0]?.first || null,
    }),
  };
}
