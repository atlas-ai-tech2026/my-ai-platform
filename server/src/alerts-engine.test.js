// ─── alerts-engine.test.js ───────────────────────────────────────────────────
// Written against what actually happened, not invented inputs.
//
// The reason this feature exists at all: a kie balance check ran hourly for
// weeks whose only output was console.error. On 8 August 415 generations failed
// with the provider saying "Credits insufficient" while a workshop was running.
// So the cases below are taken verbatim from the 4,335 refund reasons in
// credits_history, and the tests are aimed at the ways an alert system quietly
// stops being useful: crying wolf, staying silent, or dying on its own bug.

import { describe, it, expect } from 'vitest';
import {
  SEVERITY, isOurAccountDry, providerOf, checkKieBalance, checkAccountDryFailures,
  checkStuckCharges, checkFailureSpike, checkOverallFailureRate, checkSweepStale,
  shouldEmail, evaluateAll, bySeverity, subjectFor, withDefaults,
  DEFAULT_SETTINGS, RENOTIFY_MS, checkBackupRestore,
} from './alerts-engine.js';

// Verbatim from production.
const REAL = {
  falLocked:   'fal_threw: User is locked. Reason: Exhausted balance. Top up your balance',
  kieShort:    'kie_video_threw: Credits insufficient : Your current balance isn’t enough',
  kieTimeout:  'kie_threw: kie.ai timed out after 90s — credits refunded',
  falForbidden:'fal_video_threw: Forbidden',
  nsfw:        'kie_threw: The input or output was flagged as sensitive. Please try again',
  badFormat:   'kie_video_threw: Only jpeg/jpg/png image formats are supported',
};

describe('telling OUR problem from everyone else’s', () => {
  // The distinction the whole feature turns on. An empty supplier account
  // fails every customer at once; a blocked prompt fails one.
  it('recognises the provider refusing because our account is empty', () => {
    expect(isOurAccountDry(REAL.falLocked)).toBe(true);
    expect(isOurAccountDry(REAL.kieShort)).toBe(true);
  });

  it('does NOT treat ordinary failures as an account problem', () => {
    for (const r of [REAL.kieTimeout, REAL.falForbidden, REAL.nsfw, REAL.badFormat]) {
      expect(isOurAccountDry(r), r).toBe(false);
    }
  });

  it('survives junk instead of throwing inside a scheduled job', () => {
    for (const r of [null, undefined, '', 0, {}]) expect(isOurAccountDry(r)).toBe(false);
  });

  it('names which provider refused', () => {
    expect(providerOf(REAL.falLocked)).toBe('fal');
    expect(providerOf(REAL.kieShort)).toBe('kie');
    expect(providerOf('something else')).toBeNull();
  });
});

describe('kie balance — the one we can see coming', () => {
  it('stays quiet when there is plenty', () => {
    expect(checkKieBalance({ credits: 50000 })).toBeNull();
  });

  it('warns below the threshold', () => {
    const a = checkKieBalance({ credits: 7000 });
    expect(a.severity).toBe(SEVERITY.WARNING);
    expect(a.title).toMatch(/below/);
  });

  // Zero is not "nearly empty" — every kie generation is failing right now.
  it('treats empty as critical and says so in the present tense', () => {
    const a = checkKieBalance({ credits: 0 });
    expect(a.severity).toBe(SEVERITY.CRITICAL);
    expect(a.title).toMatch(/empty — generations are failing now/);
  });

  it('escalates when the burn rate says it runs out within days', () => {
    expect(checkKieBalance({ credits: 7000, burnPerDay: 3000 }).severity).toBe(SEVERITY.CRITICAL);
    expect(checkKieBalance({ credits: 7900, burnPerDay: 100 }).severity).toBe(SEVERITY.WARNING);
  });

  it('says how long is left, which is the number that prompts action', () => {
    expect(checkKieBalance({ credits: 6000, burnPerDay: 2000 }).detail).toMatch(/runs out in ~3 days/);
  });

  // A provider outage returns nothing; nothing must not read as zero.
  it('reports no alert rather than an empty balance when the API fails', () => {
    for (const c of [null, undefined, NaN, 'x']) expect(checkKieBalance({ credits: c })).toBeNull();
  });

  // The old console-only check used 3000, low enough for a busy workshop to
  // cross it and hit zero between two hourly runs.
  it('defaults higher than the 3000 the log-only check used', () => {
    expect(DEFAULT_SETTINGS.kie_balance_min).toBeGreaterThan(3000);
  });
});

