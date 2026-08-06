// ─── offers-segments.js ──────────────────────────────────────────────────────
// Turns the create screen's audience filters into ONE parameterised SQL query
// against the real users table.
//
// Two rules this module exists to enforce:
//
//   1. NOTHING the caller sends is ever interpolated into SQL. Every filter
//      contributes a `$n` placeholder and a value; the column names are chosen
//      by this file from a fixed set. A segment builder is exactly the kind of
//      "it's only admin-facing" surface that turns into SQL injection.
//   2. An UNRECOGNISED filter is an error, not a no-op. Silently ignoring a
//      filter would show the owner a preview of 400 clients, then send the
//      offer to a different, larger set — the preview and the send must be the
//      same query, which is why both callers use this one builder.
//
// Filters (AND logic, matching the prototype):
//   plans        — string[]  users.package ∈ set
//   months_min   — number    months since users.created_at ≥ n
//   usage_min    — number    credits spent per month ≥ n
//   inactive_min — number    days since users.last_login_at ≥ n
//   remaining_lt — number    credits remaining as a % of credit_limit < n

export const SEGMENT_KEYS = ['plans', 'months_min', 'usage_min', 'inactive_min', 'remaining_lt'];

export class UnknownFilterError extends Error {
  constructor(key) {
    super(`Unknown segment filter: ${key}`);
    this.name = 'UnknownFilterError';
    this.status = 400;
  }
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the WHERE clause and its parameters.
 * @returns {{ where: string, params: any[] }}
 */
export function buildSegmentQuery(filters = {}) {
  for (const key of Object.keys(filters || {})) {
    if (!SEGMENT_KEYS.includes(key)) throw new UnknownFilterError(key);
  }

  const clauses = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  // Banned or expired accounts are never a marketing audience.
  clauses.push('u.banned = FALSE');
  clauses.push('(u.expires_at IS NULL OR u.expires_at > NOW())');

  const plans = Array.isArray(filters.plans) ? filters.plans.filter(Boolean) : [];
  if (plans.length) clauses.push(`u.package = ANY(${p(plans)})`);

  const months = num(filters.months_min);
  if (months != null) {
    // "Months subscribed" is months since the account was created — Voxel has
    // no subscription start date because it has no subscriptions.
    clauses.push(`u.created_at <= NOW() - (${p(months)} * INTERVAL '1 month')`);
  }

  const inactive = num(filters.inactive_min);
  if (inactive != null) {
    // A user who has NEVER logged in is maximally inactive, so NULL counts as
    // matching. Leaving it out would quietly exclude exactly the dormant
    // accounts a win-back campaign is aimed at.
    clauses.push(`(u.last_login_at IS NULL OR u.last_login_at <= NOW() - (${p(inactive)} * INTERVAL '1 day'))`);
  }

  const remaining = num(filters.remaining_lt);
  if (remaining != null) {
    // Percentage of the granted allowance still unspent. credit_limit 0 would
    // divide by zero, so those rows are excluded rather than crashing.
    clauses.push(`(u.credit_limit > 0 AND (u.credits / u.credit_limit) * 100 < ${p(remaining)})`);
  }

  const usage = num(filters.usage_min);
  if (usage != null) {
    // Average credits spent per month over the last 3 months. Spends are
    // negative in credits_history, hence ABS.
    clauses.push(`(
      SELECT COALESCE(ABS(SUM(ch.amount)) / 3.0, 0)
        FROM credits_history ch
       WHERE ch.user_id = u.id
         AND ch.action = 'spend'
         AND ch.created_at >= NOW() - INTERVAL '3 months'
    ) >= ${p(usage)}`);
  }

  return { where: clauses.join('\n   AND '), params };
}

/** Count + a small sample, for the live preview. One query shape, two uses. */
export async function previewSegment(pool, filters = {}, { sample = 12 } = {}) {
  const { where, params } = buildSegmentQuery(filters);
  const countSql = `SELECT COUNT(*)::int AS n FROM users u WHERE ${where}`;
  const sampleSql = `
    SELECT u.id, u.email, u.display_name, u.package, u.credits, u.credit_limit,
           u.last_login_at, u.created_at
      FROM users u
     WHERE ${where}
     ORDER BY u.created_at DESC
     LIMIT ${Number(sample) > 0 ? Math.min(50, Number(sample)) : 12}`;
  const [c, s] = await Promise.all([
    pool.query(countSql, params),
    pool.query(sampleSql, params),
  ]);
  return { count: c.rows[0]?.n ?? 0, sample: s.rows };
}

/**
 * Is this specific client in the segment RIGHT NOW?
 *
 * The brief requires re-evaluation at redemption time: a client who matched
 * when the campaign was built but no longer does must not redeem a targeted
 * offer. Checking membership against the same builder — rather than against a
 * list frozen at creation — is what makes that true.
 */
export async function clientMatchesSegment(pool, clientId, filters = {}) {
  const { where, params } = buildSegmentQuery(filters);
  params.push(clientId);
  const { rows } = await pool.query(
    `SELECT 1 FROM users u WHERE ${where} AND u.id = $${params.length} LIMIT 1`, params
  );
  return rows.length > 0;
}
