// ─── sop-engine.test.js ──────────────────────────────────────────────────────
// The failure this screen exists to prevent is not a crash. It is a line that
// reads OK when it means "not checked" — because that is indistinguishable
// from health, and it is exactly how the restore verification stayed silent
// for thirty days after failing.
//
// So most of these tests are about UNKNOWN never becoming OK, and about every
// non-OK line carrying an action.

import { describe, it, expect } from 'vitest';
import {
  STATE, ZONES, line, worst, buildToday, summarise,
  backupLine, restoreLine, balanceLine, stuckChargesLine, failureRateLine, sweepLine,
} from './sop-engine.js';

const NOW = '2026-08-18T12:00:00Z';
const ago = (h) => new Date(Date.parse(NOW) - h * 36e5).toISOString();

describe('the shape of a line', () => {
  it('refuses a non-OK line with no action — a status with no action is just worry', () => {
    expect(() => line({ key: 'x', zone: 'today', label: 'X', state: STATE.WARN }))
      .toThrow(/must carry an action/);
    expect(() => line({ key: 'x', zone: 'today', label: 'X', state: STATE.CRITICAL }))
      .toThrow(/must carry an action/);
    expect(() => line({ key: 'x', zone: 'today', label: 'X', state: STATE.UNKNOWN }))
      .toThrow(/must carry an action/);
  });

  it('allows an OK line with no action, because there is nothing to do', () => {
    expect(line({ key: 'x', zone: 'today', label: 'X', state: STATE.OK }).state).toBe(STATE.OK);
  });

  it('rejects an unknown zone or state rather than rendering nonsense', () => {
    expect(() => line({ key: 'x', zone: 'nowhere', label: 'X', state: STATE.OK })).toThrow(/zone/);
    expect(() => line({ key: 'x', zone: 'today', label: 'X', state: 'green' })).toThrow(/state/);
  });

  it('has exactly the three zones, ordered by how fast they change', () => {
    expect(ZONES).toEqual(['today', 'integrity', 'posture']);
  });
});

describe('worst — the roll-up never flatters', () => {
  it('lets any bad state beat OK', () => {
    expect(worst([STATE.OK, STATE.OK, STATE.WARN])).toBe(STATE.WARN);
    expect(worst([STATE.OK, STATE.WARN, STATE.CRITICAL])).toBe(STATE.CRITICAL);
  });

  // The whole point: not-checked must never roll up as healthy.
  it('ranks UNKNOWN above OK', () => {
    expect(worst([STATE.OK, STATE.UNKNOWN])).toBe(STATE.UNKNOWN);
  });

  it('is OK only when everything is', () => {
    expect(worst([STATE.OK, STATE.OK])).toBe(STATE.OK);
    expect(worst([])).toBe(STATE.OK);
  });
});

describe('backup', () => {
  it('is OK when recent, encrypted and both copies landed', () => {
    const l = backupLine({ autoBackup: { last_at: ago(3), encrypted: true }, now: NOW });
    expect(l.state).toBe(STATE.OK);
    expect(l.value).toBe('3h ago');
  });

  it('is UNKNOWN — not OK — when nothing has been recorded', () => {
    expect(backupLine({ autoBackup: null, now: NOW }).state).toBe(STATE.UNKNOWN);
  });

  it('is CRITICAL when backups are being written unencrypted', () => {
    const l = backupLine({ autoBackup: { last_at: ago(1), encrypted: false }, now: NOW });
    expect(l.state).toBe(STATE.CRITICAL);
    expect(l.action).toMatch(/BACKUP_ENCRYPTION_PASSPHRASE/);
  });

  it('is CRITICAL once two nights have been missed, not one', () => {
    expect(backupLine({ autoBackup: { last_at: ago(26), encrypted: true }, now: NOW }).state).toBe(STATE.OK);
    expect(backupLine({ autoBackup: { last_at: ago(60), encrypted: true }, now: NOW }).state).toBe(STATE.CRITICAL);
  });

  // One copy because the second FAILED, versus one copy BY DESIGN (dev), are
  // different facts and must not read the same.
  it('warns when a configured second copy failed', () => {
    const l = backupLine({ autoBackup: { last_at: ago(1), encrypted: true, offsite_error: 'cap exceeded' }, now: NOW });
    expect(l.state).toBe(STATE.WARN);
    expect(l.detail).toMatch(/cap exceeded/);
  });

  it('stays OK when one copy is deliberate, and says so', () => {
    const l = backupLine({ autoBackup: { last_at: ago(1), encrypted: true, offsite_skipped: true }, now: NOW });
    expect(l.state).toBe(STATE.OK);
    expect(l.detail).toMatch(/by design/);
  });
});

describe('restore verification', () => {
  it('is CRITICAL when nothing has ever been verified', () => {
    const l = restoreLine({ backupVerify: null, now: NOW });
    expect(l.state).toBe(STATE.CRITICAL);
    expect(l.action).toMatch(/untested backup is a hope/);
  });

  it('is UNKNOWN when the fact was never gathered — silence is not a finding', () => {
    expect(restoreLine({ backupVerify: undefined, now: NOW }).state).toBe(STATE.UNKNOWN);
  });

  // A bandwidth cap and a corrupt archive are different emergencies.
  it('distinguishes unreachable from unreadable in the ACTION', () => {
    const unreachable = restoreLine({ backupVerify: { checked_at: ago(2), ok: false,
      problems: ['could not fetch the offsite archive: cap exceeded'] }, now: NOW });
    expect(unreachable.action).toMatch(/may be fine/);

    const unreadable = restoreLine({ backupVerify: { checked_at: ago(2), ok: false,
      problems: ['the archive could not be decrypted'] }, now: NOW });
    expect(unreadable.action).toMatch(/data at risk/);
  });

  it('warns when the check itself stopped running', () => {
    const l = restoreLine({ backupVerify: { checked_at: ago(24 * 60), ok: true }, now: NOW });
    expect(l.state).toBe(STATE.WARN);
    expect(l.detail).toMatch(/stopped running/);
  });
});

