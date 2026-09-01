// ─── preflight.test.js ───────────────────────────────────────────────────────
// THE CHECK BEFORE A ROOM FULL OF PEOPLE.
//
// A pre-flight screen has one catastrophic failure mode, and it is not being
// wrong. It is saying READY when it does not know. Someone reads "Ready to
// start", stands up in front of twenty people, and the thing it could not
// check is the thing that breaks — exactly as on 8 August.
//
// So most of these tests are about the difference between "fine" and "could
// not tell", which this codebase has got wrong before: a zero that meant
// unknown, a green backup over 111 failed verifications, "0 remaining" from a
// count that threw.

import { describe, it, expect } from 'vitest';

import {
  judgePreflight, verdictOf, alertsCheck, balanceCheck, modelsCheck, cohortCheck,
  check, worst, runwayNote, CHECK_ORDER,
} from './preflight.js';
import { STATE, worst as sopWorst } from './sop-engine.js';

const ok = (key) => check({ key, label: key, state: STATE.OK, info: 'x' });

describe('☠ IT NEVER SAYS READY OVER A CHECK THAT DID NOT RUN', () => {
  it('an unreadable alert list is NOT ready', () => {
    const v = verdictOf([ok('a'), alertsCheck({ error: 'db down' })]);
    expect(v.go).toBe(false);
    expect(v.headline).toMatch(/could not run/);
  });

  it('an unreadable balance is NOT ready', () => {
    // The 8 August failure exactly: the balance was the thing nobody could see.
    const v = verdictOf([ok('a'), balanceCheck({ balanceLine: null })]);
    expect(v.go).toBe(false);
  });

  it('"nothing to avoid" out of NOTHING JUDGED is unknown, not green', () => {
    // The subtle one. Zero models marked "avoid" reads as good news, and is
    // meaningless when no model had enough attempts to be judged at all.
    const c = modelsCheck({ summary: { judged: 0, min_attempts: 30 }, models: [] });
    expect(c.state).toBe(STATE.UNKNOWN);
    expect(c.action).toMatch(/Nothing here says the models are FINE/i);
  });

  it('and no cohort chosen is unknown — not a pass by default', () => {
    expect(cohortCheck({ code: null }).state).toBe(STATE.UNKNOWN);
    expect(verdictOf([cohortCheck({ code: null })]).go).toBe(false);
  });

  it('every unknown state is reported, not summarised away', () => {
    const v = verdictOf([alertsCheck({ error: 'x' }), modelsCheck({ error: 'y' })]);
    expect(v.headline).toMatch(/2 check\(s\)/);
  });
});

