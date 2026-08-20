// ─── backup-freshness.js ─────────────────────────────────────────────────────
// When was the last backup ACTUALLY taken — asked of the buckets, not of a
// variable in this process.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The SOP screen reported "Daily backup — NOT CHECKED · No backup has been
// recorded since this server started" while backups were running perfectly. The
// owner saw it, did not believe the reassurance, and asked. They were right to.
//
// The status was held in a module-level object that is wiped by every restart,
// and the backup runs five minutes after boot. This app deploys several times a
// day, so the line spent much of its life saying "not checked" — which is
// indistinguishable from "the job is dead". A check that cannot tell those two
// apart is not a check; it is a light that flickers for its own reasons.
//
// ── THE RULE THIS FOLLOWS ──────────────────────────────────────────────────
// The same one that fixed the media reminder hours earlier: COUNT THE THING,
// do not trust a flag. A backup object in the bucket, with a date on it, is
// evidence. A variable saying a backup happened is a claim, and it dies with
// the process that made it.
//
// ── BOTH DESTINATIONS, SEPARATELY ──────────────────────────────────────────
// The whole point of the offsite copy is surviving the loss of the DigitalOcean
// account. Reporting a single combined "backup ok" would let the offsite half
// fail silently for weeks while the primary kept the light green — which is the
// exact failure the offsite copy exists to prevent.

/** A backup older than this is stale — the job runs every 24h, so 36 allows one miss. */
export const STALE_AFTER_HOURS = 36;

/** Two misses. Something is wrong, not merely late. */
export const CRITICAL_AFTER_HOURS = 60;

/** Newest object in a listing, by last-modified. Null if there are none. */
export function newest(objects = []) {
  let best = null;
  for (const o of objects) {
    const at = o?.modified ? new Date(o.modified) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    if (!best || at > best.at) best = { key: o.key, at, size: o.size };
  }
  return best;
}

export const hoursSince = (at, now = Date.now()) =>
  at ? (now - new Date(at).getTime()) / 36e5 : null;

/**
 * Judge one destination.
 *
 * `unknown` when the bucket could not be read — never `ok`. Not being able to
 * look is not the same as having looked and been satisfied, and a screen that
 * renders them identically is how a broken check survives for months.
 */
export function judgeDestination({ label, listing, now = Date.now() }) {
  if (!listing || listing.error) {
    return {
      label, state: 'unknown',
      detail: `could not be read: ${listing?.error || 'no response'}`,
      action: 'An unverified backup is not a backup — find out why this bucket could not be listed.',
    };
  }
  const latest = newest(listing.objects || listing);
  if (!latest) {
    return {
      label, state: 'critical',
      detail: 'no backup archive found in this bucket at all',
      action: 'The backup job has never successfully written here. Check the logs for [auto-backup].',
    };
  }
  const age = hoursSince(latest.at, now);
  const when = age < 1 ? `${Math.round(age * 60)} min ago` : `${age.toFixed(1)} h ago`;
  const detail = `${latest.key} — ${when}`;

  if (age > CRITICAL_AFTER_HOURS) {
    return { label, state: 'critical', detail: `${detail} — more than two daily runs missed`,
      action: 'The backup job is not running. Check the logs for [auto-backup] errors.' };
  }
  if (age > STALE_AFTER_HOURS) {
    return { label, state: 'warn', detail: `${detail} — a daily run appears to have been missed`,
      action: 'One run was missed. If it happens again the job is not merely late.' };
  }
  return { label, state: 'ok', detail, action: null };
}

/**
 * Both destinations, judged separately and reported as the worse of the two.
 *
 * Separately ON PURPOSE: a green light that hides a dead offsite copy defeats
 * the reason the offsite copy exists.
 */
export function judgeBackups({ primary, offsite, now = Date.now() }) {
  const rank = { critical: 3, warn: 2, unknown: 1, ok: 0 };
  const parts = [
    judgeDestination({ label: 'DigitalOcean Spaces', listing: primary, now }),
    judgeDestination({ label: 'Backblaze (offsite)', listing: offsite, now }),
  ];
  const worst = parts.reduce((a, b) => (rank[b.state] > rank[a.state] ? b : a));
  return {
    state: worst.state,
    detail: parts.map((p) => `${p.label}: ${p.detail}`).join(' · '),
    action: worst.action,
    parts,
  };
}
