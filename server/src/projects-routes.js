// ─── projects-routes.js ──────────────────────────────────────────────────────
// I/O only. Every judgement — overdue, the KPI counts, what a valid row is —
// lives in projects.js, without a database, so it can be tested exhaustively.
//
// Admin-gated like everything under /api/admin. The board is Amr's and
// Mohaned's; it is not customer-facing and must never become so by accident.

import {
  LIST_SQL, INSERT_SQL, UPDATE_SQL, ARCHIVE_SQL, DELETE_SQL,
  cleanProject, valuesOf, summarise, byOwner, byStatus, STATUSES, toWire,
} from './projects.js';

export function registerProjectRoutes(app, { pool, dbReady, adminGate }) {
  /** The whole board, with the numbers already worked out. */
  app.get('/api/admin/projects', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    try {
      const includeArchived = String(req.query.archived || '') === 'true';
      const { rows } = await pool.query(LIST_SQL, [includeArchived]);
      const now = new Date();
      res.json({
        projects: rows.map(toWire),
        summary: summarise(rows, now),
        by_owner: byOwner(rows),
        by_status: byStatus(rows, now),
        statuses: STATUSES,
      });
    } catch (e) {
      console.error('[projects] list failed:', e.message);
      res.status(500).json({ error: `Could not read the board: ${e.message}` });
    }
  });

  app.post('/api/admin/projects', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const clean = cleanProject(req.body);
    if (!clean.ok) return res.status(400).json({ error: clean.error });
    try {
      const { rows } = await pool.query(INSERT_SQL,
        [...valuesOf(clean.value), req.user?.email || null]);
      console.log(`[projects] added "${clean.value.name}"`);
      res.json({ project: toWire(rows[0]) });
    } catch (e) {
      console.error('[projects] create failed:', e.message);
      res.status(500).json({ error: `Could not save the project: ${e.message}` });
    }
  });

  app.put('/api/admin/projects/:id', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Which project?' });
    const clean = cleanProject(req.body);
    if (!clean.ok) return res.status(400).json({ error: clean.error });
    try {
      const { rows } = await pool.query(UPDATE_SQL, [...valuesOf(clean.value), id]);
      if (!rows[0]) return res.status(404).json({ error: 'That project no longer exists.' });
      res.json({ project: toWire(rows[0]) });
    } catch (e) {
      console.error('[projects] update failed:', e.message);
      res.status(500).json({ error: `Could not save the change: ${e.message}` });
    }
  });

  /**
   * Archive, and un-archive. One route, because a board two people share is
   * exactly where one of them removes something the other still needed, and
   * "where did it go" needs an answer better than "it is gone".
   */
  app.post('/api/admin/projects/:id/archive', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Which project?' });
    const archived = req.body?.archived !== false;
    try {
      const { rows } = await pool.query(ARCHIVE_SQL, [id, archived]);
      if (!rows[0]) return res.status(404).json({ error: 'That project no longer exists.' });
      res.json({ project: toWire(rows[0]) });
    } catch (e) {
      console.error('[projects] archive failed:', e.message);
      res.status(500).json({ error: `Could not archive it: ${e.message}` });
    }
  });

  /**
   * The only destructive route. Archiving is what the board's button does;
   * this exists for a row typed by mistake, and it says so on the screen.
   */
  app.delete('/api/admin/projects/:id', adminGate, async (req, res) => {
    if (!dbReady()) return res.status(503).json({ error: 'Database not configured.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Which project?' });
    try {
      await pool.query(DELETE_SQL, [id]);
      console.log(`[projects] deleted #${id}`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[projects] delete failed:', e.message);
      res.status(500).json({ error: `Could not delete it: ${e.message}` });
    }
  });
}
