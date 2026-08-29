// ─── version-expiry.js ───────────────────────────────────────────────────────
// Old VERSIONS of deleted files stop being kept forever.
//
// ── WHY THIS IS NEEDED ─────────────────────────────────────────────────────
// Versioning is on for the media bucket, deliberately: it is what makes a
// stolen key or a mistaken script survivable, and it protects 66 GiB of
// customer work that exists nowhere else.
//
// But it means a deleted object is not deleted. The bucket writes a delete
// marker and the bytes stay recoverable forever. So the 30-day purge removes a
// picture from the SERVICE — no customer, no support screen, no API can reach
// it — while the file itself lingers indefinitely. Amr is putting a retention
// period into his B2B legal documents, and "permanently deleted" ought to
// eventually be true.
//
// 60 days: a month past the customer's own 30-day window, so a mistake found
// late is still fixable, and destruction genuinely follows.
//
// ══════════════════════════════════════════════════════════════════════════
// ── THE ONE WAY THIS COULD DESTROY THE COMPANY ────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
// An S3 lifecycle rule has TWO expiry settings that look almost identical:
//
//     Expiration                  → deletes the CURRENT, LIVE object
//     NoncurrentVersionExpiration → deletes OLD versions of deleted/overwritten
//                                   objects
//
// The first one, set to 60 days, would delete every customer's live pictures
// and videos sixty days after they were made. Every one. Silently, over
// months, with no error anywhere and nothing to restore from once the
// noncurrent versions aged out behind them.
//
// So this module may ONLY ever produce the second. The rule is built by one
// function, that function cannot express `Expiration`, and a test reads the
// output and fails if the word appears. That is not caution for its own sake:
// the two fields differ by one word in a JSON body nobody would read twice.
// ══════════════════════════════════════════════════════════════════════════

/** A month past the customer's own window, so a late-discovered mistake is
 *  still fixable and destruction genuinely follows. */
export const NONCURRENT_DAYS = 60;

export const RULE_ID = 'voxel-expire-old-versions';

/**
 * The rule, built in one place so it can be read, printed and asserted on.
 *
 * NO `Expiration` key. NO `Prefix` restriction either — old versions of
 * anything in this bucket are equally not needed after 60 days, and a prefix
 * that stopped matching after a rename would silently protect nothing.
 */
export function expiryRule(days = NONCURRENT_DAYS) {
  const n = Math.max(1, Math.floor(Number(days) || NONCURRENT_DAYS));
  return {
    ID: RULE_ID,
    Status: 'Enabled',
    Filter: { Prefix: '' },
    // OLD versions only. Never the live object — see the block above.
    NoncurrentVersionExpiration: { NoncurrentDays: n },
    // A delete marker with nothing behind it is litter; removing it costs
    // nothing and cannot affect a live object by definition.
    Expiration: undefined,
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
  };
}

/**
 * What would change, WITHOUT changing it.
 *
 * Amr reads this before anything is applied. A rule that silently replaced an
 * existing one would be the worst possible surprise on a bucket holding every
 * customer's work.
 */
export function describePlan(existingRules, days = NONCURRENT_DAYS) {
  const rules = Array.isArray(existingRules) ? existingRules : [];
  const mine = rules.find((r) => r?.ID === RULE_ID);
  const others = rules.filter((r) => r?.ID !== RULE_ID);
  // Anything already set to delete LIVE objects is the thing to shout about,
  // whoever put it there.
  const dangerous = rules.filter((r) => r?.Expiration);

  return {
    days,
    alreadySet: Boolean(mine),
    unchanged: Boolean(mine?.NoncurrentVersionExpiration?.NoncurrentDays === days),
    otherRules: others.map((r) => r?.ID || '(unnamed)'),
    dangerousRules: dangerous.map((r) => r?.ID || '(unnamed)'),
    summary: mine
      ? (mine.NoncurrentVersionExpiration?.NoncurrentDays === days
        ? `Already set to ${days} days. Nothing would change.`
        : `Would change from ${mine.NoncurrentVersionExpiration?.NoncurrentDays ?? 'unset'} `
          + `to ${days} days.`)
      : `Would add one rule: old versions of deleted or overwritten files are removed after `
        + `${days} days. LIVE files are never touched.`,
  };
}

/**
 * Apply it, and read it back.
 *
 * @param deps.getRules  () => rules[]        current configuration
 * @param deps.putRules  (rules) => void      write
 * @param deps.days
 * @returns a report; never throws, because a half-applied bucket rule needs to
 *          be described rather than raised.
 */
export async function applyExpiry({ getRules, putRules, days = NONCURRENT_DAYS }) {
  let before = [];
  try {
    before = (await getRules()) || [];
  } catch (e) {
    // "Could not read" is not "there are none". Writing on top of an unknown
    // configuration could remove a rule somebody depends on.
    return { ok: false, stage: 'read', error: e?.message || String(e) };
  }

  const plan = describePlan(before, days);
  if (plan.unchanged) return { ok: true, changed: false, ...plan };

  // Keep every other rule exactly as it was. This function adds one thing; it
  // is not a bucket-configuration manager.
  const next = [...before.filter((r) => r?.ID !== RULE_ID), expiryRule(days)];

  try {
    await putRules(next);
  } catch (e) {
    return { ok: false, stage: 'write', error: e?.message || String(e), ...plan };
  }

  try {
    const after = (await getRules()) || [];
    const mine = after.find((r) => r?.ID === RULE_ID);
    const got = mine?.NoncurrentVersionExpiration?.NoncurrentDays;
    if (got !== days) {
      return { ok: false, stage: 'verify', error: `read back ${got ?? 'nothing'}, expected ${days}`, ...plan };
    }
    // If anything in the bucket now deletes LIVE objects, say so loudly —
    // whether or not this function put it there.
    const live = after.filter((r) => r?.Expiration).map((r) => r?.ID || '(unnamed)');
    return { ok: true, changed: true, verified: true, liveExpiryRules: live, ...plan };
  } catch (e) {
    // Written but unverified. NOT reported as success — an unread bucket
    // configuration is exactly the kind of thing that is assumed for months.
    return { ok: false, stage: 'verify', error: e?.message || String(e), ...plan };
  }
}