describe('supplier balance is expressed as DAYS, because days prompt action', () => {
  it('shows runway alongside the raw number', () => {
    const l = balanceLine({ credits: 30000, burnPerDay: 5000, now: NOW });
    expect(l.value).toMatch(/~6 days/);
  });

  it('is CRITICAL when it runs out within three days', () => {
    expect(balanceLine({ credits: 6000, burnPerDay: 3000, now: NOW }).state).toBe(STATE.CRITICAL);
  });

  it('is CRITICAL at zero and says generations are failing NOW', () => {
    const l = balanceLine({ credits: 0, burnPerDay: 100, now: NOW });
    expect(l.state).toBe(STATE.CRITICAL);
    expect(l.detail).toMatch(/failing right now/);
  });

  // Unreadable is not zero, and it is not fine.
  it('is UNKNOWN when the provider could not be reached', () => {
    const l = balanceLine({ credits: null, providerError: 'timeout', now: NOW });
    expect(l.state).toBe(STATE.UNKNOWN);
    expect(l.action).toMatch(/not zero/);
  });
});

describe('failure rate', () => {
  it('refuses to compute a rate from too few attempts', () => {
    const l = failureRateLine({ spends: 1, failures: 3, now: NOW });
    expect(l.state).toBe(STATE.OK);
    expect(l.detail).toMatch(/means nothing/);
  });

  // The distinction the 8 August incident turned on.
  it('is CRITICAL when the cause is OUR account being empty', () => {
    const l = failureRateLine({ spends: 50, failures: 30, accountDry: 30, now: NOW });
    expect(l.state).toBe(STATE.CRITICAL);
    expect(l.action).toMatch(/refunds hide it/);
  });

  it('warns on an ordinary elevated rate', () => {
    const l = failureRateLine({ spends: 60, failures: 20, accountDry: 0, now: NOW });
    expect(l.state).toBe(STATE.WARN);
  });
});

describe('stuck charges and the price sweep', () => {
  it('is OK at zero', () => {
    expect(stuckChargesLine({ pending: 0, now: NOW }).state).toBe(STATE.OK);
  });
  it('ignores charges that are merely young', () => {
    expect(stuckChargesLine({ pending: 5, oldestHours: 0.5, now: NOW }).state).toBe(STATE.OK);
  });
  it('escalates once it is a cohort rather than an accident', () => {
    expect(stuckChargesLine({ pending: 3, oldestHours: 5, now: NOW }).state).toBe(STATE.WARN);
    expect(stuckChargesLine({ pending: 40, oldestHours: 5, now: NOW }).state).toBe(STATE.CRITICAL);
  });
  it('reports a sweep that never ran as UNKNOWN, not OK', () => {
    expect(sweepLine({ lastSweepIso: null, now: NOW }).state).toBe(STATE.UNKNOWN);
  });
});

describe('buildToday', () => {
  const healthy = {
    now: NOW,
    autoBackup: { last_at: ago(2), encrypted: true },
    backupVerify: { checked_at: ago(48), ok: true },
    credits: 50000, burnPerDay: 1000,
    pending: 0, oldestHours: null,
    spends: 100, failures: 2, recent: [],
    lastSweepIso: ago(5),
  };

  it('produces one line per check, all in the today zone', () => {
    const lines = buildToday(healthy);
    expect(lines).toHaveLength(6);
    expect(lines.every((l) => l.zone === 'today')).toBe(true);
  });

  it('is all-OK on a healthy system', () => {
    expect(summarise(buildToday(healthy)).state).toBe(STATE.OK);
  });

  // Every line must be explainable — this tab is where "what does this mean?"
  // gets asked most, and the owner made ⓘ a standing rule.
  it('gives every line an explanation and a stable key', () => {
    const lines = buildToday(healthy);
    for (const l of lines) {
      expect(l.info.length, `${l.key} needs an ⓘ explanation`).toBeGreaterThan(40);
      expect(l.key).toMatch(/^[a-z-]+$/);
      expect(l.label.length).toBeGreaterThan(2);
    }
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it('every non-OK line carries an action', () => {
    const lines = buildToday({ ...healthy, autoBackup: null, credits: 0, backupVerify: null });
    for (const l of lines.filter((x) => x.state !== STATE.OK)) {
      expect(l.action.length, `${l.key} is ${l.state} with no action`).toBeGreaterThan(10);
    }
  });

  it('reads the SAME facts the alerts engine uses, so the two cannot disagree', () => {
    // An empty supplier account must surface here exactly as it does in Alerts.
    const dry = { ...healthy, spends: 10, failures: 40,
      recent: Array.from({ length: 40 }, () => ({ reason: 'kie_video_threw: Credits insufficient' })) };
    const failures = buildToday(dry).find((l) => l.key === 'failures');
    expect(failures.state).toBe(STATE.CRITICAL);
  });

  it('rolls a partly-unknown system up as UNKNOWN, never OK', () => {
    const s = summarise(buildToday({ ...healthy, autoBackup: null }));
    expect(s.state).toBe(STATE.UNKNOWN);
  });
});
