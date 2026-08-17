// ─── alerts-engine.js ────────────────────────────────────────────────────────
// The part of alerting that decides things, kept free of the database and the
// network so it can be tested against the cases that actually happened.
//
// WHY THIS EXISTS, precisely. A balance check already ran hourly before this
// module — `checkKieBalance()` in index.js — and its entire output was
// `console.error`. On 8 August 415 generations failed with the provider saying
// "Credits insufficient" and "Exhausted balance", in front of a live workshop.
// Every attendee was refunded automatically, so no money went missing; what
// went missing was the room's confidence. The system knew, hourly, and the
// only place it said so was a log nobody opens and that has since rotated away.
//
// So this module is not new detection. It is the part that was missing:
// turning a condition into something that persists, escalates, and stops.
//
// Two provider realities shape the checks below:
//   · kie publishes a balance endpoint, so it can be caught BEFORE customers
//     see anything.
//   · fal publishes none. The only signal is its refusal text arriving in
//     refund reasons — which means fal can only be caught from the wreckage.
//     That asymmetry is deliberate here, not an oversight.

export const SEVERITY = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };

const RANK = { critical: 0, warning: 1, info: 2 };

/** Sort key so the list reads worst-first without the caller thinking about it. */
export function bySeverity(a, b) {
  const d = (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9);
  return d !== 0 ? d : new Date(b.last_seen || 0) - new Date(a.last_seen || 0);
}

// ── provider refusal fingerprints ───────────────────────────────────────────
// Read off 4,335 real refund rows on 2026-08-16. Order matters: "Credits
// insufficient" from the PROVIDER means our account, and must never be
// confused with a customer running out of voxel credits.
// Exported as a plain string as well, because reliability-routes.js needs the
// SAME test inside SQL. Two copies of this pattern would drift, and the day
// they drift is the day a billing problem starts being reported as a model
// quality problem. Postgres ARE (`~*`) understands this syntax as written.
export const OUR_ACCOUNT_DRY_SOURCE =
  'exhausted balance|credits? insufficient|user is locked|top ?up|insufficient balance|quota exceeded';
const OUR_ACCOUNT_DRY = new RegExp(OUR_ACCOUNT_DRY_SOURCE, 'i');

/**
 * Did this failure happen because OUR supplier account was empty or locked?
 *
 * This is the one category the owner can actually fix, and the one that hits
 * hardest: it fails EVERY customer at once rather than one unlucky request.
 */
export function isOurAccountDry(reason) {
  return OUR_ACCOUNT_DRY.test(String(reason || ''));
}

/** Which provider refused, read from the reason prefix our code writes. */
export function providerOf(reason) {
  const s = String(reason || '');
  if (/^kie/i.test(s)) return 'kie';
  if (/^fal/i.test(s)) return 'fal';
  return null;
}

// ── thresholds ──────────────────────────────────────────────────────────────
// Defaults, overridable per install. kie_balance_min is deliberately HIGHER
// than the 3000 the old console-only check used: 3000 was low enough that a
// busy workshop could cross it and hit zero between two hourly checks.
export const DEFAULT_SETTINGS = {
  kie_balance_min: 8000,
  stuck_charge_hours: 2,
  failure_rate_pct: 15,
  failure_min_attempts: 25,
  catalogue_stale_hours: 30,
  // 35 rather than 30: the check runs monthly, so a 30-day limit would alarm
  // every time a month ran slightly long. Five days of slack means this fires
  // when the check has genuinely stopped, not when the calendar is awkward.
  restore_verify_max_age_days: 35,
  email_enabled: true,
  email_to: '',
};

export function withDefaults(row) {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const v = row?.[k];
    if (v !== null && v !== undefined && v !== '') out[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? Number(v) : v;
  }
  return out;
}

// ── the checks ──────────────────────────────────────────────────────────────
// Each returns an alert object or null. They take already-fetched facts rather
// than fetching, so a provider outage cannot make a check throw and silently
// skip the others.

