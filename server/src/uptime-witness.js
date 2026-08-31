// ─── uptime-witness.js ───────────────────────────────────────────────────────
// Is anything OUTSIDE this app actually watching it?
//
// ── WHY THIS EXISTS (#79) ──────────────────────────────────────────────────
// /api/ready is a real deep check — it queries Postgres and pings Spaces, and
// answers 503 when either is gone. It has been live on production and dev for
// days with EXACTLY ZERO callers outside our own infrastructure. Built, and
// unreachable in the way that matters: the endpoint is fine, nobody is asking.
//
// So the remaining work is not another endpoint. It is:
//   1. making the owner's five-minute setup VERIFIABLE — after creating the
//      monitor he can see it arriving, rather than trusting that he did it
//      right, and
//   2. noticing if that monitor ever stops.
//
// ── AND (2) IS THE ONE THAT MATTERS LATER ──────────────────────────────────
// A free-tier monitor can lapse, be paused, have its account changed, or be
// quietly disabled. Nothing would say so. You would believe you were covered
// for months. That is strictly worse than knowing you have no monitor — which
// is why the two states are judged DIFFERENTLY below.
//
// ── WHAT THIS CANNOT DO, STATED PLAINLY ────────────────────────────────────
// It cannot tell you the site is down. A dead app runs no checks, by
// construction — that is the whole reason an EXTERNAL monitor is needed and
// nothing in here replaces it. This watches the watchman. Only the watchman
// watches the site.

/** One row in app_flags, same as the media-sync heartbeat next door. */
export const WITNESS_FLAG = 'external_uptime_last_seen';

/** `agent` is stored so the line can name WHICH monitor is checking —
 *  "UptimeRobot, 2 minutes ago" is proof; "something, 2 minutes ago" is not.
 *  Truncated: a user-agent is attacker-controlled text and has no business
 *  being unbounded in a table. No IP is stored — behind DigitalOcean's edge
 *  req.ip is a shared address and the leftmost forwarded header is spoofable,
 *  so it would be a fact that looks like evidence and is not. */
export const RECORD_SQL = `
  INSERT INTO app_flags (key, value)
  VALUES ($1, jsonb_build_object('at', NOW(), 'agent', LEFT($2::text, 120)))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

export const READ_SQL = `SELECT value FROM app_flags WHERE key = $1`;

/**
 * How long silence is allowed.
 *
 * ── SET FROM THE INTERVAL THAT IS ACTUALLY AVAILABLE, NOT THE IDEAL ONE ────
 * I wrote these for the 2-minute interval I recommended. UptimeRobot's free
 * plan does not offer it — 15s, 30s and 1m all require a paid plan, and the
 * fastest free check is FIVE minutes. Amr's monitor runs at 5.
 *
 * So 20 minutes would have been four missed checks, and free-tier scheduling
 * wobbles by design. Forty-five is nine missed checks: far past any jitter, so
 * this cannot cry wolf, and still the same morning rather than the same week.
 *
 * An alert you learn to ignore is worse than no alert — which is the whole
 * reason this number is derived from the real interval instead of the one I
 * would have preferred.
 */
export const STALE_AFTER_MIN = 45;

/** Past this it is not late, it is gone. Twenty-four missed checks at 5m. */
export const GONE_AFTER_MIN = 2 * 60;

/**
 * Anything that is plainly our own infrastructure rather than a monitor.
 *
 * Not a security control — it is not possible to prove who is calling, and it
 * does not need to be. It exists so a browser tab left open on /api/ready, or
 * a curl from this laptop, cannot masquerade as "the monitor is working" and
 * put a green tick on the one line whose entire job is to say nobody is
 * watching.
 */
export function looksInternal(agent = '') {
  return /DigitalOcean|GoogleHC|kube-probe|curl\/|Wget|python-requests|node-fetch|axios/i
    .test(String(agent || ''));
}

/**
 * Should this visit be announced in the log?
 *
 * ── WHY NOT JUST LOG EVERY VISIT ───────────────────────────────────────────
 * A 5-minute monitor is 288 visits a day, per monitor. A line for each would
 * bury the log it lives in, and a log nobody can read is a log nobody reads.
 *
 * ── AND WHY LOG ANYTHING AT ALL ────────────────────────────────────────────
 * Because on the day the monitor was created, NOBODY COULD TELL WHETHER IT HAD
 * ARRIVED. The flag is readable only through the admin screen, so verifying it
 * needed the owner's login — and "ask the owner to look" is exactly the answer
 * this project keeps having to give and should not.
 *
 * So: announce the TRANSITION, and nothing else. The first visit ever, and any
 * visit that ends a silence long enough to have been reported as a problem.
 * Those are the two moments somebody actually wants to read about.
 */
export function shouldAnnounce(previous, now = new Date()) {
  const at = previous?.at ? new Date(previous.at) : null;
  if (!at || Number.isNaN(at.getTime())) return 'first';
  const minutes = (now - at) / 60000;
  return minutes >= STALE_AFTER_MIN ? 'returned' : null;
}

/**
 * Is something outside actually checking?
 *
 * @param last  the stored row's value, or null if nothing has ever called
 * @returns {{state:'ok'|'warn'|'critical'|'unknown', minutes, detail, action}}
 */
export function judgeWitness(last, now = new Date()) {
  const at = last?.at ? new Date(last.at) : null;

  // ── NEVER SEEN IS A KNOWN FACT, NOT AN UNKNOWN ONE ──────────────────────
  // The SOP rule is that a line which could not be DETERMINED says "not
  // checked". This one was determined: nothing has ever called. That is
  // exactly the state #79 exists to report, and it must not hide behind
  // "unknown" as though the check had failed.
  if (!at || Number.isNaN(at.getTime())) {
    return {
      state: 'warn', minutes: null,
      detail: 'no external monitor has ever checked this site',
      action: 'Create a free monitor (UptimeRobot or BetterStack) on '
        + 'https://voxel-ai.ai/api/ready — every 2 minutes, alert after 2 consecutive failures. '
        + 'Nothing inside this app can tell you the site is down; only something outside it can.',
    };
  }

  const minutes = Math.max(0, Math.round((now - at) / 60000));
  const who = last.agent ? ` (${last.agent})` : '';

  // ── HAD ONE AND LOST IT IS WORSE THAN NEVER HAVING ONE ──────────────────
  // A lapsed free tier, a paused monitor, a changed account. Nothing would say
  // so, and you would believe you were covered for months.
  if (minutes >= GONE_AFTER_MIN) {
    return {
      state: 'critical', minutes,
      detail: `the external monitor has not checked for ${minutes} minutes${who} — it was working before`,
      action: 'A monitor that stopped is worse than no monitor, because you believe you are '
        + 'covered. Check the monitoring account: lapsed, paused, or deleted.',
    };
  }
  if (minutes >= STALE_AFTER_MIN) {
    return {
      state: 'warn', minutes,
      detail: `the external monitor last checked ${minutes} minutes ago${who}`,
      action: 'Expected every 2 minutes. Check the monitor is still enabled.',
    };
  }
  return {
    state: 'ok', minutes,
    detail: `an external monitor checked ${minutes === 0 ? 'less than a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`} ago${who}`,
    action: '',
  };
}