describe('☠ THE FOUR SILENT WAYS A COHORT ARRIVES AT A LOCKED DOOR', () => {
  const live = { code: 'VOXEL20', active: true, max_redemptions: 20, redeemed_count: 5, expires_at: null };

  it('the code was switched off', () => {
    const c = cohortCheck({ code: { ...live, active: false } });
    expect(c.state).toBe(STATE.CRITICAL);
    expect(c.detail).toMatch(/switched OFF/);
  });

  it('the code expired', () => {
    const c = cohortCheck({ code: { ...live, expires_at: '2026-08-01' }, now: new Date('2026-09-01') });
    expect(c.state).toBe(STATE.CRITICAL);
    expect(c.action).toMatch(/Extend the expiry/);
  });

  it('every use has been taken', () => {
    const c = cohortCheck({ code: { ...live, redeemed_count: 20 } });
    expect(c.state).toBe(STATE.CRITICAL);
    expect(c.detail).toMatch(/next person is refused/);
  });

  it('☠ the credits already died, while the code looks perfect', () => {
    // Credits die 30 days after they are added. A code redeemed at a previous
    // session still validates and grants nothing — the code is green and the
    // attendee has zero. Nothing else on any screen puts these together.
    const c = cohortCheck({ code: live, expiringToday: 6 });
    expect(c.state).toBe(STATE.CRITICAL);
    expect(c.detail).toMatch(/die today/);
    expect(c.action).toMatch(/stops at their first click/);
  });

  it('a dead-credit cohort outranks a merely incomplete one', () => {
    // Both are true at once; the blocking one must win.
    const c = cohortCheck({ code: live, expiringToday: 6, invites: { waitingCount: 9 } });
    expect(c.state).toBe(STATE.CRITICAL);
  });

  it('people invited who never signed up is a warning, not a block', () => {
    // The room can still run; it is fixable in seconds if you know.
    const c = cohortCheck({ code: live, invites: { waitingCount: 9 }, expiringToday: 0 });
    expect(c.state).toBe(STATE.WARN);
    expect(c.action).toMatch(/personal email/i);
  });

  it('a healthy cohort says how many spare uses are left', () => {
    const c = cohortCheck({ code: live, invites: { waitingCount: 0 }, expiringToday: 0 });
    expect(c.state).toBe(STATE.OK);
    expect(c.detail).toMatch(/15 use\(s\) spare/);
  });

  it('an uncapped code is not treated as used up', () => {
    const c = cohortCheck({ code: { ...live, max_redemptions: null, redeemed_count: 900 },
      invites: { waitingCount: 0 }, expiringToday: 0 });
    expect(c.state).toBe(STATE.OK);
  });
});

describe('the supplier balance — the 8 August check', () => {
  it('takes the SOP engine\'s judgement rather than re-deriving thresholds', async () => {
    // Two copies of these numbers would drift, and the day they drift this
    // screen says "fine" while the SOP tab says "empty".
    const { balanceLine } = await import('./sop-engine.js');
    const bl = balanceLine({ credits: 0, burnPerDay: 100, now: new Date() });
    const c = balanceCheck({ balanceLine: bl, days: 0 });
    expect(c.state).toBe(STATE.CRITICAL);
    expect(c.value).toBe(bl.value);
  });

  it('says a workshop is not an average day', () => {
    expect(runwayNote(2)).toMatch(/burns faster than an average day/);
    expect(runwayNote(0.5)).toMatch(/not an average day/);
    expect(runwayNote(9)).toMatch(/margin for a workshop spike/);
    expect(runwayNote(null)).toMatch(/cannot be worked out/);
  });

  it('a comfortable balance still carries the runway sentence', () => {
    const c = balanceCheck({
      balanceLine: { state: STATE.OK, value: '41,203 · ~6 days', detail: 'Comfortable.' }, days: 6 });
    expect(c.state).toBe(STATE.OK);
    expect(c.detail).toMatch(/margin for a workshop spike/);
    expect(c.action).toBeNull();
  });
});

describe('models — what not to put in the lesson plan', () => {
  const m = (model, key, rate) => ({ model, rate_pct: rate, verdict: { key } });

  it('names the models to avoid, with their rate', () => {
    const c = modelsCheck({ summary: { judged: 9 }, models: [m('kling-2.5', 'avoid', 34)] });
    expect(c.state).toBe(STATE.CRITICAL);
    expect(c.detail).toMatch(/kling-2\.5 \(34%\)/);
    expect(c.action).toMatch(/teach it/);
  });

  it('a watch-list model is usable with a fallback ready', () => {
    const c = modelsCheck({ summary: { judged: 9 }, models: [m('veo-3', 'watch', 11)] });
    expect(c.state).toBe(STATE.WARN);
    expect(c.action).toMatch(/second model ready/);
  });

  it('avoid outranks watch when both are present', () => {
    const c = modelsCheck({ summary: { judged: 9 },
      models: [m('veo-3', 'watch', 11), m('kling-2.5', 'avoid', 34)] });
    expect(c.state).toBe(STATE.CRITICAL);
  });
});

