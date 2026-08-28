// ─── history-search.js ───────────────────────────────────────────────────────
// Finding things in your own history: by words, by date, by model.
//
// ── THE ONE PROPERTY THAT MATTERS MORE THAN THE FEATURE ────────────────────
// A CUSTOMER MUST ONLY EVER SEE THEIR OWN WORK.
//
// Everything else here is a convenience. This is not. So the user id is the
// FIRST condition, it is not optional, and there is no input — no filter, no
// empty filter, no malformed filter — that can widen it. buildSearch THROWS
// without one rather than building a query that would work.
//
// Every value is a bound parameter. Nothing from the customer is ever
// concatenated into SQL.
//
// ── AND WHY THE COLUMN LIST IS SHORT ───────────────────────────────────────
// The existing history query is `SELECT *`, which returns every field of every
// row — including prompts that run to 2,000 characters in Amr's own logs.
// Sixty of those is over 100 KB of text to draw a grid of squares that shows
// two lines of it, fetched from New York, which measured 0.8–1.6 seconds of
// round trip from where he is sitting.
//
// So this returns what the GRID needs and nothing else. Opening a picture
// fetches that one row in full.
//
// ── ALWAYS AN OPT-IN NARROWING, NEVER A DEFAULT WINDOW ─────────────────────
// No filter means the whole history, newest first — exactly as today. A
// customer who never touches the filter bar must not notice it exists. A
// default date window would make somebody's own library look emptied, which
// is a far worse failure than a slow grid.

/** What a grid cell actually renders. Deliberately short. */
const GRID_FIELDS = `
  id, created_date,
  data->>'type'        AS type,
  data->>'model'       AS model,
  data->>'result_url'  AS result_url,
  data->>'thumb_url'   AS thumb_url,
  data->>'ratio'       AS ratio,
  data->>'saved'       AS saved,
  left(COALESCE(data->>'prompt',''), 200) AS prompt`;

export const MAX_LIMIT = 60;

/** Anything the customer types is a LITERAL. Escape the wildcards so a prompt
 *  containing % or _ searches for those characters rather than matching
 *  everything. */
export function likeLiteral(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Build the search.
 *
 * @returns {{sql, countSql, params, countParams}}
 * @throws  when there is no user — never builds an unscoped query
 */
export function buildSearch({
  userId, name = 'GenerationHistory', type = null, text = '', from = null, to = null,
  models = null, savedOnly = false, limit = MAX_LIMIT, offset = 0,
} = {}) {
  // Not a validation nicety. A query that reaches the database without this is
  // one that returns other people's work.
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
    throw new Error('history search requires a user');
  }

  const params = [Number(userId), name];
  const where = ['user_id = $1', 'name = $2'];

  if (type) { params.push(String(type)); where.push(`data->>'type' = $${params.length}`); }

  const clean = String(text || '').trim();
  if (clean) {
    // Prompt OR model, so typing "seedream" finds them without knowing which
    // box to use. ILIKE for case-insensitivity; scoped to one customer's few
    // hundred rows, so no special index is needed at this size.
    params.push(likeLiteral(clean));
    where.push(`(COALESCE(data->>'prompt','') ILIKE $${params.length} ESCAPE '\\'
              OR COALESCE(data->>'model','')  ILIKE $${params.length} ESCAPE '\\')`);
  }

  if (from) { params.push(from); where.push(`created_date >= $${params.length}::timestamptz`); }
  // Inclusive of the whole end day. A customer picking "to 28 August" means the
  // 28th included; an exclusive bound silently drops that day's work and looks
  // like missing history.
  if (to) { params.push(to); where.push(`created_date < ($${params.length}::timestamptz + interval '1 day')`); }

  const list = (models || []).map((m) => String(m)).filter(Boolean);
  if (list.length) {
    // The explicit ::text[] cast is required — Postgres cannot deduce the type
    // of an untyped array parameter and errors out without it.
    params.push(list);
    where.push(`data->>'model' = ANY($${params.length}::text[])`);
  }

  if (savedOnly) where.push(`data->>'saved' = 'true'`);

  const clause = where.join(' AND ');
  const countParams = [...params];

  params.push(Math.max(1, Math.min(MAX_LIMIT, Number(limit) || MAX_LIMIT)));
  params.push(Math.max(0, Number(offset) || 0));

  return {
    sql: `SELECT ${GRID_FIELDS} FROM entities WHERE ${clause}
          ORDER BY created_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    // Separate, because the customer needs to know 128 matched even though
    // only 60 came back. A grid that loads as you scroll can never otherwise
    // tell you whether you have reached the end.
    countSql: `SELECT count(*)::int AS total FROM entities WHERE ${clause}`,
    params,
    countParams,
  };
}

/** The models this customer has ACTUALLY used, for the filter list.
 *  Offering all 28 when they have used three — most returning nothing — makes
 *  the filter feel broken. */
export const MODELS_USED_SQL = `
  SELECT DISTINCT data->>'model' AS model
    FROM entities
   WHERE user_id = $1 AND name = 'GenerationHistory'
     AND ($2::text IS NULL OR data->>'type' = $2::text)
     AND COALESCE(data->>'model','') <> ''
   ORDER BY 1`;

/** Row → the shape the grid already expects. */
export function toGridItem(row) {
  return {
    id: row.id,
    created_date: row.created_date,
    type: row.type,
    model: row.model,
    result_url: row.result_url,
    thumb_url: row.thumb_url,
    ratio: row.ratio,
    saved: row.saved === 'true',
    prompt: row.prompt || '',
  };
}
