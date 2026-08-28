// ─── sync-heartbeat.test.js ──────────────────────────────────────────────────
// The alert that did not exist on the night it was needed.
//
// 2026-08-28: the media sync stopped at 20:15 and copied nothing for two and a
// half hours while customers generated video. Every five minutes throughout,
// the alerts pass logged "0 open · 0 resolved · 0 emailed". There were alerts
// for the restore check going stale, for the provider balance, for stuck
// charges — and none for the backup having stopped.
//
// So the first test is the one that reproduces that night, and the rest are
// about the ways a silence check can quietly lie: a missing record reading as
// healthy, a bad clock reading as recent, an alert that fires when nothing is
// wrong and trains you to ignore it.

import { describe, it, expect } from 'vitest';
import {
  judgeSyncHeartbeat, syncStaleAlert, STALE_AFTER_MIN, CRITICAL_AFTER_MIN, SYNC_FLAG, RECORD_SQL,
} from './sync-heartbeat.js';

const at = (mins) => ({ at: new Date(Date.now() - mins * 60000).toISOString(), objects: 118 });

describe('THE NIGHT THIS IS FOR', () => {
  it('the 2h30m silence would have been raised', () => {
    const v = judgeSyncHeartbeat(at(150));
    expect(v.state).toBe('critical' === v.state ? 'critical' : 'warn');
    expect(['warn', 'critical']).toContain(v.state);
    expect(syncStaleAlert(at(150))).not.toBeNull();
  });

  it('and would have fired at 90 minutes, an hour before it was stumbled on', () => {
    expect(judgeSyncHeartbeat(at(STALE_AFTER_MIN)).state).toBe('warn');
    expect(judgeSyncHeartbeat(at(STALE_AFTER_MIN - 1)).state).toBe('ok');
  });

  it('the alert says what to DO, not just that something is wrong', () => {
    const a = syncStaleAlert(at(400));
    expect(a.detail).toMatch(/ONE place|could not list/);
  });

  it('a long silence is critical, not merely a warning', () => {
    expect(judgeSyncHeartbeat(at(CRITICAL_AFTER_MIN)).state).toBe('critical');
    expect(syncStaleAlert(at(CRITICAL_AFTER_MIN)).severity).toBe('critical');
  });
});

describe('never reassuring when it does not know', () => {
  it('no record at all is UNKNOWN, never ok', () => {
    // "Never run" and "ran a minute ago" are different facts and only one of
    // them is reassuring.
    for (const bad of [null, undefined, {}, { at: null }]) {
      expect(judgeSyncHeartbeat(bad).state, JSON.stringify(bad)).toBe('unknown');
    }
  });

  it('and it raises an alert rather than staying quiet', () => {
    expect(syncStaleAlert(null)).not.toBeNull();
    expect(syncStaleAlert(null).title).toMatch(/never/i);
  });

  it('an unusable timestamp is UNKNOWN, not recent', () => {
    for (const bad of ['not a date', '', 12345678901234567890]) {
      expect(judgeSyncHeartbeat({ at: bad }).state, String(bad)).toBe('unknown');
    }
  });

  it('a future timestamp does not read as healthy', () => {
    // A clock that disagrees with itself must not produce a green tick.
    expect(judgeSyncHeartbeat({ at: new Date(Date.now() + 6e5).toISOString() }).state).toBe('unknown');
  });
});

describe('and quiet when everything is fine', () => {
  it('a recent copy is ok, and says how recent', () => {
    const v = judgeSyncHeartbeat(at(12));
    expect(v.state).toBe('ok');
    expect(v.detail).toMatch(/12 min ago/);
  });

  it('raises NO alert when healthy — one that cries wolf gets ignored', () => {
    expect(syncStaleAlert(at(5))).toBeNull();
    expect(syncStaleAlert(at(STALE_AFTER_MIN - 5))).toBeNull();
  });

  it('reads as hours once it passes one', () => {
    expect(judgeSyncHeartbeat(at(125)).detail).toMatch(/2h 05m ago/);
  });

  it('mentions how much was copied when it knows', () => {
    expect(judgeSyncHeartbeat(at(3)).detail).toMatch(/118 objects/);
  });
});

describe('it survives a deploy and two instances', () => {
  it('is stored in the database, not in memory', () => {
    // A variable resets to "healthy" on every deploy, and this app redeploys
    // several times a day — so a memory heartbeat would never fire.
    expect(RECORD_SQL).toMatch(/INSERT INTO app_flags/);
    expect(SYNC_FLAG).toBe('media_sync_last_ok');
  });

  it('either instance succeeding counts — the row is upserted, not appended', () => {
    expect(RECORD_SQL).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
  });

  it('the timestamp comes from the DATABASE, not from the app', () => {
    // Two instances can disagree about the time. The database cannot disagree
    // with itself.
    expect(RECORD_SQL).toMatch(/NOW\(\)/);
  });
});

describe('the thresholds are defensible', () => {
  it('allow several missed passes before complaining', () => {
    expect(STALE_AFTER_MIN / 15).toBeGreaterThanOrEqual(4);
  });

  it('but do not let a whole night pass in silence', () => {
    expect(STALE_AFTER_MIN).toBeLessThanOrEqual(120);
    expect(CRITICAL_AFTER_MIN).toBeLessThanOrEqual(12 * 60);
  });
});
