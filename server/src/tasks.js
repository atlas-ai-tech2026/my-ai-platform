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
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tasks_ref_idx ON tasks (ref) WHERE ref IS NOT NULL`);
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
  if (t.ref) {
    // Idempotent by ref, so re-seeding never duplicates a task.
    const { rows } = await pool.query(
      `INSERT INTO tasks (ref, title, detail, why, owner, status, priority, blocked_by, done_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $6::text = 'done' THEN NOW() END)
       ON CONFLICT (ref) DO UPDATE SET
         title=EXCLUDED.title, detail=EXCLUDED.detail, why=EXCLUDED.why,
         owner=EXCLUDED.owner, status=EXCLUDED.status, priority=EXCLUDED.priority,
         blocked_by=EXCLUDED.blocked_by, updated_at=NOW(),
         done_at = CASE WHEN EXCLUDED.status = 'done'
                        THEN COALESCE(tasks.done_at, NOW()) ELSE NULL END
       RETURNING *`,
      [t.ref, t.title, t.detail || null, t.why || null, t.owner || 'claude',
       t.status || 'pending', Number(t.priority ?? 100), t.blocked_by || null]);
    return { ok: true, task: rows[0] };
  }
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, detail, why, owner, status, priority, blocked_by, done_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5::text = 'done' THEN NOW() END) RETURNING *`,
    [t.title, t.detail || null, t.why || null, t.owner || 'claude',
     t.status || 'pending', Number(t.priority ?? 100), t.blocked_by || null]);
  return { ok: true, task: rows[0] };
}

export async function setStatus(pool, id, status) {
  if (!STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' };
  await ensureTasksTable(pool);
  const { rows } = await pool.query(
    // ::text on every re-use of a parameter. Postgres cannot deduce a type for
    // a placeholder used BOTH as a column value and inside a comparison — that
    // is what killed the first seed with "inconsistent types deduced for
    // parameter $6", and node --check cannot see SQL.
    `UPDATE tasks SET status=$2, updated_at=NOW(),
            done_at = CASE WHEN $2::text = 'done' THEN COALESCE(done_at, NOW()) ELSE NULL END
      WHERE id=$1 RETURNING *`, [id, status]);
  if (!rows.length) return { ok: false, error: 'No such task.' };
  return { ok: true, task: rows[0] };
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

  // The owner marks their OWN items done; I keep mine current.
  app.patch('/api/admin/tasks/:id', adminGate, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid task id.' });
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
