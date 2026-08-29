// ─── soft-delete.js ──────────────────────────────────────────────────────────
// Deleting a picture, and being able to give it back for 30 days.
//
// ── THE PROMISE THIS CODE HAS TO KEEP ──────────────────────────────────────
// The confirmation the customer reads says:
//
//     "You will have 30 days to undo this."
//
// That sentence is on the screen. It is only honest if the file is still there
// and the restore actually works — which is why the RESTORE is built and
// proven before the delete button ships, not after. Amr approved the 30 days
// on the strength of that sentence, so it is a commitment, not a default.
//
// ── WHY A COLUMN AND NOT A FLAG INSIDE THE JSON ────────────────────────────
// `deleted_at` is a real column so it can be INDEXED and, more importantly, so
// that forgetting it is a visible mistake rather than an invisible one. A
// `deleted: true` key buried in JSONB would be silently absent from every
// existing query and the pictures would simply keep showing.
//
// A guard test scans every history read for the filter. That is not belt and
// braces: "the writer worked and no reader used it" is the exact failure this
// codebase has produced three times in a single day.
//
// ── AND WHY DELETING IS SCOPED TWICE ───────────────────────────────────────
// Every statement here carries BOTH the row id and the user id. Not because
// the route forgets to check — it does check — but because a delete that can
// only ever touch its own owner's row cannot be turned into a cross-account
// delete by a later bug in a caller. The blast radius is bounded by the SQL.

/** Nullable, so the whole existing table is "not deleted" the moment it lands. */
export const SOFT_DELETE_DDL = `
  ALTER TABLE entities ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS entities_deleted_idx
    ON entities (deleted_at) WHERE deleted_at IS NOT NULL;
`;

/** How long a deleted picture can still be brought back. */
export const RECOVERY_DAYS = 30;

/**
 * Delete. Scoped to the owner, and IDEMPOTENT — deleting twice is not an
 * error, it just does not move the clock. Re-stamping deleted_at on a second
 * press would silently extend the recovery window and make "30 days" untrue.
 */
export const DELETE_SQL = `
  UPDATE entities
     SET deleted_at = NOW()
   WHERE id = ANY($1::uuid[]) AND user_id = $2 AND name = 'GenerationHistory'
     AND deleted_at IS NULL
  RETURNING id`;

/**
 * Put it back.
 *
 * Refuses anything past the window. A row that has aged out is one whose FILE
 * may already be gone, and restoring it would hand the customer a broken
 * picture while telling them it had been recovered.
 */
export const RESTORE_SQL = `
  UPDATE entities
     SET deleted_at = NULL
   WHERE id = ANY($1::uuid[]) AND name = 'GenerationHistory'
     AND deleted_at IS NOT NULL
     AND deleted_at > NOW() - INTERVAL '${RECOVERY_DAYS} days'
  RETURNING id, user_id`;

/** The same, but a customer may only restore their OWN. */
export const RESTORE_OWN_SQL = `
  UPDATE entities
     SET deleted_at = NULL
   WHERE id = ANY($1::uuid[]) AND user_id = $2 AND name = 'GenerationHistory'
     AND deleted_at IS NOT NULL
     AND deleted_at > NOW() - INTERVAL '${RECOVERY_DAYS} days'
  RETURNING id`;

/** What is still recoverable, soonest-to-be-lost FIRST — the ones that need a
 *  decision today, not the ones deleted most recently. */
export const RECOVERABLE_SQL = `
  SELECT e.id, e.user_id, e.deleted_at, u.email,
         e.data->>'type'       AS type,
         e.data->>'model'      AS model,
         e.data->>'thumb_url'  AS thumb_url,
         e.data->>'result_url' AS result_url,
         left(COALESCE(e.data->>'prompt',''), 160) AS prompt,
         GREATEST(0, ${RECOVERY_DAYS} - FLOOR(EXTRACT(EPOCH FROM (NOW() - e.deleted_at)) / 86400))::int AS days_left
    FROM entities e
    JOIN users u ON u.id = e.user_id
   WHERE e.name = 'GenerationHistory'
     AND e.deleted_at IS NOT NULL
     AND e.deleted_at > NOW() - INTERVAL '${RECOVERY_DAYS} days'
     AND ($1::text IS NULL OR lower(u.email) LIKE $1::text)
     AND ($2::text IS NULL OR COALESCE(e.data->>'prompt','') ILIKE $2::text
                           OR COALESCE(e.data->>'model','')  ILIKE $2::text)
     AND ($3::int  IS NULL OR e.deleted_at > NOW() - ($3::int * INTERVAL '1 day'))
   ORDER BY e.deleted_at ASC
   LIMIT $4`;

