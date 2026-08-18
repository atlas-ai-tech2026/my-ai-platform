// ─── sop-schedule.js ─────────────────────────────────────────────────────────
// When each SOP check runs, and letting the owner change it.
//
// ── TWO THINGS THIS GETS RIGHT THAT I GOT WRONG BEFORE ─────────────────────
//
// 1. IT IS NOT A TIMER. The first restore verification used
//    `setInterval(run, 30 days)`. 30 days is 2,592,000,000 ms, which does not
//    fit in a 32-bit signed integer, so Node SILENTLY used 1 ms — it ran 294
//    times in five seconds and exhausted the provider's daily cap. Beyond the
//    overflow, this app redeploys many times a day, and a timer set for weeks
//    ahead on a process that lives for hours would fire approximately never.
//    So due-ness is computed from the LAST RECORDED RUN, held in the database,
//    and a short tick simply asks "is anything due?".
//
// 2. THE CLOCK IS LABELLED. The owner is UTC+3; the server runs UTC. An
//    unlabelled time field is how the expiry table once rendered every date a
//    day early. Times are entered and displayed in KUWAIT time, stored as the
//    hour in UTC, and the screen says which zone it means.

export const KUWAIT_UTC_OFFSET = 3;

/**
 * The jobs, and why each cadence is what it is. Costs differ by orders of
 * magnitude, so one shared schedule would be wrong for almost all of them.
 */
export const JOBS = {
  smoke: {
    label: 'System smoke checks',
    every: 'day',
    defaultHourKuwait: 6,
    info: 'Actually exercises the running system: reads the database, writes and rolls back, '
      + 'resolves the pricing table, reaches storage, and confirms the settings that keep mail '
      + 'and backups working. Cheap and safe — it never leaves a row behind.',
  },
  integrity: {
    label: 'Structure checks',
    every: 'week',
    defaultHourKuwait: 6,
    info: 'Finds a screen promising something no table keeps: a page calling an endpoint that '
      + 'does not exist, a column that is empty in every row, a table nothing reads. These change '
      + 'only when the code changes, so they also run on every deploy.',
  },
  restore: {
    label: 'Backup restore verification',
    every: 'month',
    defaultHourKuwait: 4,
    info: 'Downloads a real backup, decrypts it with your passphrase and checks it against its own '
      + 'record. This is the expensive one — it moves about 5 MB from Backblaze — so it runs '
      + 'monthly and refuses to re-run more than once an hour.',
  },
};

export const EVERY_MS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };

/** Kuwait hour → the UTC hour to store. */
export const kuwaitHourToUtc = (h) => ((Number(h) - KUWAIT_UTC_OFFSET) % 24 + 24) % 24;
/** UTC hour → the Kuwait hour to display. */
export const utcHourToKuwait = (h) => ((Number(h) + KUWAIT_UTC_OFFSET) % 24 + 24) % 24;

export function defaultsFor(job) {
  const j = JOBS[job];
  if (!j) throw new Error(`unknown job: ${job}`);
  return { job, enabled: true, every: j.every, hour_utc: kuwaitHourToUtc(j.defaultHourKuwait) };
}

/**
 * Is this job due? PURE, so every boundary is testable without a clock.
 *
 * Deliberately generous: it fires on the first tick at or after the hour, not
 * only exactly on it. A job that requires the tick to land on a precise minute
 * silently never runs on a server that restarts constantly.
 */
export function isDue(row, { lastRunIso, now = new Date() } = {}) {
  if (!row || row.enabled === false) return { due: false, reason: 'disabled' };
  const period = EVERY_MS[row.every];
  if (!period) return { due: false, reason: `unknown period: ${row.every}` };

  if (!lastRunIso) return { due: true, reason: 'never run' };
  const elapsed = now.getTime() - new Date(lastRunIso).getTime();
  if (!Number.isFinite(elapsed)) return { due: true, reason: 'last run unreadable' };
  if (elapsed < period) {
    return { due: false, reason: `ran ${Math.floor(elapsed / 36e5)}h ago; every ${row.every}` };
  }
  // Past due by period — now wait for the chosen hour so a long-overdue job
  // does not fire at 3am simply because the server happened to restart.
  if (Number.isInteger(row.hour_utc) && now.getUTCHours() !== row.hour_utc) {
    return { due: false, reason: `waiting for ${row.hour_utc}:00 UTC` };
  }
  return { due: true, reason: `last ran ${Math.floor(elapsed / 864e5)}d ago` };
}

export function validate({ job, enabled, every, hourKuwait }) {
  if (!JOBS[job]) return { ok: false, error: `Unknown check: ${job}` };
  if (!EVERY_MS[every]) return { ok: false, error: 'Frequency must be day, week or month.' };
  // Reject an ABSENT hour explicitly. Number(null) and Number('') are both 0,
  // which would pass an integer range check and silently schedule the job for
  // midnight — an hour nobody chose. Same shape as every other bug in this
  // codebase where a missing value quietly became a plausible one.
  if (hourKuwait === null || hourKuwait === undefined || hourKuwait === '') {
    return { ok: false, error: 'Hour must be 0–23.' };
  }
  const h = Number(hourKuwait);
  if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: 'Hour must be 0–23.' };
  return { ok: true, row: { job, enabled: !!enabled, every, hour_utc: kuwaitHourToUtc(h) } };
}

export async function ensureScheduleTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sop_schedule (
      job         TEXT PRIMARY KEY,
      enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
      every       TEXT        NOT NULL,
      hour_utc    INTEGER     NOT NULL,
      last_run_at TIMESTAMPTZ,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  for (const job of Object.keys(JOBS)) {
    const d = defaultsFor(job);
    await pool.query(
      `INSERT INTO sop_schedule (job, enabled, every, hour_utc)
       VALUES ($1,$2,$3,$4) ON CONFLICT (job) DO NOTHING`,
      [d.job, d.enabled, d.every, d.hour_utc]);
  }
}

export async function readSchedule(pool) {
  await ensureScheduleTable(pool);
  const { rows } = await pool.query(`SELECT * FROM sop_schedule ORDER BY job`);
  return rows.map((r) => ({
    ...r,
    hour_kuwait: utcHourToKuwait(r.hour_utc),
    label: JOBS[r.job]?.label || r.job,
    info: JOBS[r.job]?.info || '',
  }));
}

export async function writeSchedule(pool, input) {
  const v = validate(input);
  if (!v.ok) return v;
  await ensureScheduleTable(pool);
  await pool.query(
    `UPDATE sop_schedule SET enabled=$2, every=$3, hour_utc=$4, updated_at=NOW() WHERE job=$1`,
    [v.row.job, v.row.enabled, v.row.every, v.row.hour_utc]);
  return { ok: true };
}

export async function markRan(pool, job) {
  await pool.query(`UPDATE sop_schedule SET last_run_at = NOW() WHERE job = $1`, [job]);
}
