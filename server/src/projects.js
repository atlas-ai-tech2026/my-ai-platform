// ─── projects.js ─────────────────────────────────────────────────────────────
// THE BOARD AMR AND MOHANED SHARE.
//
// Their own work together — proposals, demos, follow-ups, the things that are
// mostly not software — tracked where they already look every day instead of
// in a spreadsheet only one of them has open.
//
// ── WHY NOT THE TASKS TAB ──────────────────────────────────────────────────
// The tasks table is the record of what I am building on this platform: seeded
// from code, owner_touched-aware, and refreshed on every boot. This is a board
// two people edit by hand about work I am not doing. Sharing one table would
// have meant each of them permanently filtering the other out, and my seed
// quietly overwriting rows a person had typed.
//
// ── ALL JUDGEMENT IS PURE, ON PURPOSE ──────────────────────────────────────
// Overdue, the KPI counts and the filtering are decided here, without a
// database, so the numbers on the screen can be tested exhaustively. The route
// file does I/O and nothing else.

/** The columns of the board. Free text in the database — see db.js. */
export const STATUSES = ['Not Started', 'In Progress', 'Pending', 'Approval Pending', 'Completed'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const RISKS = ['Low', 'Medium', 'High'];

/**
 * ☠ OVERDUE IS COMPUTED, NEVER STORED.
 *
 * A stored flag is wrong the morning after it is written, and nothing wakes up
 * to fix it. Derived from the end date every time it is asked.
 *
 * A completed project is never overdue however late it was — the board is for
 * deciding what to do next, and there is nothing to do about a finished thing.
 */
export function isOverdue(p, now = new Date()) {
  if (!p?.end_date || p.status === 'Completed') return false;
  const end = new Date(p.end_date);
  if (Number.isNaN(end.getTime())) return false;
  // End of the due DAY, not the moment it begins: something due today is not
  // late at nine in the morning.
  end.setHours(23, 59, 59, 999);
  return end < now;
}

/** What the badge should say — 'Overdue' outranks the stored status. */
export function effectiveStatus(p, now = new Date()) {
  return isOverdue(p, now) ? 'Overdue' : (p?.status || 'Not Started');
}

/** Days until the end date. Negative when it has passed. null when undated. */
export function daysLeft(p, now = new Date()) {
  if (!p?.end_date) return null;
  const end = new Date(p.end_date);
  if (Number.isNaN(end.getTime())) return null;
  const a = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}

/**
 * The numbers across the top.
 *
 * Archived rows are excluded everywhere: archiving is how something leaves the
 * board without being destroyed, and a count that still includes it makes the
 * button look broken.
 */
export function summarise(rows = [], now = new Date()) {
  const live = rows.filter((p) => !p.archived);
  const by = (s) => live.filter((p) => p.status === s).length;
  const money = (k) => live.reduce((sum, p) => sum + (Number(p[k]) || 0), 0);
  const overdue = live.filter((p) => isOverdue(p, now));

  return {
    total: live.length,
    not_started: by('Not Started'),
    in_progress: by('In Progress'),
    pending: by('Pending'),
    approval: by('Approval Pending'),
    completed: by('Completed'),
    overdue: overdue.length,
    // Named so it cannot be read as "everything is fine" — 0 due soon with 9
    // overdue is not a calm week.
    due_this_week: live.filter((p) => {
      const d = daysLeft(p, now);
      return d !== null && d >= 0 && d <= 7 && p.status !== 'Completed';
    }).length,
    budget: money('budget'),
    cost: money('cost'),
    revenue: money('revenue'),
    // Profit is revenue minus cost, NOT budget minus cost. Budget is what was
    // agreed; cost is what it took; revenue is what arrived. Confusing the
    // first two is how a project looks profitable while nobody has paid.
    profit: money('revenue') - money('cost'),
  };
}

/** Counts per owner, biggest first — the bar chart. */
export function byOwner(rows = []) {
  const map = new Map();
  for (const p of rows.filter((r) => !r.archived)) {
    const who = (p.owner || '').trim() || 'Unassigned';
    map.set(who, (map.get(who) || 0) + 1);
  }
  return [...map.entries()].map(([owner, n]) => ({ owner, n })).sort((a, b) => b.n - a.n);
}

/** Counts per effective status, in board order, for the mix. */
export function byStatus(rows = [], now = new Date()) {
  const order = [...STATUSES, 'Overdue'];
  const map = new Map();
  for (const p of rows.filter((r) => !r.archived)) {
    const s = effectiveStatus(p, now);
    map.set(s, (map.get(s) || 0) + 1);
  }
  return order.filter((s) => map.get(s)).map((s) => ({ status: s, n: map.get(s) }));
}

/**
 * One row, cleaned. Everything the screen sends is untrusted text.
 *
 * Returns { ok, value } or { ok:false, error } — never throws, because a bad
 * form field is an ordinary thing a person does, not an exception.
 */
export function cleanProject(body = {}) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const name = str(body.name, 200);
  if (!name) return { ok: false, error: 'A project needs a name.' };

  const oneOf = (v, list, fallback) => (list.includes(String(v)) ? String(v) : fallback);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  };
  // A date the browser could not parse becomes null rather than "Invalid Date",
  // which Postgres rejects with a message nobody can act on.
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

  return {
    ok: true,
    value: {
      name,
      client: str(body.client, 200) || null,
      owner: str(body.owner, 120) || null,
      description: str(body.description, 4000) || null,
      status: oneOf(body.status, STATUSES, 'Not Started'),
      priority: oneOf(body.priority, PRIORITIES, 'Medium'),
      // Completing a project sets it to 100. Leaving "Completed · 60%" on the
      // board is a contradiction somebody has to stop and resolve.
      progress: oneOf(body.status, STATUSES, '') === 'Completed'
        ? 100
        : Math.max(0, Math.min(100, Math.round(Number(body.progress) || 0))),
      risk: oneOf(body.risk, RISKS, 'Medium'),
      start_date: date(body.start_date),
      end_date: date(body.end_date),
      budget: num(body.budget),
      cost: num(body.cost),
      revenue: num(body.revenue),
      currency: str(body.currency, 8) || 'KWD',
      category: str(body.category, 80) || null,
      tags: (Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(','))
        .map((t) => String(t).trim()).filter(Boolean).slice(0, 20),
      notes: str(body.notes, 4000) || null,
    },
  };
}

