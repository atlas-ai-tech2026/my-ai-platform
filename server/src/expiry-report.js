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