describe('☠ A LINE THAT IS NOT OK MUST SAY WHAT TO DO', () => {
  it('constructing one without an action throws', () => {
    // Enforced at construction so it cannot ship. A red dot with no action is
    // a line people learn to scroll past.
    expect(() => check({ key: 'x', label: 'x', state: STATE.CRITICAL, info: 'i' }))
      .toThrow(/must carry an action/);
  });

  it('and every line must explain itself', () => {
    // Standing rule: every field and line carries its own explanation.
    expect(() => check({ key: 'x', label: 'x', state: STATE.OK })).toThrow(/explain itself/);
  });

  it('every check this module can produce obeys both', () => {
    const produced = [
      alertsCheck({ error: 'x' }), alertsCheck({ open: [{ severity: 'critical', title: 'a' }] }),
      alertsCheck({ open: [{ severity: 'warn', title: 'b' }] }), alertsCheck({}),
      balanceCheck({ balanceLine: null }),
      modelsCheck({ error: 'x' }), modelsCheck({ summary: { judged: 0 }, models: [] }),
      modelsCheck({ summary: { judged: 3 }, models: [{ model: 'a', rate_pct: 40, verdict: { key: 'avoid' } }] }),
      modelsCheck({ summary: { judged: 3 }, models: [{ model: 'a', verdict: { key: 'watch' } }] }),
      modelsCheck({ summary: { judged: 3 }, models: [] }),
      cohortCheck({ code: null }),
      cohortCheck({ code: { code: 'A', active: false } }),
      cohortCheck({ code: { code: 'A', active: true, max_redemptions: 5, redeemed_count: 5 } }),
      cohortCheck({ code: { code: 'A', active: true }, invites: { waitingCount: 2 } }),
    ];
    for (const c of produced) {
      expect(c.info, `${c.key} has no ⓘ`).toBeTruthy();
      if (c.state !== STATE.OK) expect(c.action, `${c.key} is ${c.state} with no action`).toBeTruthy();
    }
  });
});

