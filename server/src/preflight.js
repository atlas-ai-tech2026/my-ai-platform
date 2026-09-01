// ─── preflight.js ────────────────────────────────────────────────────────────
// THE CHECK BEFORE A ROOM FULL OF PEOPLE.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// On 8 August, 415 generations failed during a live workshop because the
// supplier account was empty. Every one auto-refunded, so no counter moved, no
// alert fired, and nothing anywhere said "this is happening right now". The
// room saw it before the system did.
//
// Everything needed to have caught that was already on a screen — the balance
// on the SOP tab, the model reliability under Costing, the promo code under
// Promo Codes, the alerts on Alerts. Four tabs, four judgements, in the ten
// minutes before you stand up in front of people. That is not a check anybody
// runs, which is why nobody ran it.
//
// So this is not new information. It is the SAME information, on one screen,
// arranged around one question: CAN I START THIS WORKSHOP?
//
// ── WHY IT ANSWERS WITH A SENTENCE, NOT A DASHBOARD ────────────────────────
// A dashboard makes you decide. Ten minutes before a workshop, with a room
// filling up, the useful output is "start" or "do not start yet, because X".
// Every check therefore carries the action, and the headline is a verdict —
// not a count of green dots.
//
// ── WHAT IT DELIBERATELY DOES NOT CHECK ────────────────────────────────────
// FAL. There is no way to ask FAL whether our account has money: they publish
// no balance endpoint, which is why an empty FAL account is only ever visible
// afterwards, as a wave of refunds. The one thing that CAN be probed is
// fal.ai's public model list, which needs no key — and that is exactly why it
// must not be shown here. It would answer "is fal.ai's website up", print a
// green light, and be read as "FAL will work today". A green light that does
// not mean what it appears to mean is worse than no light at all.
//
// The kie balance is checked because kie DOES publish a balance, and 8 August
// was a kie outage. If FAL ever publishes one, it belongs here.

import { STATE } from './sop-engine.js';

/** Order matters: this is the order a person reads them before standing up. */
export const CHECK_ORDER = ['alerts', 'balance', 'models', 'cohort'];

/** A workshop day is a spike, not an average day — see runwayNote(). */
export const WORKSHOP_SPIKE = 3;

/**
 * One pre-flight line.
 *
 * Same invariant as the SOP engine, for the same reason: a line that is not OK
 * and does not say what to do is a line that gets looked at and then ignored.
 * Enforced by throwing, so it cannot ship.
 */
export function check({ key, label, state, value = null, detail = '', action = null, info }) {
  if (!Object.values(STATE).includes(state)) throw new Error(`check "${key}" has an unknown state: ${state}`);
  if (state !== STATE.OK && !action) throw new Error(`check "${key}" is not OK and must carry an action`);
  if (!info) throw new Error(`check "${key}" must explain itself — every line carries its own ⓘ`);
  return { key, label, state, value, detail, action, info };
}

/**
 * ☠ UNKNOWN OUTRANKS WARN HERE, AND THAT IS DELIBERATE.
 *
 * The SOP engine ranks them the other way round (`sop-engine.js` RANK: warn 2,
 * unknown 1), which is right for a monitoring screen read at leisure: a real
 * problem you can see beats one you cannot measure.
 *
 * It is wrong for this screen. Ten minutes before standing up in front of
 * twenty people, "I could not check the supplier balance" is WORSE than "one
 * invited person has not signed up", because the unreadable one is the shape
 * 8 August had. Inheriting the SOP ordering meant an unreadable balance beside
 * any minor warning produced the headline "Safe to start" — go: true, over the
 * exact check that failed the last time this went wrong.
 *
 * Caught by preflight.test.js, not by review.
 */
const RANK = { [STATE.CRITICAL]: 3, [STATE.UNKNOWN]: 2, [STATE.WARN]: 1, [STATE.OK]: 0 };
export function worst(states = []) {
  return states.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), STATE.OK);
}