/** kie balance — the only provider we can see coming. */
export function checkKieBalance({ credits, burnPerDay = null }, s = DEFAULT_SETTINGS) {
  if (credits === null || credits === undefined || !Number.isFinite(Number(credits))) return null;
  const c = Number(credits);
  if (c >= s.kie_balance_min) return null;
  const days = burnPerDay > 0 ? c / burnPerDay : null;
  return {
    key: 'kie_balance_low',
    kind: 'kie_balance_low',
    // Empty is not "nearly empty". Zero means every kie generation is already
    // failing right now, which is a different conversation from "top up soon".
    severity: c <= 0 ? SEVERITY.CRITICAL : (days !== null && days < 3) || c < s.kie_balance_min / 2
      ? SEVERITY.CRITICAL : SEVERITY.WARNING,
    title: c <= 0
      ? 'kie.ai balance is empty — generations are failing now'
      : `kie.ai balance below ${s.kie_balance_min.toLocaleString()} credits`,
    detail: [
      `${c.toLocaleString()} credits left`,
      burnPerDay > 0 ? `burning ~${Math.round(burnPerDay).toLocaleString()}/day` : null,
      days !== null ? `runs out in ~${days < 1 ? 'under a day' : `${Math.floor(days)} days`}` : null,
      'Top up at kie.ai before the next session.',
    ].filter(Boolean).join(' · '),
    value: c,
  };
}

/**
 * fal (and kie) caught from the wreckage — refusals that mean OUR account.
 *
 * Deliberately a low bar: even a handful means every customer is being turned
 * away, because an empty account does not fail selectively.
 */