describe('the verdict is a sentence, not a count of dots', () => {
  const green = { alerts: {}, balance: { balanceLine: { state: STATE.OK, value: 'x', detail: 'Comfortable.' }, days: 9 },
    models: { summary: { judged: 4 }, models: [] },
    cohort: { code: { code: 'A', active: true, max_redemptions: 20, redeemed_count: 4 },
      invites: { waitingCount: 0 }, expiringToday: 0 } };

  it('all green reads "Ready to start."', () => {
    const r = judgePreflight(green);
    expect(r.go).toBe(true);
    expect(r.headline).toBe('Ready to start.');
  });

  it('one blocker names WHICH one', () => {
    const r = judgePreflight({ ...green, cohort: { code: { code: 'A', active: false } } });
    expect(r.go).toBe(false);
    expect(r.headline).toMatch(/Do not start yet — does this cohort's access work\?/i);
  });

  it('several blockers are counted rather than listed in the headline', () => {
    const r = judgePreflight({
      ...green,
      alerts: { open: [{ severity: 'critical', title: 'a' }] },
      cohort: { code: { code: 'A', active: false } },
    });
    expect(r.headline).toMatch(/2 things need fixing/);
    expect(r.because.length).toBe(2);
  });

  it('a warning still lets you start, and says so', () => {
    const r = judgePreflight({ ...green,
      cohort: { code: { code: 'A', active: true, max_redemptions: 20, redeemed_count: 4 },
        invites: { waitingCount: 3 }, expiringToday: 0 } });
    expect(r.go).toBe(true);
    expect(r.headline).toMatch(/Safe to start/);
  });

  it('☠ critical > UNKNOWN > warn > ok — unknown outranks warn ON THIS SCREEN', () => {
    // The SOP engine ranks these the other way round, which is right for a
    // monitoring screen. Inheriting it here meant an unreadable balance beside
    // one trivial warning produced "Safe to start" — go: true, over exactly
    // the check that was missing on 8 August.
    expect(worst([STATE.OK, STATE.WARN, STATE.UNKNOWN, STATE.CRITICAL])).toBe(STATE.CRITICAL);
    expect(worst([STATE.OK, STATE.WARN, STATE.UNKNOWN])).toBe(STATE.UNKNOWN);
    expect(worst([STATE.OK, STATE.WARN])).toBe(STATE.WARN);
    expect(worst([STATE.OK])).toBe(STATE.OK);
    expect(worst([])).toBe(STATE.OK);
  });

  it('☠ an unreadable check beside a warning does NOT read as safe to start', () => {
    // The end-to-end version of the ordering above, through the real verdict.
    const r = judgePreflight({
      alerts: { open: [{ severity: 'warn', title: 'something minor' }] },  // WARN
      balance: { balanceLine: null },                                       // UNKNOWN
      models: { summary: { judged: 4 }, models: [] },
      cohort: { code: { code: 'A', active: true, max_redemptions: 20, redeemed_count: 4 },
        invites: { waitingCount: 0 }, expiringToday: 0 },
    });
    expect(r.go, 'said it was safe to start over a balance it could not read').toBe(false);
    expect(r.headline).toMatch(/Cannot say it is ready/);
  });

  it('and the SOP engine keeps its OWN ordering — this override is local', () => {
    // Asserted as behaviour, not as source text: the point is that the two
    // screens genuinely disagree on purpose, and that changing one does not
    // silently change the other. The SOP tab is read at leisure, where a
    // visible problem rightly outranks an unmeasurable one.
    const theSame = sopWorst([STATE.WARN, STATE.UNKNOWN]);
    expect(theSame, 'sop-engine no longer prefers warn — check this override is still wanted')
      .toBe(STATE.WARN);
    expect(worst([STATE.WARN, STATE.UNKNOWN]), 'preflight must prefer unknown')
      .toBe(STATE.UNKNOWN);
  });

  it('always returns all four checks, in reading order', () => {
    const r = judgePreflight(green);
    expect(r.checks.map((c) => c.key)).toEqual(CHECK_ORDER);
  });

  it('and returns them even when everything fails at once', () => {
    const r = judgePreflight({});
    expect(r.checks).toHaveLength(4);
    expect(r.go).toBe(false);
  });
});

describe('☠ THE ZERO THAT MEANS "I DID NOT LOOK"', () => {
  const live = { code: 'VOXEL20', active: true, max_redemptions: 20, redeemed_count: 5, expires_at: null };

  it('an unreadable credit-expiry check is UNKNOWN, not a healthy cohort', () => {
    // The route sends null when that query fails. `null > 0` is false, so
    // without an explicit branch this falls through to the green path and says
    // the cohort is fine because nothing was read. This project has shipped
    // that exact shape three times.
    const c = cohortCheck({ code: live, invites: { waitingCount: 0 }, expiringToday: null });
    expect(c.state).toBe(STATE.UNKNOWN);
    expect(c.action).toMatch(/Credits die 30 days/);
  });

  it('and it stops the whole screen saying ready', () => {
    const r = judgePreflight({
      alerts: {},
      balance: { balanceLine: { state: STATE.OK, value: 'x', detail: 'Comfortable.' }, days: 9 },
      models: { summary: { judged: 4 }, models: [] },
      cohort: { code: live, invites: { waitingCount: 0 }, expiringToday: null },
    });
    expect(r.go).toBe(false);
  });

  it('a real zero still reads as healthy', () => {
    // The distinction is the whole point: 0 measured is good news, 0 assumed
    // is not news at all.
    const c = cohortCheck({ code: live, invites: { waitingCount: 0 }, expiringToday: 0 });
    expect(c.state).toBe(STATE.OK);
  });
});

describe('the default fails CLOSED', () => {
  it('a caller who forgets the credit check gets unknown, not a pass', () => {
    const c = cohortCheck({ code: { code: 'A', active: true }, invites: { waitingCount: 0 } });
    expect(c.state).toBe(STATE.UNKNOWN);
  });
});
