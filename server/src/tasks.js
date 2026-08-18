// ─── tasks.js ────────────────────────────────────────────────────────────────
// Every task and project, in the control panel, where the owner can just look.
//
// WHY THIS EXISTS. The owner asked "what are the pending tasks?" repeatedly —
// and every time the answer came out of a file only I can read. That makes them
// dependent on me for something they should be able to see, and it makes the
// list only as current as my last recital of it.
//
// ── THIS IS NOW THE SINGLE SOURCE OF TRUTH ─────────────────────────────────
// There were three lists: my memory file, my session list, and this. Three
// lists that disagree is worse than one that is merely imperfect. From
// 2026-08-18 the DATABASE is authoritative; my memory file is a pointer to it.
//
// ── IT MUST NOT GO STALE ───────────────────────────────────────────────────
// Updating this is part of doing the work, not a step afterwards — the same
// rule as the Knowledge Base. A task board that lags reality is worse than no
// board, because people stop checking it and then trust it anyway.

export const OWNERS = ['owner', 'claude'];
export const STATUSES = ['pending', 'in_progress', 'blocked', 'done'];

/** Sort order on screen: what needs doing, in the order it should be done. */
const STATUS_RANK = { in_progress: 0, blocked: 1, pending: 2, done: 3 };

export async function ensureTasksTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          SERIAL PRIMARY KEY,
      ref         VARCHAR(16),                    -- the #number we talk in
      title       TEXT        NOT NULL,
      detail      TEXT,
      why         TEXT,                           -- why it matters, in plain words
      owner       VARCHAR(16) NOT NULL DEFAULT 'claude',
      status      VARCHAR(16) NOT NULL DEFAULT 'pending',
      priority    INTEGER     NOT NULL DEFAULT 100,
      blocked_by  TEXT,                           -- what is holding it up
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      done_at     TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status, priority)`);
  // NOT a partial index. `ON CONFLICT (ref)` only matches a partial unique
  // index if the statement repeats the same WHERE clause — which is how the
  // seed failed with "no unique or exclusion constraint matching the ON
  // CONFLICT specification". A plain unique index is simpler and does the same
  // job here, because Postgres already treats NULLs as distinct, so any number
  // of rows may have no ref.
  await pool.query(`DROP INDEX IF EXISTS tasks_ref_idx`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tasks_ref_unique ON tasks (ref)`);
}

export function validate({ title, owner, status, priority }) {
  if (!String(title || '').trim()) return { ok: false, error: 'A task needs a title.' };
  if (owner && !OWNERS.includes(owner)) return { ok: false, error: `Owner must be one of: ${OWNERS.join(', ')}` };
  if (status && !STATUSES.includes(status)) return { ok: false, error: `Status must be one of: ${STATUSES.join(', ')}` };
  if (priority != null && !Number.isInteger(Number(priority))) return { ok: false, error: 'Priority must be a whole number.' };
  return { ok: true };
}

/** Newest-relevant first: doing, then blocked, then waiting, then history. */
export function sortTasks(rows) {
  return [...rows].sort((a, b) => {
    const s = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (s) return s;
    if (a.status === 'done') {
      return new Date(b.done_at || b.updated_at) - new Date(a.done_at || a.updated_at);
    }
    return (a.priority - b.priority) || (a.id - b.id);
  });
}

export function summarise(rows) {
  const by = (o, s) => rows.filter((r) => r.owner === o && r.status === s).length;
  return {
    total: rows.length,
    owner:  { pending: by('owner', 'pending'),  blocked: by('owner', 'blocked'),  done: by('owner', 'done') },
    claude: { pending: by('claude', 'pending'), blocked: by('claude', 'blocked'), done: by('claude', 'done') },
    open: rows.filter((r) => r.status !== 'done').length,
  };
}

export async function listTasks(pool) {
  await ensureTasksTable(pool);
  const { rows } = await pool.query(`SELECT * FROM tasks`);
  return sortTasks(rows);
}

export async function upsertTask(pool, t) {
  const v = validate(t);
  if (!v.ok) return v;
  await ensureTasksTable(pool);
  // NEVER REUSE A PARAMETER. `CASE WHEN $6 = 'done'` alongside `$6` as a
  // column value made Postgres fail with "inconsistent types deduced for
  // parameter $6": the column context says varchar, the comparison says text,
  // and an untyped placeholder cannot be both. Adding ::text did NOT fix it —
  // it just made the deduction conflict explicit.
  //
  // So done_at is computed HERE and passed as its own parameter. Simpler than
  // the SQL that failed, and the whole class of problem disappears.
  const status = t.status || 'pending';
  const doneAt = status === 'done' ? new Date() : null;

  if (t.ref) {
    // Idempotent by ref, so re-seeding never duplicates a task.
    const { rows } = await pool.query(
      `INSERT INTO tasks (ref, title, detail, why, owner, status, priority, blocked_by, done_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (ref) DO UPDATE SET
         title=EXCLUDED.title, detail=EXCLUDED.detail, why=EXCLUDED.why,
         owner=EXCLUDED.owner, status=EXCLUDED.status, priority=EXCLUDED.priority,
         blocked_by=EXCLUDED.blocked_by, updated_at=NOW(),
         done_at = CASE WHEN EXCLUDED.status = 'done'
                        THEN COALESCE(tasks.done_at, EXCLUDED.done_at) ELSE NULL END
       RETURNING *`,
      [t.ref, t.title, t.detail || null, t.why || null, t.owner || 'claude',
       status, Number(t.priority ?? 100), t.blocked_by || null, doneAt]);
    return { ok: true, task: rows[0] };
  }
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, detail, why, owner, status, priority, blocked_by, done_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [t.title, t.detail || null, t.why || null, t.owner || 'claude',
     status, Number(t.priority ?? 100), t.blocked_by || null, doneAt]);
  return { ok: true, task: rows[0] };
}