describe('fal — only catchable from the wreckage', () => {
  // fal publishes no balance endpoint, so there is no early warning to have.
  it('fires on even a few refusals, because empty does not fail selectively', () => {
    const a = checkAccountDryFailures({ recent: [{ reason: REAL.falLocked }, { reason: REAL.falLocked }] });
    expect(a.severity).toBe(SEVERITY.CRITICAL);
    expect(a.detail).toMatch(/fal: 2/);
  });

  it('stays silent when the failures are ordinary', () => {
    expect(checkAccountDryFailures({ recent: [
      { reason: REAL.kieTimeout }, { reason: REAL.nsfw }, { reason: REAL.badFormat },
    ] })).toBeNull();
  });

  it('counts each provider separately when both are dry', () => {
    const a = checkAccountDryFailures({ recent: [
      { reason: REAL.falLocked }, { reason: REAL.kieShort }, { reason: REAL.kieShort },
    ] });
    expect(a.detail).toMatch(/kie: 2/);
    expect(a.detail).toMatch(/fal: 1/);
  });

  // Refunded is not the same as fine. The money came back; the workshop didn't.
  it('says plainly that refunds do not mean nothing went wrong', () => {
    const a = checkAccountDryFailures({ recent: [{ reason: REAL.falLocked }] });
    expect(a.detail).toMatch(/nothing is being delivered/i);
  });
});

describe('stuck charges — the 124-row bug, watched for', () => {
  it('says nothing when none are pending', () => {
    expect(checkStuckCharges({ pending: 0 })).toBeNull();
  });

  it('ignores charges that are merely young', () => {
    expect(checkStuckCharges({ pending: 5, oldestHours: 0.5 })).toBeNull();
  });

  it('escalates once it is a cohort rather than an accident', () => {
    expect(checkStuckCharges({ pending: 3, oldestHours: 5 }).severity).toBe(SEVERITY.WARNING);
    expect(checkStuckCharges({ pending: 40, oldestHours: 5 }).severity).toBe(SEVERITY.CRITICAL);
  });
});

describe('failure spike — without crying wolf', () => {
  // 3 of 4 is 75% and means nothing. This guard is why the panel can be trusted.
  it('refuses to compute a rate from a tiny sample', () => {
    expect(checkFailureSpike({ models: [{ model: 'X', attempts: 4, failures: 3 }] })).toBeNull();
  });

  it('fires on a real rate over a real sample', () => {
    const a = checkFailureSpike({ models: [{ model: 'Kling 3.0 Omni', attempts: 86, failures: 27 }] });
    expect(a.title).toMatch(/Kling 3\.0 Omni is failing 31%/);
  });

  it('leads with the worst and counts the rest', () => {
    const a = checkFailureSpike({ models: [
      { model: 'A', attempts: 100, failures: 18 },
      { model: 'B', attempts: 100, failures: 60 },
    ] });
    expect(a.title).toMatch(/^B /);
    expect(a.detail).toMatch(/1 other model/);
  });

  it('stays quiet at a normal rate', () => {
    expect(checkFailureSpike({ models: [{ model: 'A', attempts: 1000, failures: 20 }] })).toBeNull();
  });
});

