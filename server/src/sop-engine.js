// ─── sop-engine.js ───────────────────────────────────────────────────────────
// The daily operations picture: what every automated check found, and WHAT TO
// DO about each one.
//
// WHY IT EXISTS. On 2026-08-18 the owner asked how to check the backup system
// and the honest answer was "there is no screen — open a raw API URL". Every
// check already existed; not one of them had a face. The Alerts tab shows what
// is WRONG; nothing showed what is FINE, and "fine" is most of what you need
// to see before standing in front of a room.
//
// ── THE RULE THIS FILE IS BUILT AROUND ──────────────────────────────────────
// A line must never say "OK" when it means "not checked". Those are different
// facts and only one of them is reassuring. Every line therefore carries its
// own `checked_at`, and a check that could not run reports UNKNOWN — never
// green. The restore verification learned this the hard way: it answered "not
// due" for thirty days after a failure and looked exactly like health.
//
// ── ZONES, ORDERED BY HOW FAST THEY CHANGE ──────────────────────────────────
// Mixing these on one flat list makes the screen 90% permanently-green static
// facts, and a reader who skims static facts skims the live one too.
//   TODAY     — changes minute to minute. The reason to open the tab.
//   INTEGRITY — changes only when code changes. UI promising what no table keeps.
//   POSTURE   — changes almost never. Only what is OPEN or live-checkable;
//               fourteen permanently-green ticks are a plaque, not a check.

export const ZONES = ['today', 'integrity', 'posture'];

/** A line is one of these. GREEN IS EARNED — `unknown` is not `ok`. */
export const STATE = {
  OK: 'ok',
  WARN: 'warn',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown',   // could not be determined — never shown as healthy
};

/** Worst state wins when rolling a zone up to one word. */
const RANK = { [STATE.CRITICAL]: 3, [STATE.WARN]: 2, [STATE.UNKNOWN]: 1, [STATE.OK]: 0 };

export function worst(states) {
  return states.reduce((acc, s) => (RANK[s] > RANK[acc] ? s : acc), STATE.OK);
}

/**
 * Build one line.
 *
 * `action` is not optional decoration. A status with no action is a number to
 * worry about; the whole point of this tab is that it tells you what to do.
 */
export function line({ key, zone, label, state, value = null, detail = '', action = '', info = '', checkedAt = null }) {
  if (!ZONES.includes(zone)) throw new Error(`unknown zone: ${zone}`);
  if (!Object.values(STATE).includes(state)) throw new Error(`unknown state: ${state}`);
  if (state !== STATE.OK && !action) throw new Error(`line "${key}" is not OK and must carry an action`);
  return { key, zone, label, state, value, detail, action, info, checked_at: checkedAt };
}

// ── TODAY ───────────────────────────────────────────────────────────────────

/** Hours since an ISO timestamp, or null when there is nothing to measure. */
const hoursSince = (iso, now) =>
  (iso ? (new Date(now) - new Date(iso)) / 36e5 : null);

