// ─── expiry-report.js ────────────────────────────────────────────────────────
// Which accounts lose access, and when.
//
// ── WHY THIS EXISTS, AND WHY IT WAS URGENT ─────────────────────────────────
// The owner asked on 2026-08-20, about accounts created on 21–23 June:
// "as per our standard, all these accounts will expire tomorrow... I need a
// proper answer."
//
// There was no way to answer it. The Users tab shows an access column per row —
// "open", "12d left", "EXPIRED" — and nothing sorts or filters by it. Finding
// who expires tomorrow meant scrolling 601 rows reading a column, which is not
// an answer, it is a chore that produces a guess.
//
// And NOTHING warned. No alert, no SOP line, no email. An account's access
// ended at a moment nobody had been told about, and the first sign was a
// customer unable to sign in — possibly in the middle of a workshop they had
// paid for.
//
// ── WHAT EXPIRY ACTUALLY DOES, BECAUSE THE FEAR IS WORSE THAN THE FACT ─────
// Verified in the code, both enforcement points:
//   · Login is refused — password sign-in and Google/Microsoft alike.
//   · NOTHING IS DELETED. The account row, its credits, its whole generation
//     history all stay exactly where they are.
//   · It is fully reversible: clear or extend the date and the person signs
//     straight back in with the same password and the same balance.
// It is a lock on the door, not a demolition. That distinction is the first
// thing anyone asking this question needs to hear.

/** Accounts inside this window are the ones worth acting on before the weekend. */
export const SOON_DAYS = 14;

const startOfDay = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

/** Whole days from now until an expiry. Negative once it has passed. */
export function daysUntil(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return null;
  return Math.round((startOfDay(when) - startOfDay(now)) / 86400000);
}

/**
 * Group accounts by the DAY their access ends.
 *
 * By day rather than by account, because the question is never "when does
 * ahmed expire" — it is "who goes tomorrow, and is that a workshop".
 *
 * Accounts with no expiry are counted separately and NOT called safe. They are
 * open-ended, which was itself the problem on 2026-08-11 when 584 of 587
 * accounts sat that way and nobody could see it.
 */
export function groupByExpiryDay(users = [], now = Date.now()) {
  const days = new Map();
  let openEnded = 0;
  let alreadyExpired = 0;

  for (const u of users) {
    if (!u.expires_at) { openEnded += 1; continue; }
    const when = new Date(u.expires_at);
    if (Number.isNaN(when.getTime())) { openEnded += 1; continue; }
    const day = when.toISOString().slice(0, 10);
    const left = daysUntil(when, now);
    if (left < 0) alreadyExpired += 1;
    const g = days.get(day) || { day, daysLeft: left, accounts: [], credits: 0 };
    g.accounts.push({
      id: u.id,
      email: u.email,
      credits: Number(u.credits) || 0,
      package: u.package || null,
      // The exact moment, not just the date. An expiry stored as a bare date is
      // MIDNIGHT UTC — which is 3am in Kuwait, so "expires on the 21st" means
      // access ends in the small hours of the 21st, not at the end of it.
      at: when.toISOString(),
    });
    g.credits += Number(u.credits) || 0;
    days.set(day, g);
  }

  return {
    days: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    openEnded,
    alreadyExpired,
    total: users.length,
  };
}

/**
 * The sentence the owner actually needs.
 *
 * Written to be read once, quickly, and to lead with the number of PEOPLE
 * rather than the number of accounts — and to say plainly that nothing is
 * destroyed, because that is the fear behind the question.
 */
export function summarise(report, now = Date.now()) {
  const soon = report.days.filter((d) => d.daysLeft >= 0 && d.daysLeft <= SOON_DAYS);
  const tomorrow = report.days.find((d) => d.daysLeft === 1);
  const today = report.days.find((d) => d.daysLeft === 0);

  const people = soon.reduce((n, d) => n + d.accounts.length, 0);
  const credits = soon.reduce((n, d) => n + d.credits, 0);

  const parts = [];
  if (today) parts.push(`${today.accounts.length} lose access TODAY`);
  if (tomorrow) parts.push(`${tomorrow.accounts.length} lose access TOMORROW`);
  if (!today && !tomorrow) {
    parts.push(soon.length
      ? `nothing today or tomorrow — the next is ${soon[0].day} (${soon[0].daysLeft} days)`
      : `nothing expires in the next ${SOON_DAYS} days`);
  }

  return {
    headline: parts.join(' · '),
    withinWindow: people,
    creditsAffected: Math.round(credits * 100) / 100,
    openEnded: report.openEnded,
    alreadyExpired: report.alreadyExpired,
    // Repeated on every response deliberately. Somebody reading "47 accounts
    // expire tomorrow" at speed needs the next clause more than any other.
    reassurance: 'Expiry blocks sign-in only. No account, credit or generation is '
      + 'deleted, and clearing or extending the date restores access immediately.',
    now: new Date(now).toISOString(),
  };
}

