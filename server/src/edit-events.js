// ─── edit-events.js ──────────────────────────────────────────────────────────
// The number that decides whether Phase 2 of the editor gets built.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Phase 1 of /edit runs entirely in the customer's browser and costs $0/month.
// Phase 2 adds a dedicated render worker at $12–24/month — which, at the agreed
// margin, is about ONE extra Basic subscription. That is a cheap decision to
// get right and an expensive one to guess at, so it is decided on a count
// instead of on a feeling.
//
// The question this answers, in a month: DOES ANYBODY ACTUALLY EDIT? If the
// answer is a handful of edits by two people, the worker is not worth buying
// and Phase 1 was the correct size of bet. If it is hundreds, the worker pays
// for itself immediately.
//
// ── THE MISTAKE THIS FILE DELIBERATELY DOES NOT REPEAT ─────────────────────
// The /edit waitlist collected addresses that nothing displayed, which made it
// indistinguishable from collecting nothing. The lesson written into
// waitlist.js is that data nobody can see repeats the bug one layer down. So
// the admin summary below is not an extra — it is the whole point, and it ships
// in the same commit as the recording.
//
// ── WHAT IS NOT STORED ─────────────────────────────────────────────────────
// No prompt, no filename, no video, no URL. Editing happens on the customer's
// own machine and nothing about their content ever reaches the server; storing
// it here would create a record of private work in exchange for a number that
// does not need it. Only WHICH operations ran, HOW MANY, and WHEN.

/** Operation names accepted from the client, so a typo cannot invent a column. */
const KNOWN_OPS = new Set([
  'trim', 'concat', 'resize', 'overlay', 'addText', 'mixAudio', 'volume', 'speed',
]);

// Created on first use, like the expenses and audience tables — this codebase
// does not have a migration step, and a table created only at boot is a table
// missing in every environment that was already running.
//
// Memoised so a busy day is not a CREATE TABLE IF NOT EXISTS per edit; reset on
// failure so a transient error does not leave it permanently believing the
// table exists.
let ensured = null;
export function ensureEditEventTables(pool) {
  if (!ensured) ensured = createTables(pool).catch((e) => { ensured = null; throw e; });
  return ensured;
}

async function createTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS edit_events (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      operations TEXT[]      NOT NULL DEFAULT '{}',
      steps      SMALLINT    NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS edit_events_created_idx ON edit_events (created_at DESC)`);
}

/**
 * Record one completed edit.
 *
 * Unknown operation names are DROPPED rather than stored. A client that starts
 * sending something new would otherwise quietly widen what this table holds,
 * and the summary below would grow a row nobody chose.
 */
export async function recordEdit(pool, { userId = null, operations = [], steps = 0 }) {
  await ensureEditEventTables(pool);
  const ops = (Array.isArray(operations) ? operations : [])
    .map((o) => String(o))
    .filter((o) => KNOWN_OPS.has(o))
    .slice(0, 20);
  const n = Number.isFinite(Number(steps)) ? Math.max(0, Math.min(20, Number(steps))) : ops.length;

  await pool.query(
    `INSERT INTO edit_events (user_id, operations, steps) VALUES ($1, $2, $3)`,
    [userId, ops, n]);
  return { ok: true, operations: ops, steps: n };
}

/**
 * The Phase 2 decision, on one screen.
 *
 * PEOPLE, not just edits. Five hundred edits by one enthusiast is a different
 * business case from fifty edits by forty customers — the first is one person's
 * hobby, the second is a feature the product needs. Reporting only a total
 * would hide exactly the distinction the decision turns on.
 */
export async function editSummary(pool, { days = 30 } = {}) {
  await ensureEditEventTables(pool);
  const [totals, byOp, daily] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int                     AS edits,
             COUNT(DISTINCT user_id)::int      AS people,
             COALESCE(AVG(steps), 0)::float    AS avg_steps
        FROM edit_events
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL`, [days]),
    pool.query(`
      SELECT op, COUNT(*)::int AS uses
        FROM edit_events, UNNEST(operations) AS op
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY op ORDER BY uses DESC`, [days]),
    pool.query(`
      SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS edits
        FROM edit_events
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY 1 ORDER BY 1`, [days]),
  ]);

  const t = totals.rows[0] || { edits: 0, people: 0, avg_steps: 0 };
  return {
    days,
    edits: t.edits,
    people: t.people,
    avgSteps: Math.round((t.avg_steps || 0) * 10) / 10,
    byOperation: byOp.rows,
    daily: daily.rows,
    // Stated rather than left to be inferred, because the whole table exists
    // to answer this one question and the answer should not require arithmetic.
    verdict: t.edits === 0
      ? 'Nobody has edited yet — Phase 1 has not been used, so the worker is not worth buying.'
      : t.people <= 2
        ? `${t.edits} edits, but only ${t.people} ${t.people === 1 ? 'person' : 'people'} — not yet evidence of demand.`
        : `${t.edits} edits by ${t.people} people. Real usage — the $12–24/mo worker is roughly ONE Basic subscription.`,
  };
}

export function registerEditEventRoutes(app, { pool, dbReady, verifyJwt, adminGate, limiter }) {
  // Signed in only: an anonymous visitor cannot edit, so an anonymous event is
  // either a mistake or noise, and either way it would corrupt the people count
  // this decision rests on.
  app.post('/api/edit-events', limiter, verifyJwt, async (req, res) => {
    // A failed count must NEVER break an edit that already worked. The customer
    // has their video; whether the analytics landed is the platform's problem.
    if (!dbReady()) return res.json({ ok: true, recorded: false });
    try {
      await recordEdit(pool, {
        userId: req.user?.sub || req.user?.id || null,
        operations: req.body?.operations,
        steps: req.body?.steps,
      });
      res.json({ ok: true, recorded: true });
    } catch (e) {
      console.error('[edit-events] could not record:', e.message);
      res.json({ ok: true, recorded: false });
    }
  });

  // Collecting a number nobody can see would repeat the waitlist bug one layer
  // down, so this ships in the same commit as the recording above.
  app.get('/api/admin/edit-events', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not ready' });
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
      res.json(await editSummary(pool, { days }));
    } catch (e) {
      console.error('[edit-events] summary failed:', e.message);
      res.status(500).json({ error: 'Could not read edit activity' });
    }
  });
}