describe('overall failure rate — what can honestly be said today', () => {
  // The bug this replaced: the first draft gave EVERY model the total failure
  // count, so every model read as 100% failing and the alert would have fired
  // on all of them at once. An alert that is always on is worse than none.
  it('is what evaluateAll actually runs — not the per-model version', () => {
    const out = evaluateAll(
      { spends: 100, failures: 40, recent: [], pending: 0, models: [], lastSweepIso: null },
      DEFAULT_SETTINGS);
    expect(out.some((a) => a.kind === 'failure_rate')).toBe(true);
    expect(out.some((a) => a.kind === 'failure_spike')).toBe(false);
  });

  it('fires on a genuinely bad hour', () => {
    const a = checkOverallFailureRate({ spends: 200, failures: 60 });
    expect(a.title).toMatch(/30% of generations failed/);
    expect(a.severity).toBe(SEVERITY.CRITICAL);
  });

  it('stays quiet on a normal hour', () => {
    expect(checkOverallFailureRate({ spends: 200, failures: 8 })).toBeNull();
  });

  it('will not compute a rate from a quiet hour', () => {
    expect(checkOverallFailureRate({ spends: 4, failures: 4 })).toBeNull();
  });

  // Saying "which model" when that is not recorded would be the same class of
  // confident-but-wrong the costing work kept running into.
  it('admits it cannot say which model is responsible', () => {
    expect(checkOverallFailureRate({ spends: 100, failures: 30 }).detail)
      .toMatch(/not recorded yet/);
  });
});

describe('the per-model check exists but is deliberately not wired up', () => {
  // Kept and tested so Tier 1.3 can switch it on with the guard already proven.
  it('still refuses tiny samples when it is eventually used', () => {
    expect(checkFailureSpike({ models: [{ model: 'X', attempts: 4, failures: 3 }] })).toBeNull();
  });
});

describe('the sweep quietly not running', () => {
  const now = '2026-08-16T12:00:00Z';
  it('is fine a few hours after the last run', () => {
    expect(checkSweepStale({ lastSweepIso: '2026-08-16T00:00:00Z', now })).toBeNull();
  });
  it('fires once it is well past a day', () => {
    expect(checkSweepStale({ lastSweepIso: '2026-08-14T00:00:00Z', now }).severity).toBe(SEVERITY.WARNING);
  });
  // "Never run" is the panel's own empty state, not an alert on every pass.
  it('does not fire when it has never run', () => {
    expect(checkSweepStale({ lastSweepIso: null, now })).toBeNull();
  });
});

describe('email policy — the difference between useful and ignored', () => {
  const crit = { severity: SEVERITY.CRITICAL };
  const warn = { severity: SEVERITY.WARNING };

  it('emails when an alert first opens', () => {
    expect(shouldEmail(crit, { notifiedAt: null })).toBe(true);
  });

  // Emailing every 5 minutes trains you to filter the sender, and then the one
  // that matters is filtered too.
  it('does not email again on the next pass', () => {
    const now = Date.now();
    expect(shouldEmail(crit, { notifiedAt: new Date(now - 5 * 60e3), now })).toBe(false);
  });

  it('re-nudges only for critical, only after a day', () => {
    const now = Date.now();
    const dayAgo = new Date(now - RENOTIFY_MS - 1000);
    expect(shouldEmail(crit, { notifiedAt: dayAgo, now })).toBe(true);
    expect(shouldEmail(warn, { notifiedAt: dayAgo, now })).toBe(false);
  });

  it('never emails info, and honours the off switch', () => {
    expect(shouldEmail({ severity: SEVERITY.INFO }, {})).toBe(false);
    expect(shouldEmail(crit, { enabled: false })).toBe(false);
  });
});

describe('the list reads worst-first', () => {
  it('sorts critical above warning above info', () => {
    const out = [{ severity: 'info' }, { severity: 'warning' }, { severity: 'critical' }].sort(bySeverity);
    expect(out.map((a) => a.severity)).toEqual(['critical', 'warning', 'info']);
  });

  it('puts the actionable thing in the subject line', () => {
    expect(subjectFor([{ severity: 'critical', title: 'kie.ai balance is empty' }]))
      .toMatch(/kie\.ai balance is empty/);
    expect(subjectFor([])).toMatch(/all clear/);
  });
});