export function backupLine({ autoBackup, backupFreshness, now }) {
  const info = 'A full copy of every table, written daily to DigitalOcean Spaces and to '
    + 'Backblaze — a different company — encrypted with your passphrase before it leaves '
    + 'the server. Two copies exist so that losing one provider does not lose the data. '
    + 'Read from the BUCKETS on every load, so a restart cannot make it say anything.';

  // ── PREFERRED: what the buckets actually contain ─────────────────────────
  // The fallback below reads a module-level object that every restart wipes,
  // and the backup runs five minutes after boot. This app deploys several times
  // a day, so that path spent much of its life reporting "not checked" while
  // backups were running perfectly — indistinguishable from "the job is dead".
  // The owner saw it, did not believe the reassurance, and was right.
  //
  // An archive in the bucket with a date on it is evidence. A variable saying a
  // backup happened is a claim that dies with the process that made it.
  if (backupFreshness) {
    const f = backupFreshness;
    return line({
      key: 'backup', zone: 'today', label: 'Daily backup', info,
      state: f.state === 'critical' ? STATE.CRITICAL
        : f.state === 'warn' ? STATE.WARN
        : f.state === 'unknown' ? STATE.UNKNOWN : STATE.OK,
      value: f.state === 'ok' ? 'both copies fresh' : f.state,
      // This branch reads the BUCKETS on every load, so the check happened now.
      // Leaving it unset rendered "both copies fresh" in green above the words
      // "never checked" — a line contradicting itself in two lines, on the
      // screen whose whole job is being believable.
      checkedAt: new Date(now || Date.now()).toISOString(),
      detail: f.detail,
      action: f.action || '',
    });
  }

  if (!autoBackup || !autoBackup.last_at) {
    return line({
      key: 'backup', zone: 'today', label: 'Daily backup', state: STATE.UNKNOWN, info,
      detail: 'The buckets could not be read, and nothing has been recorded since this server started.',
      action: 'This says nothing about whether backups are running — only that we could not check. '
        + 'Look for [auto-backup] in the logs.',
    });
  }
  const age = hoursSince(autoBackup.last_at, now);
  const when = `${Math.floor(age)}h ago`;

  if (autoBackup.last_error) {
    return line({
      key: 'backup', zone: 'today', label: 'Daily backup', state: STATE.CRITICAL, info,
      value: when, checkedAt: autoBackup.last_at, detail: autoBackup.last_error,
      action: 'Check the Backblaze credentials and caps. Until this clears you have ONE copy.',
    });
  }
  // Two days, not one: a single missed night is a blip, two is a broken job.
  if (age > 48) {
    return line({
      key: 'backup', zone: 'today', label: 'Daily backup', state: STATE.CRITICAL, info,
      value: when, checkedAt: autoBackup.last_at,
      detail: `The last backup was ${Math.floor(age / 24)} days ago.`,
      action: 'The daily job has stopped. Check the server logs for [auto-backup].',
    });
  }
  if (!autoBackup.encrypted) {
    return line({
      key: 'backup', zone: 'today', label: 'Daily backup', state: STATE.CRITICAL, info,
      value: when, checkedAt: autoBackup.last_at,
      detail: 'Backups are being written UNENCRYPTED.',
      action: 'Set BACKUP_ENCRYPTION_PASSPHRASE in DigitalOcean immediately.',
    });
  }
  // Only one copy — but say WHICH kind of single-copy this is.
  if (autoBackup.offsite_error) {
    return line({
      key: 'backup', zone: 'today', label: 'Daily backup', state: STATE.WARN, info,
      value: when, checkedAt: autoBackup.last_at,
      detail: `Primary copy written; the offsite copy failed: ${autoBackup.offsite_error}`,
      action: 'You have one copy. Check Backblaze caps and credentials.',
    });
  }
  const oneByDesign = autoBackup.offsite_skipped;
  return line({
    key: 'backup', zone: 'today', label: 'Daily backup', state: STATE.OK, info,
    value: when, checkedAt: autoBackup.last_at,
    detail: oneByDesign
      ? 'Written and encrypted. One copy, by design in this environment.'
      : 'Written and encrypted to both destinations.',
  });
}

export function restoreLine({ backupVerify, now, maxAgeDays = 35 }) {
  const info = 'Proves a backup can actually be READ BACK: the archive is downloaded, '
    + 'decrypted with your passphrase, and checked against the record it wrote about '
    + 'itself. Until 18 August 2026 this had never once been done.';

  if (backupVerify === undefined) {
    return line({ key: 'restore', zone: 'today', label: 'Restore verified', state: STATE.UNKNOWN,
      info, detail: 'Not checked.', action: 'Press Check now.' });
  }
  if (!backupVerify || !backupVerify.checked_at) {
    return line({ key: 'restore', zone: 'today', label: 'Restore verified', state: STATE.CRITICAL,
      info, detail: 'No backup has ever been test-restored.',
      action: 'Press Check now. An untested backup is a hope, discovered on the worst day.' });
  }
  const days = Math.floor((new Date(now) - new Date(backupVerify.checked_at)) / 864e5);
  if (!backupVerify.ok) {
    const problems = (backupVerify.problems || []).slice(0, 3).join(' · ');
    const unreachable = /could not fetch|not configured/i.test(problems);
    return line({
      key: 'restore', zone: 'today', label: 'Restore verified', state: STATE.CRITICAL, info,
      value: `${days}d ago`, checkedAt: backupVerify.checked_at,
      detail: problems || 'The verification failed without recording a reason.',
      action: unreachable
        ? 'The archive may be fine — nothing could read it to find out. Check Backblaze caps.'
        : 'The backup could not be read back. Treat this as data at risk.',
    });
  }
  if (days > maxAgeDays) {
    return line({
      key: 'restore', zone: 'today', label: 'Restore verified', state: STATE.WARN, info,
      value: `${days}d ago`, checkedAt: backupVerify.checked_at,
      detail: 'The check itself has stopped running.',
      action: 'Press Check now. The backups may be fine — but nothing is checking.',
    });
  }
  return line({ key: 'restore', zone: 'today', label: 'Restore verified', state: STATE.OK, info,
    value: `${days}d ago`, checkedAt: backupVerify.checked_at,
    detail: 'A real archive was decrypted and verified.' });
}