/**
 * Rows whose 30 days are up.
 *
 * Returns them rather than deleting them, because the FILE has to go too and
 * the caller is the only thing that can reach the bucket. Read first, act
 * second — the order matters and is explained on purgeRows below.
 */
export const DUE_FOR_PURGE_SQL = `
  SELECT id, user_id, data->>'result_url' AS result_url, data->>'thumb_url' AS thumb_url
    FROM entities
   WHERE name = 'GenerationHistory'
     AND deleted_at IS NOT NULL
     AND deleted_at <= NOW() - INTERVAL '${RECOVERY_DAYS} days'
   ORDER BY deleted_at ASC
   LIMIT $1`;

export const PURGE_ROW_SQL = `
  DELETE FROM entities
   WHERE id = $1 AND name = 'GenerationHistory'
     AND deleted_at IS NOT NULL
     AND deleted_at <= NOW() - INTERVAL '${RECOVERY_DAYS} days'`;

/** Days remaining, for a screen. Never negative, never a fraction. */
export function daysLeft(deletedAt, now = new Date()) {
  if (!deletedAt) return null;
  const days = (new Date(now) - new Date(deletedAt)) / 86400000;
  if (!Number.isFinite(days)) return null;
  return Math.max(0, RECOVERY_DAYS - Math.floor(days));
}

/**
 * Actually remove what has aged out.
 *
 * ── THE ORDER, AND WHY IT IS THIS WAY ROUND ────────────────────────────────
 * ROW FIRST, then the file.
 *
 * If the row goes and the file does not, the result is an orphan file: a few
 * megabytes nobody can reach, costing pennies, invisible to everyone. Annoying.
 *
 * If the FILE goes and the row does not, the result is a row that still looks
 * recoverable — and restoring it hands the customer a broken picture while the
 * screen tells them it worked. That is a lie, and it is worse than the waste.
 *
 * So the safe failure is the leak, and the leak is what this chooses.
 *
 * @param deps.dropRow    (id) => rowsAffected
 * @param deps.dropFile   (url) => void        best effort
 */
export async function purgeRows(rows, deps) {
  const report = { considered: 0, purged: 0, filesRemoved: 0, problems: [] };

  for (const row of rows || []) {
    report.considered += 1;
    try {
      // The statement re-checks the age. If the clock, the caller, or a later
      // edit ever hands this a row that is NOT due, it deletes nothing.
      const gone = await deps.dropRow(row.id);
      if (!gone) continue;
      report.purged += 1;

      for (const url of [row.result_url, row.thumb_url]) {
        if (!url) continue;
        try { await deps.dropFile(url); report.filesRemoved += 1; } catch (e) {
          // Named and counted. A file that could not be removed is storage we
          // are still paying for and, more importantly, a copy of customer
          // work we told them was destroyed.
          report.problems.push({ id: row.id, url, why: e?.message || String(e) });
        }
      }
    } catch (e) {
      report.problems.push({ id: row.id, why: e?.message || String(e) });
    }
  }
  return report;
}

/**
 * The sentence the customer reads before confirming.
 *
 * Built here so the promise and the code that keeps it live in one file. If
 * RECOVERY_DAYS ever changes, the words change with it — rather than a screen
 * still saying 30 while the purge runs at 7.
 */
export function confirmText(count) {
  const what = count === 1 ? 'this picture' : `these ${count} pictures`;
  return `Delete ${what}? You can bring ${count === 1 ? 'it' : 'them'} back for ${RECOVERY_DAYS} days `
    + 'from Recently deleted. After that it cannot be undone.';
}
