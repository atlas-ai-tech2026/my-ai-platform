// ─── uptime-witness.test.js ──────────────────────────────────────────────────
// Is anything OUTSIDE this app watching it?
//
// /api/ready is a real deep check — it queries Postgres, pings Spaces, and
// answers 503 when either is gone. It has been live on production for days
// with ZERO callers from outside our own infrastructure. Built, and unreachable
// in the way that matters.
//
// These tests guard the two things that make this line worth having:
//   1. it can never say "fine" when nobody is watching
//   2. "had a monitor and lost it" is treated as WORSE than "never had one"

import { describe, it, expect } from 'vitest';
import {
  judgeWitness, looksInternal, shouldAnnounce, RECORD_SQL, READ_SQL,
  STALE_AFTER_MIN, GONE_AFTER_MIN, WITNESS_FLAG,
} from './uptime-witness.js';

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

describe('☠ IT CAN NEVER SAY FINE WHEN NOBODY IS WATCHING', () => {
  it('never called at all is a WARNING, not ok and not unknown', () => {
    // "Unknown" would be hiding behind the SOP's own not-checked convention.
    // This was determined: nothing has ever called. It is the exact state #79
    // exists to report.
    const v = judgeWitness(null);
    expect(v.state).toBe('warn');
    expect(v.detail).toMatch(/no external monitor has ever checked/i);
  });

  it('and it says how to fix it, with the endpoint and the interval', () => {
    const v = judgeWitness(null);
    expect(v.action).toMatch(/api\/ready/);
    expect(v.action).toMatch(/2 minutes/);
    expect(v.action).toMatch(/nothing inside this app/i);
  });

  it('a malformed timestamp is treated as never, not as recent', () => {
    for (const bad of [{ at: 'not a date' }, { at: null }, {}, { at: '' }]) {
      expect(judgeWitness(bad).state).toBe('warn');
    }
  });
});

describe('☠ LOSING A MONITOR IS WORSE THAN NEVER HAVING ONE', () => {
  it('a monitor that stopped is CRITICAL', () => {
    // You believe you are covered and you are not. A lapsed free tier, a
    // paused monitor, a changed account — nothing else would ever say so.
    const v = judgeWitness({ at: ago(GONE_AFTER_MIN + 5), agent: 'UptimeRobot' });
    expect(v.state).toBe('critical');
    expect(v.detail).toMatch(/was working before/i);
  });

  it('which is a harder state than never having had one', () => {
    const never = judgeWitness(null);
    const lost = judgeWitness({ at: ago(GONE_AFTER_MIN + 5) });
    expect(never.state).toBe('warn');
    expect(lost.state).toBe('critical');
  });

  it('merely late is a warning, not a crisis', () => {
    expect(judgeWitness({ at: ago(STALE_AFTER_MIN + 1) }).state).toBe('warn');
  });

  it('recent is ok, and names who checked', () => {
    const v = judgeWitness({ at: ago(2), agent: 'UptimeRobot/2.0' });
    expect(v.state).toBe('ok');
    expect(v.detail).toMatch(/UptimeRobot/);
  });

  it('the thresholds are set from the interval that ACTUALLY exists', () => {
    // I wrote these for a 2-minute interval. UptimeRobot's free plan does not
    // sell one — 15s, 30s and 1m are all paid, and the fastest free check is
    // FIVE minutes, which is what Amr's monitor runs at.
    //
    // So the floor is expressed in MISSED CHECKS at the real interval, not in
    // minutes: anything under about eight missed checks would cry wolf on
    // ordinary free-tier scheduling wobble, and an alert you learn to ignore
    // is worse than no alert.
    const REAL_INTERVAL_MIN = 5;
    expect(STALE_AFTER_MIN / REAL_INTERVAL_MIN).toBeGreaterThanOrEqual(8);
    expect(GONE_AFTER_MIN).toBeGreaterThan(STALE_AFTER_MIN);
  });
});

describe('☠ OUR OWN TRAFFIC MUST NOT COUNT AS A MONITOR', () => {
  it('ignores the platform probe, curl, and script clients', () => {
    // Otherwise a browser tab left open, or one curl from a laptop, puts a
    // green tick on the one line whose job is to say nobody is watching.
    for (const a of ['DigitalOcean/1.0', 'GoogleHC/1.0', 'kube-probe/1.28',
      'curl/8.4.0', 'Wget/1.21', 'python-requests/2.31', 'node-fetch/3', 'axios/1.6']) {
      expect(looksInternal(a), a).toBe(true);
    }
  });

  it('but a real monitor counts', () => {
    for (const a of ['UptimeRobot/2.0', 'Better Uptime Bot', 'Pingdom.com_bot', 'StatusCake']) {
      expect(looksInternal(a), a).toBe(false);
    }
  });

  it('and an empty or missing agent is not treated as internal', () => {
    // Failing OPEN here would let anything through; failing CLOSED would hide
    // a real monitor that sends no agent. The line names who checked, so a
    // nameless caller is visible rather than silently trusted.
    expect(looksInternal('')).toBe(false);
    expect(looksInternal(undefined)).toBe(false);
  });
});

describe('what gets stored', () => {
  it('records a timestamp and a truncated agent — and no IP', () => {
    // Behind DigitalOcean's edge req.ip is a shared address and the leftmost
    // forwarded header is spoofable, so an IP would be a fact that looks like
    // evidence and is not.
    expect(RECORD_SQL).toMatch(/LEFT\(\$2::text, 120\)/);
    expect(RECORD_SQL).not.toMatch(/\bip\b/i);
  });

  it('writes one row, upserted — two instances must not fight', () => {
    expect(RECORD_SQL).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(WITNESS_FLAG).toBe('external_uptime_last_seen');
  });

  it('the read is a read', () => {
    expect(READ_SQL).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/i);
  });
});

// ─── ADDED the day the monitor was created ───────────────────────────────────
// On that day nobody could tell whether it had ARRIVED. The flag is readable
// only through the admin screen, so verifying it needed the owner's login —
// "ask the owner to look" is exactly the answer this project keeps having to
// give and should not.
describe('☠ ARRIVAL IS ANNOUNCED, SILENCE IS NOT SPAMMED', () => {
  it('the very first check ever is announced', () => {
    expect(shouldAnnounce(null)).toBe('first');
    expect(shouldAnnounce({ at: 'nonsense' })).toBe('first');
    expect(shouldAnnounce({})).toBe('first');
  });

  it('a check that ends a long silence is announced as RETURNED', () => {
    // Distinguished from 'first' on purpose: "it started working" and "it
    // started working AGAIN" are different stories, and the second one means
    // something was wrong that nobody was told about.
    expect(shouldAnnounce({ at: ago(STALE_AFTER_MIN + 1) })).toBe('returned');
  });

  it('☠ but ordinary visits say NOTHING — 288 a day would bury the log', () => {
    for (const m of [0, 1, 5, 10, STALE_AFTER_MIN - 1]) {
      expect(shouldAnnounce({ at: ago(m) }), `${m} minutes ago`).toBeNull();
    }
  });

  it('the announcement threshold is the same one the SOP line warns at', () => {
    // If they drifted apart, the log would go quiet about a gap the screen was
    // calling a problem, or announce a return to something never reported.
    expect(shouldAnnounce({ at: ago(STALE_AFTER_MIN) })).toBe('returned');
    expect(shouldAnnounce({ at: ago(STALE_AFTER_MIN - 0.5) })).toBeNull();
  });
});