/**
 * Balance expressed as DAYS OF RUNWAY, which is the form that prompts action.
 * "41,203 credits" means nothing at a glance; "6 days" books a top-up.
 */
export function balanceLine({ credits, burnPerDay, providerError, now, minCredits = 8000 }) {
  const info = 'Credits remaining at kie, the supplier behind most video models. When this '
    + 'reaches zero EVERY generation fails instantly — which is what happened on 8 August '
    + 'during a live workshop, 415 times.';

  if (providerError) {
    return line({ key: 'balance', zone: 'today', label: 'Supplier balance', state: STATE.UNKNOWN,
      info, detail: `Could not read the balance: ${providerError}`,
      action: 'Unreadable is not zero, and it is not fine. Check the kie dashboard directly.',
      checkedAt: now });
  }
  if (!Number.isFinite(credits)) {
    return line({ key: 'balance', zone: 'today', label: 'Supplier balance', state: STATE.UNKNOWN,
      info, detail: 'No balance reported.', action: 'Check the kie dashboard directly.', checkedAt: now });
  }
  const days = burnPerDay > 0 ? credits / burnPerDay : null;
  const value = days != null ? `${Math.round(credits).toLocaleString()} · ~${Math.floor(days)} days`
                             : Math.round(credits).toLocaleString();
  if (credits <= 0) {
    return line({ key: 'balance', zone: 'today', label: 'Supplier balance', state: STATE.CRITICAL,
      info, value, checkedAt: now, detail: 'Empty — generations are failing right now.',
      action: 'Top up immediately.' });
  }
  if (days != null && days < 3) {
    return line({ key: 'balance', zone: 'today', label: 'Supplier balance', state: STATE.CRITICAL,
      info, value, checkedAt: now, detail: `Runs out in about ${Math.floor(days)} days.`,
      action: 'Top up before the next workshop.' });
  }
  if (credits < minCredits) {
    return line({ key: 'balance', zone: 'today', label: 'Supplier balance', state: STATE.WARN,
      info, value, checkedAt: now, detail: 'Below the threshold you set.',
      action: 'Top up when convenient.' });
  }
  return line({ key: 'balance', zone: 'today', label: 'Supplier balance', state: STATE.OK,
    info, value, checkedAt: now, detail: 'Comfortable.' });
}

export function stuckChargesLine({ pending, oldestHours, now, thresholdHours = 2 }) {
  const info = 'Customers charged for a video that never arrived. The provider was asked, '
    + 'took the money, and nothing came back. 124 of these accumulated unnoticed before '
    + 'anything watched for them.';
  if (!pending) {
    return line({ key: 'stuck', zone: 'today', label: 'Stuck charges', state: STATE.OK,
      info, value: '0', checkedAt: now, detail: 'Nobody is waiting on a charge.' });
  }
  if ((oldestHours || 0) < thresholdHours) {
    return line({ key: 'stuck', zone: 'today', label: 'Stuck charges', state: STATE.OK,
      info, value: String(pending), checkedAt: now,
      detail: `${pending} in flight, none older than ${thresholdHours}h — normal.` });
  }
  const state = pending >= 20 ? STATE.CRITICAL : STATE.WARN;
  return line({
    key: 'stuck', zone: 'today', label: 'Stuck charges', state, info,
    value: String(pending), checkedAt: now,
    detail: `${pending} pending, oldest ${Math.floor(oldestHours)}h.`,
    action: 'Open Users → the affected customers and refund. The reconciler runs hourly.',
  });
}

