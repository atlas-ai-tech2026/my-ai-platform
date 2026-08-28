// ─── sync-heartbeat.js ───────────────────────────────────────────────────────
// Has the offsite copy actually run recently?
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// On 2026-08-28 the media sync stopped at 20:15 and did nothing for two and a
// half hours. Customers generated video all evening; every one of those files
// existed in a single bucket. Meanwhile the alerts pass logged, every five
// minutes, without irony:
//
//     [alerts] 0 open · 0 resolved · 0 emailed
//
// Nothing was watching whether the backup was still backing up. It was found
// because Amr asked an unrelated question about storage costs and I went
// looking for a number.
//
// That is the house failure verbatim — a thing that worked exactly as written
// and helped nobody. There were alerts for the RESTORE check going stale, for
// the provider balance, for stuck charges. There was none for "the backup has
// stopped", which is the one that mattered tonight.
//
// ── WHY IT IS A ROW AND NOT A VARIABLE ─────────────────────────────────────
// A timestamp in process memory says nothing after a deploy — and this app
// redeploys several times a day, so a memory-based heartbeat would reset to
// "healthy" every time and never fire. It also has to be true across TWO
// instances: either one completing a pass is proof the backup is alive.
//
// So it is one row in app_flags, written by whichever instance succeeds, read
// by both. The same reasoning that moved the video charges out of a Map.

/** The single row. */
export const SYNC_FLAG = 'media_sync_last_ok';

export const RECORD_SQL = `
  INSERT INTO app_flags (key, value)
  VALUES ($1, jsonb_build_object('at', NOW(), 'objects', $2::int, 'bytes', $3::bigint))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

export const READ_SQL = `SELECT value FROM app_flags WHERE key = $1`;

/**
 * How long silence is allowed before it is a problem.
 *
 * The sync runs every 15 minutes. Ninety minutes is six missed passes — long
 * enough that a slow catch-up or one bad pass never wakes anybody, short
 * enough that tonight's outage would have been raised at 21:45 instead of
 * being stumbled over at 22:45.
 */
export const STALE_AFTER_MIN = 90;

/** Past this it is not "behind", it is off. */
export const CRITICAL_AFTER_MIN = 6 * 60;

/**
 * Is the offsite copy still alive?
 *
 * @param last  the stored row's value, or null if it has never run
 * @param now   ISO string or Date
 * @returns {{state:'ok'|'warn'|'critical'|'unknown', minutes, detail, action}}
 */
export function judgeSyncHeartbeat(last, now = new Date()) {
  // NEVER 'ok'. "No record" and "ran a minute ago" are different facts and
  // only one of them is reassuring — the whole reason the SOP tab exists.
  if (!last?.at) {
    return {
      state: 'unknown', minutes: null,
      detail: 'no successful offsite copy has ever been recorded',
      action: 'Either the sync has never run, or it has never finished a pass. Check the logs for '
        + '[media-sync] before assuming the backup is fine.',
    };
  }

  const minutes = Math.floor((new Date(now) - new Date(last.at)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) {
    // A clock that disagrees with itself must not read as healthy.
    return {
      state: 'unknown', minutes: null,
      detail: `the last recorded copy has an unusable timestamp (${last.at})`,
      action: 'Check the server clock — a backup age cannot be trusted while this is wrong.',
    };
  }

  const ago = minutes < 60 ? `${minutes} min ago`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m ago`;

  if (minutes >= CRITICAL_AFTER_MIN) {
    return {
      state: 'critical', minutes,
      detail: `nothing has been copied offsite for ${ago}`,
      action: 'The offsite backup has stopped. Everything generated since then exists in ONE place. '
        + 'Restarting the app has always cleared this; check the logs for "could not list the offsite bucket".',
    };
  }
  if (minutes >= STALE_AFTER_MIN) {
    return {
      state: 'warn', minutes,
      detail: `the last successful offsite copy was ${ago} — the sync runs every 15 minutes`,
      action: 'Six passes have been missed. Check [media-sync] in the logs before assuming it is catching up.',
    };
  }
  return {
    state: 'ok', minutes,
    detail: `last copied offsite ${ago}`
      + (last.objects ? ` (${Number(last.objects).toLocaleString()} objects)` : ''),
    action: null,
  };
}

/**
 * The alert, in the shape the engine already uses.
 * Returns null when there is nothing wrong — an alert that fires on healthy is
 * an alert people learn to ignore.
 */
export function syncStaleAlert(last, now = new Date()) {
  const v = judgeSyncHeartbeat(last, now);
  if (v.state === 'ok') return null;
  return {
    key: 'media_sync_stale',
    kind: 'media_sync',
    severity: v.state === 'critical' ? 'critical' : 'warning',
    title: v.state === 'unknown'
      ? 'The offsite backup has never recorded a successful copy'
      : 'The offsite backup has stopped copying',
    detail: `${v.detail}. ${v.action}`,
    value: v.minutes,
  };
}