export function checkAccountDryFailures({ recent = [] }, _s = DEFAULT_SETTINGS) {
  const dry = recent.filter((r) => isOurAccountDry(r.reason));
  if (!dry.length) return null;
  const byProvider = {};
  for (const r of dry) {
    const p = providerOf(r.reason) || 'provider';
    byProvider[p] = (byProvider[p] || 0) + 1;
  }
  const who = Object.entries(byProvider)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p}: ${n}`)
    .join(' · ');
  return {
    key: 'account_dry',
    kind: 'account_dry',
    severity: SEVERITY.CRITICAL,
    title: 'Your supplier account is empty or locked — customers are being refused',
    detail: `${dry.length} generation(s) failed with the provider refusing on OUR account (${who}). `
      + 'Everyone was refunded, so no money is missing — but nothing is being delivered either. '
      + 'This fails every customer at once, not one unlucky request.',
    value: dry.length,
  };
}

/** Charges taken for a video that never settled — the 124-row bug, watched for. */
export function checkStuckCharges({ pending = 0, oldestHours = null }, s = DEFAULT_SETTINGS) {
  if (!pending || (oldestHours !== null && oldestHours < s.stuck_charge_hours)) return null;
  return {
    key: 'stuck_charges',
    kind: 'stuck_charges',
    severity: pending >= 20 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
    title: `${pending} video charge(s) taken with nothing delivered`,
    detail: `Oldest has been pending ${oldestHours === null ? 'over the threshold' : `${Math.floor(oldestHours)}h`}. `
      + 'These are customers charged for a video they never received.',
    value: pending,
  };
}

/**
 * A model failing far more than it should.
 *
 * `failure_min_attempts` is the guard that matters: 3 failures out of 4
 * attempts is 75% and means nothing. A rate computed from a tiny sample is a
 * guess wearing a number's clothes.
 */
export function checkFailureSpike({ models = [] }, s = DEFAULT_SETTINGS) {
  const bad = models
    .filter((m) => m.attempts >= s.failure_min_attempts)
    .map((m) => ({ ...m, rate: (m.failures / m.attempts) * 100 }))
    .filter((m) => m.rate >= s.failure_rate_pct)
    .sort((a, b) => b.rate - a.rate);
  if (!bad.length) return null;
  const worst = bad[0];
  return {
    key: 'failure_spike',
    kind: 'failure_spike',
    severity: worst.rate >= s.failure_rate_pct * 2 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
    title: `${worst.model} is failing ${worst.rate.toFixed(0)}% of attempts`,
    detail: [
      `${worst.failures} of ${worst.attempts} in the last hour`,
      bad.length > 1 ? `${bad.length - 1} other model(s) also above ${s.failure_rate_pct}%` : null,
      'Customers are charged and refunded automatically — they see a failure, not a bill.',
    ].filter(Boolean).join(' · '),
    value: Number(worst.rate.toFixed(1)),
  };
}

/**
 * Overall failure rate — the honest version of the check above.
 *
 * A refund row records WHY the provider refused but not WHICH model was asked,
 * so a per-model rate cannot be computed from today's data at all. The first
 * draft of this file faked it by giving every model the total failure count,
 * which would have reported every model as failing 100% and fired on all of
 * them at once. An alert that is always on is worse than no alert.
 *
 * So until Tier 1.3 records model + outcome together, this reports the one
 * number that is actually true: how many of the last hour's generations came
 * back as refunds.
 */
export function checkOverallFailureRate({ spends = 0, failures = 0 }, s = DEFAULT_SETTINGS) {
  if (spends < s.failure_min_attempts) return null;
  const rate = (failures / spends) * 100;
  if (rate < s.failure_rate_pct) return null;
  return {
    key: 'failure_rate',
    kind: 'failure_rate',
    severity: rate >= s.failure_rate_pct * 2 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
    title: `${rate.toFixed(0)}% of generations failed in the last hour`,
    detail: `${failures} of ${spends} were refunded. Customers see a failure, not a bill. `
      + 'Which model is responsible is not recorded yet — the Reliability screen will show that.',
    value: Number(rate.toFixed(1)),
  };
}

/** The nightly sweep silently not running is how a stale queue looks fresh. */
export function checkSweepStale({ lastSweepIso, now }, s = DEFAULT_SETTINGS) {
  if (!lastSweepIso) return null;      // never run is reported by the panel itself
  const hours = (new Date(now) - new Date(lastSweepIso)) / 36e5;
  if (!Number.isFinite(hours) || hours < s.catalogue_stale_hours) return null;
  return {
    key: 'sweep_stale',
    kind: 'sweep_stale',
    severity: SEVERITY.WARNING,
    title: 'The nightly model sweep has not run',
    detail: `Last completed ${Math.floor(hours)}h ago. New models and supplier price changes `
      + 'are not being picked up.',
    value: Math.floor(hours),
  };
}

/**
 * The backup restore check: did it pass, and has it run recently enough?
 *
 * TWO conditions, and the second is the one that matters most. A verification
 * that FAILS is loud and obvious. A verification that silently STOPPED RUNNING
 * looks exactly like everything being fine — which is the state this whole
 * feature exists to end. "No news" must never read as good news here.
 *
 * CRITICAL, not warning: every other alert on this list costs money or a
 * workshop. This one is the only one that can cost the business.
 */
export function checkBackupRestore({ backupVerify, now }, s = DEFAULT_SETTINGS) {
  const maxAgeDays = s.restore_verify_max_age_days ?? 35;

  // ABSENT vs NULL, and the difference matters.
  //   undefined = this fact was never gathered → say nothing. A caller that
  //               did not collect it has told us nothing about backups, and
  //               inventing a CRITICAL from silence is how an alert system
  //               teaches its owner to dismiss alerts.
  //   null      = gathered, and there is genuinely no verification on record
  //               → that IS the finding.
  // Same reasoning as facts.credits: unreadable is not zero.
  if (backupVerify === undefined) return null;

  // Never verified at all.
  if (!backupVerify || !backupVerify.checked_at) {
    return {
      key: 'restore_never_verified',
      kind: 'restore_verify',
      severity: SEVERITY.CRITICAL,
      title: 'No backup has ever been test-restored',
      detail: 'Backups are being written, but nothing has ever proved one can be read back. '
        + 'An untested backup is a hope, and it is discovered on the worst possible day.',
      value: null,
    };
  }

  if (!backupVerify.ok) {
    const problems = backupVerify.problems || [];
    const detail = problems.slice(0, 4).join(' · ')
      || 'The verification failed without recording a reason.';

    // "We could not REACH the archive" and "the archive is BAD" are different
    // emergencies with different fixes, and calling a bandwidth cap a corrupt
    // backup is how an alert loses its credibility. Both stay critical — being
    // unable to reach your only offsite copy is not a small thing — but the
    // headline has to name the real problem.
    const unreachable = problems.some((p) => /could not fetch|not configured/i.test(p));
    return {
      key: unreachable ? 'restore_unreachable' : 'restore_failed',
      kind: 'restore_verify',
      severity: SEVERITY.CRITICAL,
      title: unreachable
        ? 'The offsite backup could not be reached'
        : 'The last backup could NOT be restored',
      detail: unreachable
        ? `${detail} — the archive may be perfectly good; nothing could read it to find out.`
        : detail,
      value: null,
    };
  }

  const days = (new Date(now) - new Date(backupVerify.checked_at)) / 864e5;
  if (Number.isFinite(days) && days > maxAgeDays) {
    return {
      key: 'restore_verify_stale',
      kind: 'restore_verify',
      severity: SEVERITY.WARNING,
      title: 'The backup restore check has stopped running',
      detail: `Last verified ${Math.floor(days)} days ago. The backups may still be good — `
        + 'but nothing is checking, which is where this started.',
      value: Math.floor(days),
    };
  }
  return null;
}

// ── notification policy ─────────────────────────────────────────────────────

/**
 * Should this alert send an email right now?
 *
 * An alert that emails on every 5-minute pass trains you to filter it, and
 * then the one that matters is filtered too. So: email once when it opens,
 * and again only if it is still critical a day later.
 */
export const RENOTIFY_MS = 24 * 60 * 60 * 1000;

export function shouldEmail(alert, { notifiedAt = null, now = Date.now(), enabled = true } = {}) {
  if (!enabled) return false;
  if (alert.severity === SEVERITY.INFO) return false;
  if (!notifiedAt) return true;
  if (alert.severity !== SEVERITY.CRITICAL) return false;
  return new Date(now) - new Date(notifiedAt) >= RENOTIFY_MS;
}

/** One line for the email subject — enough to act on without opening anything. */
export function subjectFor(alerts) {
  const crit = alerts.filter((a) => a.severity === SEVERITY.CRITICAL).length;
  const first = [...alerts].sort(bySeverity)[0];
  if (!first) return 'VOXEL — all clear';
  return crit > 1
    ? `VOXEL — ${crit} critical alerts: ${first.title}`
    : `VOXEL — ${first.title}`;
}

/** Run every check, never letting one failure hide the others. */
export function evaluateAll(facts, settings = DEFAULT_SETTINGS) {
  const checks = [
    () => checkAccountDryFailures(facts, settings),
    () => checkKieBalance(facts, settings),
    () => checkStuckCharges(facts, settings),
    // checkFailureSpike is NOT wired in yet — it needs per-model failure data
    // that nothing records today. The overall rate is what can be stated
    // truthfully now; the per-model version lands with Tier 1.3.
    () => checkOverallFailureRate(facts, settings),
    () => checkSweepStale(facts, settings),
    () => checkBackupRestore(facts, settings),
  ];
  const out = [];
  for (const run of checks) {
    try {
      const a = run();
      if (a) out.push(a);
    } catch (e) {
      // A broken check must not take the others down with it, and must not
      // pass silently either — that is the whole failure mode this file exists
      // to end.
      out.push({
        key: 'check_error', kind: 'check_error', severity: SEVERITY.WARNING,
        title: 'An alert check failed to run', detail: e.message, value: null,
      });
    }
  }
  return out.sort(bySeverity);
}