export function failureRateLine({ spends, failures, accountDry, now, pct = 15, minAttempts = 25 }) {
  const info = 'How many of the last hour\'s generations came back as refunds — and whether '
    + 'the cause is OUR supplier account being empty (which fails everyone at once) or '
    + 'ordinary per-request failures like a blocked prompt.';
  const attempts = (spends || 0) + (failures || 0);
  if (attempts < minAttempts) {
    return line({ key: 'failures', zone: 'today', label: 'Failure rate', state: STATE.OK,
      info, value: `${attempts} attempts`, checkedAt: now,
      // Was a fixed sentence — "3 failures out of 4 is 75% and means nothing" —
      // printed in the DETAIL slot, where every other line puts real numbers.
      // Next to a value of "0 attempts" it read as though three requests had
      // just failed. The explanation belongs in the ⓘ, not in the data.
      detail: attempts === 0
        ? 'no generations in the last hour — nothing to judge'
        : `${failures || 0} of ${attempts} failed, which is too few attempts to draw a rate from `
          + `(a rate is only reported above ${minAttempts})` });
  }
  const rate = Math.round((failures / attempts) * 100);
  if (accountDry > 0) {
    return line({ key: 'failures', zone: 'today', label: 'Failure rate', state: STATE.CRITICAL,
      info, value: `${rate}%`, checkedAt: now,
      detail: `${accountDry} failure(s) because OUR supplier account is empty.`,
      action: 'Top up now — every customer is affected, and refunds hide it.' });
  }
  if (rate > pct) {
    return line({ key: 'failures', zone: 'today', label: 'Failure rate', state: STATE.WARN,
      info, value: `${rate}%`, checkedAt: now,
      detail: `${failures} of ${attempts} in the last hour.`,
      action: 'Check Costing → Reliability for which model is failing.' });
  }
  return line({ key: 'failures', zone: 'today', label: 'Failure rate', state: STATE.OK,
    info, value: `${rate}%`, checkedAt: now, detail: `${failures} of ${attempts} in the last hour.` });
}

export function sweepLine({ lastSweepIso, now, staleHours = 30 }) {
  const info = 'The nightly job that re-reads supplier catalogues and prices. If it stops, '
    + 'new models and price changes are silently missed — and a stale sweep looks exactly '
    + 'like a fresh one.';
  const age = hoursSince(lastSweepIso, now);
  if (age == null) {
    return line({ key: 'sweep', zone: 'today', label: 'Price sweep', state: STATE.UNKNOWN,
      info, detail: 'Has never completed.', action: 'Check the server logs for the nightly sweep.' });
  }
  if (age > staleHours) {
    return line({ key: 'sweep', zone: 'today', label: 'Price sweep', state: STATE.WARN,
      info, value: `${Math.floor(age)}h ago`, checkedAt: lastSweepIso,
      detail: 'Supplier price changes are not being picked up.',
      action: 'Check the server logs for the nightly sweep.' });
  }
  return line({ key: 'sweep', zone: 'today', label: 'Price sweep', state: STATE.OK,
    info, value: `${Math.floor(age)}h ago`, checkedAt: lastSweepIso, detail: 'Current.' });
}

/**
 * Assemble the TODAY zone from facts the alerts engine already gathers.
 * Deliberately reuses the SAME facts, so this screen and Alerts can never
 * disagree about the state of the world — two screens telling different
 * stories is worse than one screen nobody opens.
 */
export function buildToday(facts, settings = {}) {
  const now = facts.now || new Date().toISOString();
  const accountDry = (facts.recent || [])
    .filter((r) => /exhausted balance|credits insufficient|balance is insufficient/i.test(r.reason || ''))
    .length;
  return [
    backupLine({ autoBackup: facts.autoBackup, backupFreshness: facts.backupFreshness, now }),
    restoreLine({ backupVerify: facts.backupVerify, now,
      maxAgeDays: settings.restore_verify_max_age_days }),
    balanceLine({ credits: facts.credits, burnPerDay: facts.burnPerDay,
      providerError: facts.providerError, now, minCredits: settings.kie_balance_min }),
    stuckChargesLine({ pending: facts.pending, oldestHours: facts.oldestHours, now,
      thresholdHours: settings.stuck_charge_hours }),
    failureRateLine({ spends: facts.spends, failures: facts.failures, accountDry, now,
      pct: settings.failure_rate_pct, minAttempts: settings.failure_min_attempts }),
    sweepLine({ lastSweepIso: facts.lastSweepIso, now,
      staleHours: settings.catalogue_stale_hours }),
  ];
}

/** One word for the whole tab, so the nav can carry a dot. */
export function summarise(lines) {
  const state = worst(lines.map((l) => l.state));
  const counts = lines.reduce((a, l) => ({ ...a, [l.state]: (a[l.state] || 0) + 1 }), {});
  return { state, counts, total: lines.length };
}