// ─── 1. IS ANYTHING ALREADY WRONG? ──────────────────────────────────────────

export function alertsCheck({ open = [], error = null } = {}) {
  const info = 'Everything the system already knows is broken. This is the same list as the Alerts '
    + 'tab — repeated here because the ten minutes before a workshop is exactly when nobody opens '
    + 'a second tab to look.';

  if (error) {
    return check({ key: 'alerts', label: 'Anything already wrong?', state: STATE.UNKNOWN, info,
      detail: `The alert list could not be read: ${error}`,
      action: 'Open the Alerts tab directly. Unreadable is not the same as empty.' });
  }
  const criticals = open.filter((a) => a.severity === 'critical');
  if (criticals.length) {
    return check({ key: 'alerts', label: 'Anything already wrong?', state: STATE.CRITICAL, info,
      value: `${criticals.length} critical`,
      detail: criticals.slice(0, 3).map((a) => a.title || a.kind).join(' · '),
      action: 'Read these before you start. A critical alert during a workshop becomes 415 failures.' });
  }
  if (open.length) {
    return check({ key: 'alerts', label: 'Anything already wrong?', state: STATE.WARN, info,
      value: `${open.length} open`,
      detail: open.slice(0, 3).map((a) => a.title || a.kind).join(' · '),
      action: 'Not blocking, but read them — you are about to add load to a system already complaining.' });
  }
  return check({ key: 'alerts', label: 'Anything already wrong?', state: STATE.OK, info,
    value: 'none', detail: 'Nothing is currently flagged.' });
}

// ─── 2. WILL THE SUPPLIER LAST THE DAY? ─────────────────────────────────────

/**
 * Runway is already judged by the SOP engine's balanceLine, whose 3-day
 * threshold exists precisely because a workshop is a spike. This adds the
 * sentence that makes the number mean something on the day.
 */
export function runwayNote(days) {
  if (days == null) return 'No burn rate yet, so days of runway cannot be worked out from credits alone.';
  if (days < 1) return 'Less than a day at the AVERAGE rate — and a workshop is not an average day.';
  if (days < WORKSHOP_SPIKE) {
    return `About ${Math.floor(days)} day(s) at the average rate. A room of people burns faster than `
      + 'an average day, so treat this as less than it looks.';
  }
  return `About ${Math.floor(days)} days at the average rate, which leaves margin for a workshop spike.`;
}

/**
 * Takes the SOP engine's own balance judgement rather than re-deriving it.
 * Two copies of these thresholds would drift, and the day they drift is the
 * day this screen says "fine" while the SOP tab says "empty".
 */
export function balanceCheck({ balanceLine, days = null }) {
  const info = 'Credits left at kie, the supplier behind most video models. At zero, EVERY generation '
    + 'fails instantly — which is exactly what happened on 8 August, 415 times, in front of a room. '
    + 'The threshold is three days rather than one because a workshop burns faster than a normal day.';

  if (!balanceLine) {
    return check({ key: 'balance', label: 'Supplier balance', state: STATE.UNKNOWN, info,
      detail: 'The balance was not read.',
      action: 'Open the kie dashboard directly before you start. Unreadable is not zero, and it is not fine.' });
  }
  const detail = [balanceLine.detail, runwayNote(days)].filter(Boolean).join(' ');
  return check({
    key: 'balance', label: 'Supplier balance', state: balanceLine.state, info,
    value: balanceLine.value ?? null, detail,
    // An OK line needs no action; a non-OK one inherits the SOP tab's, which is
    // already written for this situation ("Top up before the next workshop").
    action: balanceLine.state === STATE.OK ? null : (balanceLine.action || 'Top up before you start.'),
  });
}

// ─── 3. HAS ANY MODEL GONE BAD? ─────────────────────────────────────────────