/** The accounts a person would want to act on, newest deadline first. */
export function actionable(report, withinDays = SOON_DAYS) {
  return report.days
    .filter((d) => d.daysLeft >= 0 && d.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}


// ── THE MANUAL-GRANT STANDARD (owner, 2026-08-20) ──────────────────────────
// "I connect manually, and I added must to be thirty days."
//
// Verified before writing this: a manual grant runs exactly one statement —
// UPDATE users SET credits, credit_limit — and never touches expires_at. So
// credits handed out by hand had no expiry at all, and on an open-ended account
// they lived forever. Promo codes carry their own access_days and bulk carries
// its own date; this is only about the manual path.

export const MANUAL_GRANT_DAYS = 30;

/**
 * The expiry a MANUAL grant should leave behind.
 *
 * Never shortens. A grant is someone being given something; it must not also
 * quietly remove access they already hold. If they have 90 days, they keep 90.
 *
 * NOTE the honest limit: while credit lots (#67) are parked, expiry is per
 * ACCOUNT, not per grant — so on an account with 90 days left, the newly
 * granted credits live 90 days rather than 30. Exact per-grant expiry needs
 * that task. Stated here rather than left for someone to discover.
 */
export function expiryAfterManualGrant(currentExpiresAt, now = Date.now(), days = MANUAL_GRANT_DAYS) {
  const target = new Date(new Date(now).getTime() + days * 86400000);
  if (!currentExpiresAt) return { value: target, changed: true, reason: 'had no expiry' };
  const cur = new Date(currentExpiresAt);
  if (Number.isNaN(cur.getTime())) return { value: target, changed: true, reason: 'had an unreadable expiry' };
  if (cur >= target) return { value: cur, changed: false, reason: 'already has longer than 30 days' };
  return { value: target, changed: true, reason: 'extended to 30 days' };
}

/**
 * What a RETROACTIVE normalisation would do to every existing account.
 *
 * The owner chose, against my recommendation and having read it, to apply the
 * 30-day standard to accounts that already exist — including ones currently
 * holding MORE than 30 days, which this shortens.
 *
 * So this computes the change and performs nothing. It exists to be READ
 * first: 584 of 587 accounts had no expiry as of 2026-08-11, which means most
 * of the customer base gets a lock date, and some of that access was paid for.
 * A change of that size must be looked at before it is made, not explained
 * afterwards.
 *
 * Admins are never touched — locking the owner out of their own panel is not a
 * policy, it is an outage.
 */
export function planNormalisation(users = [], now = Date.now(), days = MANUAL_GRANT_DAYS) {
  const target = new Date(new Date(now).getTime() + days * 86400000);
  const shortened = [];
  const opened = [];
  const extended = [];
  const unchanged = [];
  const skippedAdmins = [];

  for (const u of users) {
    if (u.role === 'admin') { skippedAdmins.push(u.email); continue; }
    const cur = u.expires_at ? new Date(u.expires_at) : null;
    const row = {
      id: u.id, email: u.email, credits: Number(u.credits) || 0,
      from: cur && !Number.isNaN(cur.getTime()) ? cur.toISOString() : null,
      to: target.toISOString(),
    };
    if (!cur || Number.isNaN(cur.getTime())) { opened.push(row); continue; }
    const diffDays = Math.round((cur - target) / 86400000);
    if (diffDays > 0) shortened.push({ ...row, daysLost: diffDays });
    else if (diffDays < 0) extended.push({ ...row, daysGained: -diffDays });
    else unchanged.push(row);
  }

  return {
    target: target.toISOString(),
    // Ordered worst-first: the accounts losing the most are the ones a person
    // needs to see, and burying them under a count is how a list stops being read.
    shortened: shortened.sort((a, b) => b.daysLost - a.daysLost),
    opened, extended, unchanged, skippedAdmins,
    counts: {
      shortened: shortened.length,
      openEnded: opened.length,
      extended: extended.length,
      unchanged: unchanged.length,
      admins: skippedAdmins.length,
      total: users.length,
    },
    creditsBehindShortened:
      Math.round(shortened.reduce((n, r) => n + r.credits, 0) * 100) / 100,
  };
}


// ── EXPIRING CREDITS THAT HAVE RUN PAST THEIR 30 DAYS ──────────────────────
// Owner, 2026-08-20, reaffirmed after I recommended against it: "not only for
// promo code. Even before promo code, we created a lot of users manually...
// if they exceed the thirty days, retrieve the credits, and this credit will
// expire."
//
// I argued for expiring ACCESS and leaving balances alone — locked-out credits
// are already unspendable, and the balance is the record of what a paying
// customer was given. They have decided otherwise, which is their call, so this
// does the whole thing: access AND balance.
//
// ── WHAT MAKES IT SAFE TO HAVE BUILT ───────────────────────────────────────
// It computes a plan and performs nothing. Nothing runs on deploy, nothing runs
// on a schedule. The owner reads the list — who, how many credits, how far past
// — and presses the button. That is the same shape as the bulk expiry already
// in the panel, and it is why a destructive change to hundreds of paying
// customers can exist in the code at all.
//
// Every removal writes a LEDGER ROW. A balance that changes with no record is
// how a customer dispute becomes unanswerable, and it is the difference between
// an expiry and a disappearance.

/**
 * The clock starts at the LATER of: the account being created, or the last time
 * credits were granted.
 *
 * Stated deliberately, because the alternative is cruel and arithmetically
 * enormous: measuring purely from creation would expire someone who was topped
 * up last week simply because they joined in May. Their thirty days restarted
 * when they were given something.
 */
export function clockStart(user) {
  const created = user.created_at ? new Date(user.created_at) : null;
  const granted = user.last_grant_at ? new Date(user.last_grant_at) : null;
  const valid = [created, granted].filter((d) => d && !Number.isNaN(d.getTime()));
  if (!valid.length) return null;
  return new Date(Math.max(...valid.map((d) => d.getTime())));
}

/**
 * Who has run past their window, and what it would cost them.
 *
 * Accounts with NOTHING to take are left out entirely — expiring a zero balance
 * writes a ledger row that says nothing happened, and pads the list the owner
 * has to read with rows that do not matter.
 */
export function planCreditExpiry(users = [], now = Date.now(), days = MANUAL_GRANT_DAYS) {
  const cutoff = new Date(new Date(now).getTime() - days * 86400000);
  const due = [];
  const skippedAdmins = [];
  let notYet = 0;
  let nothingToTake = 0;

  for (const u of users) {
    if (u.role === 'admin') { skippedAdmins.push(u.email); continue; }
    const start = clockStart(u);
    if (!start) { notYet += 1; continue; }
    if (start > cutoff) { notYet += 1; continue; }
    const credits = Number(u.credits) || 0;
    if (credits <= 0) { nothingToTake += 1; continue; }
    due.push({
      id: u.id,
      email: u.email,
      credits: Math.round(credits * 100) / 100,
      since: start.toISOString(),
      daysPast: Math.floor((new Date(now) - start) / 86400000) - days,
      basis: (u.last_grant_at && new Date(u.last_grant_at) >= new Date(u.created_at || 0))
        ? 'last credit grant' : 'account created',
    });
  }

  return {
    // Most credits first: the accounts where this costs the most are the ones
    // worth a second thought, and a list ordered by id buries them.
    due: due.sort((a, b) => b.credits - a.credits),
    creditsToExpire: Math.round(due.reduce((n, r) => n + r.credits, 0) * 100) / 100,
    counts: {
      due: due.length,
      notYet,
      nothingToTake,
      admins: skippedAdmins.length,
      total: users.length,
    },
    cutoff: cutoff.toISOString(),
    windowDays: days,
  };
}