export const LIST_SQL = `
  SELECT * FROM projects
   WHERE ($1::boolean IS TRUE OR archived = FALSE)
   ORDER BY archived, COALESCE(end_date, '9999-12-31'), id DESC
`;

export const INSERT_SQL = `
  INSERT INTO projects
    (name, client, owner, description, status, priority, progress, risk,
     start_date, end_date, budget, cost, revenue, currency, category, tags, notes, created_by)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
  RETURNING *
`;

export const UPDATE_SQL = `
  UPDATE projects SET
    name=$1, client=$2, owner=$3, description=$4, status=$5, priority=$6, progress=$7,
    risk=$8, start_date=$9, end_date=$10, budget=$11, cost=$12, revenue=$13,
    currency=$14, category=$15, tags=$16, notes=$17, updated_at=NOW()
  WHERE id=$18
  RETURNING *
`;

/** Archive and restore. Deliberately reversible — see the table comment. */
export const ARCHIVE_SQL = `UPDATE projects SET archived=$2, updated_at=NOW() WHERE id=$1 RETURNING *`;

/** The only destructive one, and it is never what a button does by itself. */
export const DELETE_SQL = `DELETE FROM projects WHERE id=$1`;

/** The column order INSERT_SQL and UPDATE_SQL expect. One list, so they cannot drift. */
export const COLUMNS = ['name', 'client', 'owner', 'description', 'status', 'priority',
  'progress', 'risk', 'start_date', 'end_date', 'budget', 'cost', 'revenue',
  'currency', 'category', 'tags', 'notes'];

export const valuesOf = (v) => COLUMNS.map((c) => v[c]);