export function modelsCheck({ summary = null, models = [], error = null } = {}) {
  const info = 'How often each model has failed over the last 30 days, from the Costing → Reliability '
    + 'table. A model that fails one time in five bills for every attempt AND loses the room — and '
    + 'the first ten minutes of a workshop is the worst possible place to discover it.';

  if (error || !summary) {
    return check({ key: 'models', label: 'Has any model gone bad?', state: STATE.UNKNOWN, info,
      detail: error ? `Reliability could not be read: ${error}` : 'No reliability data.',
      action: 'Open Costing → Reliability before choosing what to demonstrate.' });
  }
  const avoid = models.filter((m) => m?.verdict?.key === 'avoid');
  if (avoid.length) {
    const names = avoid.slice(0, 3).map((m) => `${m.model} (${m.rate_pct}%)`).join(' · ');
    return check({ key: 'models', label: 'Has any model gone bad?', state: STATE.CRITICAL, info,
      value: `${avoid.length} to avoid`,
      detail: `Failing too often to demonstrate: ${names}`,
      action: 'Do not put these in the lesson plan. Pick a model marked "teach it" instead.' });
  }
  const watch = models.filter((m) => m?.verdict?.key === 'watch');
  if (watch.length) {
    return check({ key: 'models', label: 'Has any model gone bad?', state: STATE.WARN, info,
      value: `${watch.length} to watch`,
      detail: `Usable but expect a visible failure in a large room: ${watch.slice(0, 3).map((m) => m.model).join(' · ')}`,
      action: 'Usable in a demo, but have a second model ready for the one that fails.' });
  }
  if (!summary.judged) {
    // "Nothing to avoid" out of nothing judged is not good news, and must not
    // be painted green. This is the same trap as a zero that means "unknown".
    return check({ key: 'models', label: 'Has any model gone bad?', state: STATE.UNKNOWN, info,
      value: 'not enough data',
      detail: `No model has the ${summary.min_attempts || 30}+ attempts needed to judge a failure rate.`,
      action: 'Nothing here says the models are FINE — only that there is too little to tell. Judge from experience.' });
  }
  return check({ key: 'models', label: 'Has any model gone bad?', state: STATE.OK, info,
    value: `${summary.judged} judged`, detail: 'Every judged model is reliable enough for a live demo.' });
}

// ─── 4. DOES THIS COHORT'S ACCESS COVER TODAY? ──────────────────────────────

/**
 * The one check that is genuinely about TODAY rather than about the system.
 *
 * Four ways a cohort can arrive to a locked door, all of them silent until the
 * room is sitting down:
 *   · the code was switched off
 *   · the code expired
 *   · every use has been taken
 *   · the credits were granted long enough ago that they have already died
 *
 * The fourth is the quiet one. Credits die 30 days after they are added, so a
 * code redeemed at a previous session still "works" and grants nothing.
 */