describe('running everything', () => {
  it('returns every firing check, worst first', () => {
    const out = evaluateAll({
      credits: 0,
      recent: [{ reason: REAL.falLocked }],
      pending: 3, oldestHours: 9,
      models: [], lastSweepIso: null, now: '2026-08-16T12:00:00Z',
    });
    expect(out.length).toBe(3);
    expect(out[0].severity).toBe(SEVERITY.CRITICAL);
  });

  it('returns nothing when the system is healthy', () => {
    expect(evaluateAll({
      credits: 90000, recent: [], pending: 0, models: [],
      lastSweepIso: '2026-08-16T00:00:00Z', now: '2026-08-16T06:00:00Z',
    })).toEqual([]);
  });

  // The failure mode this whole file exists to end: something breaks and the
  // system reports success.
  it('surfaces a broken check instead of silently skipping it', () => {
    const out = evaluateAll({
      get credits() { throw new Error('provider exploded'); },
      recent: [], pending: 0, models: [], lastSweepIso: null,
    });
    expect(out.some((a) => a.kind === 'check_error' && /provider exploded/.test(a.detail))).toBe(true);
  });
});

describe('settings', () => {
  it('falls back to defaults for anything unset', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults({ kie_balance_min: null }).kie_balance_min).toBe(DEFAULT_SETTINGS.kie_balance_min);
  });

  it('accepts a numeric string from the database without going NaN', () => {
    expect(withDefaults({ kie_balance_min: '12000' }).kie_balance_min).toBe(12000);
  });
});

// ── the restore-verification check (SOP 1) ─────────────────────────────────
// The interesting case is not "the restore failed". It is "the check quietly
// stopped running", because that state looks identical to everything being
// fine — which is the exact failure this whole feature exists to end.
describe('checkBackupRestore', () => {
  const NOW = '2026-08-17T12:00:00Z';
  const at = (daysAgo) => new Date(Date.parse(NOW) - daysAgo * 864e5).toISOString();

  it('is quiet when a recent verification passed', () => {
    expect(checkBackupRestore(
      { backupVerify: { checked_at: at(3), ok: true, problems: [] }, now: NOW })).toBeNull();
  });

  it('is CRITICAL when nothing has ever been verified', () => {
    const a = checkBackupRestore({ backupVerify: null, now: NOW });
    expect(a.severity).toBe(SEVERITY.CRITICAL);
    expect(a.key).toBe('restore_never_verified');
    expect(a.title).toMatch(/never been test-restored|ever been test-restored/i);
  });

  it('is CRITICAL when the last restore failed, and says why', () => {
    const a = checkBackupRestore({
      backupVerify: { checked_at: at(1), ok: false, problems: ['users: manifest says 593 rows, archive contains 0'] },
      now: NOW });
    expect(a.severity).toBe(SEVERITY.CRITICAL);
    expect(a.detail).toMatch(/archive contains 0/);
  });

  // A failure with no recorded reason must still be a failure, not a crash.
  it('still reports a failure that recorded no reason', () => {
    const a = checkBackupRestore({ backupVerify: { checked_at: at(1), ok: false }, now: NOW });
    expect(a.severity).toBe(SEVERITY.CRITICAL);
    expect(a.detail).toMatch(/without recording a reason/);
  });

  it('warns when the check itself has stopped running', () => {
    const a = checkBackupRestore({ backupVerify: { checked_at: at(60), ok: true, problems: [] }, now: NOW });
    expect(a.key).toBe('restore_verify_stale');
    expect(a.severity).toBe(SEVERITY.WARNING);
    expect(a.value).toBe(60);
  });

  // 35 days, not 30: the check is monthly, so a 30-day limit would fire every
  // time a month ran slightly long and train the owner to ignore it.
  it('tolerates a month that ran slightly long', () => {
    expect(checkBackupRestore(
      { backupVerify: { checked_at: at(33), ok: true, problems: [] }, now: NOW })).toBeNull();
  });

  it('is wired into evaluateAll, not merely exported', () => {
    const alerts = evaluateAll({ backupVerify: null, now: NOW, recent: [], models: [] });
    expect(alerts.map((a) => a.key)).toContain('restore_never_verified');
  });

  // The distinction that keeps this check honest: a caller that never gathered
  // the fact has said nothing about backups, and silence must not become a
  // CRITICAL. Absent abstains; an explicit null is the finding.
  it('says nothing when the fact was never gathered', () => {
    expect(checkBackupRestore({ now: NOW })).toBeNull();
    expect(evaluateAll({ now: NOW, recent: [], models: [] }).map((a) => a.key))
      .not.toContain('restore_never_verified');
  });
});