export async function setStatus(pool, id, status) {
  if (!STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' };
  await ensureTasksTable(pool);
  const { rows } = await pool.query(
    // Same rule: done_at computed here, passed as its own parameter, so $2 is
    // used exactly once.
    `UPDATE tasks SET status=$2, updated_at=NOW(),
            done_at = CASE WHEN $3::timestamptz IS NULL THEN NULL
                           ELSE COALESCE(done_at, $3::timestamptz) END
      WHERE id=$1 RETURNING *`,
    [id, status, status === 'done' ? new Date() : null]);
  if (!rows.length) return { ok: false, error: 'No such task.' };
  return { ok: true, task: rows[0] };
}

/**
 * Move a task up or down within its own owner's list.
 *
 * SWAPS priorities with the neighbour rather than asking the client to compute
 * a number. The client knowing the numbering scheme is how two people end up
 * with different ideas of the order — and the owner asked to change priority,
 * not to learn what 42 means.
 *
 * Only ever reorders WITHIN one owner and one status, because moving a blocked
 * task above a task being worked on would not survive the next sort anyway.
 */
export async function moveTask(pool, id, direction) {
  if (!['up', 'down'].includes(direction)) return { ok: false, error: 'Direction must be up or down.' };
  await ensureTasksTable(pool);

  const { rows: [me] } = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!me) return { ok: false, error: 'No such task.' };

  const neighbour = await pool.query(
    direction === 'up'
      ? `SELECT * FROM tasks WHERE owner=$1 AND status=$2 AND priority < $3
           ORDER BY priority DESC, id DESC LIMIT 1`
      : `SELECT * FROM tasks WHERE owner=$1 AND status=$2 AND priority > $3
           ORDER BY priority ASC, id ASC LIMIT 1`,
    [me.owner, me.status, me.priority]);

  const other = neighbour.rows[0];
  // Already at the end: not an error, just nothing to do. Returning a failure
  // here would put a red toast on a button that behaved correctly.
  if (!other) return { ok: true, moved: false };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE tasks SET priority=$2, updated_at=NOW() WHERE id=$1`, [me.id, other.priority]);
    await client.query(`UPDATE tasks SET priority=$2, updated_at=NOW() WHERE id=$1`, [other.id, me.priority]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, error: e.message };
  } finally { client.release(); }

  return { ok: true, moved: true };
}

export function registerTaskRoutes(app, { pool, dbReady, adminGate }) {
  app.get('/api/admin/tasks', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'The database is not reachable.' });
    try {
      const tasks = await listTasks(pool);
      res.json({ tasks, summary: summarise(tasks) });
    } catch (e) {
      console.error('[tasks] read failed:', e.message);
      res.status(500).json({ error: 'Could not read the task list.' });
    }
  });

  app.post('/api/admin/tasks', adminGate, async (req, res) => {
    try {
      const r = await upsertTask(pool, req.body || {});
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json({ ok: true, task: r.task });
    } catch (e) {
      console.error('[tasks] write failed:', e.message);
      res.status(500).json({ error: 'Could not save the task.' });
    }
  });

  // The owner marks their OWN items done, and sets the order they want things
  // in; I keep mine current.
  app.patch('/api/admin/tasks/:id', adminGate, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid task id.' });

      if (req.body?.move) {
        const m = await moveTask(pool, id, req.body.move);
        if (!m.ok) return res.status(400).json({ error: m.error });
        const tasks = await listTasks(pool);
        return res.json({ ok: true, moved: m.moved, tasks, summary: summarise(tasks) });
      }

      const r = await setStatus(pool, id, req.body?.status);
      if (!r.ok) return res.status(400).json({ error: r.error });
      console.log(`[tasks] #${id} → ${req.body.status} by ${req.user?.email}`);
      const tasks = await listTasks(pool);
      res.json({ ok: true, tasks, summary: summarise(tasks) });
    } catch (e) {
      console.error('[tasks] status change failed:', e.message);
      res.status(500).json({ error: 'Could not update the task.' });
    }
  });
}