// `expiringToday` defaults to null — UNKNOWN — rather than 0. A caller who
// forgets to pass it gets "could not tell", not a green light. Fail closed.
export function cohortCheck({ code = null, invites = null, expiringToday = null, now = new Date() } = {}) {
  const info = 'The promo code this cohort will use, judged the way the redeem endpoint judges it: '
    + 'switched on, not expired, uses left. It also counts who was invited but has not signed up — '
    + 'the usual cause is somebody invited at their work address signing up with a personal one. '
    + 'And it checks whether the credits already granted are still alive today, because credits die '
    + '30 days after they are added while the code goes on looking perfectly healthy.';

  if (!code) {
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.UNKNOWN, info,
      detail: 'No workshop code chosen.',
      action: 'Pick the code this cohort will use, so it can be checked before they arrive.' });
  }
  if (!code.active) {
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.CRITICAL, info,
      value: code.code, detail: 'The code is switched OFF. Every attendee will be refused.',
      action: 'Turn it on in Promo Codes before they arrive.' });
  }
  if (code.expires_at && new Date(code.expires_at) <= now) {
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.CRITICAL, info,
      value: code.code, detail: `Expired ${new Date(code.expires_at).toISOString().slice(0, 10)}.`,
      action: 'Extend the expiry in Promo Codes — it takes effect immediately.' });
  }
  const cap = code.max_redemptions;
  const used = Number(code.redeemed_count) || 0;
  if (cap != null && used >= cap) {
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.CRITICAL, info,
      value: `${used}/${cap} used`, detail: 'Every use has been taken. The next person is refused.',
      action: 'Raise the limit, or issue a second code, before they arrive.' });
  }
  if (expiringToday === null) {
    // ☠ NOT a pass. The route sends null when the expiry query failed, and
    // `null > 0` is false — so falling through to the healthy branch would
    // paint this green on the strength of not having looked. Same shape as the
    // count that returned 0 for "could not tell".
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.UNKNOWN, info,
      value: code.code,
      detail: 'The code is valid, but whether the attendees still hold live credits could not be read.',
      action: 'Check one attendee in Users before you start. Credits die 30 days after they are granted.' });
  }
  if (expiringToday > 0) {
    // The silent one: the code is perfect and the credits are already dead.
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.CRITICAL, info,
      value: code.code,
      detail: `${expiringToday} attendee(s) hold credits that die today. Their code works and grants nothing.`,
      action: 'Grant those accounts credits directly, or the demonstration stops at their first click.' });
  }

  const waiting = invites?.waitingCount ?? 0;
  const left = cap == null ? null : cap - used;
  const value = cap == null ? `${used} redeemed` : `${used}/${cap} used`;
  if (waiting > 0) {
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.WARN, info,
      value, detail: `${waiting} invited people have not signed up yet.`,
      action: 'Usually an address mismatch — someone invited at work signing up with a personal email. '
        + 'Check the invite list so it is fixed now rather than in the room.' });
  }
  if (left != null && left <= 0) {
    return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.WARN, info,
      value, detail: 'No spare uses for a late arrival.',
      action: 'Raise the limit if anyone might join on the day.' });
  }
  return check({ key: 'cohort', label: "Does this cohort's access work?", state: STATE.OK, info,
    value, detail: left == null ? 'Active, no limit set.' : `Active, ${left} use(s) spare.` });
}

// ─── THE VERDICT ────────────────────────────────────────────────────────────

/**
 * One sentence, because that is the whole point.
 *
 * UNKNOWN is deliberately NOT treated as "probably fine". A check that could
 * not run is a check that has not passed, and saying "ready" over one is how a
 * screen teaches people to stop reading it.
 */
export function verdictOf(checks = []) {
  const state = worst(checks.map((c) => c.state));
  const bad = checks.filter((c) => c.state === STATE.CRITICAL);
  const unknown = checks.filter((c) => c.state === STATE.UNKNOWN);
  const warn = checks.filter((c) => c.state === STATE.WARN);

  if (state === STATE.CRITICAL) {
    return { state, go: false,
      headline: bad.length === 1 ? `Do not start yet — ${bad[0].label.toLowerCase()}`
                                 : `Do not start yet — ${bad.length} things need fixing`,
      because: bad.map((c) => c.detail).filter(Boolean) };
  }
  if (state === STATE.UNKNOWN) {
    return { state, go: false,
      headline: `Cannot say it is ready — ${unknown.length} check(s) could not run`,
      because: unknown.map((c) => c.detail).filter(Boolean) };
  }
  if (state === STATE.WARN) {
    return { state, go: true,
      headline: `Safe to start — ${warn.length} thing(s) worth a look first`,
      because: warn.map((c) => c.detail).filter(Boolean) };
  }
  return { state, go: true, headline: 'Ready to start.', because: [] };
}

/** Everything above, in the order a person reads it. */
export function judgePreflight(parts = {}) {
  const checks = [
    alertsCheck(parts.alerts),
    balanceCheck(parts.balance || {}),
    modelsCheck(parts.models),
    cohortCheck(parts.cohort),
  ];
  return { checks, ...verdictOf(checks) };
}
