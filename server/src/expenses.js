// ─── expenses.js ─────────────────────────────────────────────────────────────
// What this business actually costs to run, and how many customers cover it.
//
// ── WHY ────────────────────────────────────────────────────────────────────
// Requested 2026-08-19. Costs are spread across DigitalOcean, GoDaddy,
// Microsoft 365, Backblaze, Resend, Claude, FAL and kie, and nowhere adds them
// up. Without the total there is no break-even figure, so nobody can say
// whether a workshop was profitable — which makes quoting one a guess.
//
// ── WHAT IS TYPED AND WHAT IS MEASURED ─────────────────────────────────────
// FAL and kie are NEVER typed. Every generation already records fal_cost and
// kie_credits on its ledger row, so those are measured. Asking for them by hand
// would be work that is stale the moment it is entered and less accurate than
// what is already held.
//
// DigitalOcean is not typed either: its API returns real invoices, month by
// month, using the token the platform already has.
//
// What IS typed is the handful that barely moves — a domain renewal, a mailbox,
// a subscription. Six numbers a year beats six integrations to maintain, and
// none of them needs a password stored anywhere.
//
// ── THE DECISIONS, MADE BY THE OWNER ON 2026-08-19 ─────────────────────────
//   · USD throughout.
//   · Dated by the INVOICE date received, so months line up with reality rather
//     than with when somebody got round to typing it.
//   · Claude IS included, in its own category. The question being answered is
//     what the BUSINESS costs to run, not what the servers cost.
//   · Monthly, annual and one-time all allowed.
//   · Cancelled entries are MARKED, never deleted — a cost that vanishes from
//     history makes last quarter look wrong.

/** How a recurring cost is charged. */
export const CYCLES = ['monthly', 'annual', 'one-time'];

/** Renewal warnings, in the same discipline as the storage quota: BEFORE. */
export const RENEWAL_WARN_DAYS = [60, 30, 7];

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Everything reduced to a monthly figure, so unlike things can be added up.
 *
 * A one-time cost contributes NOTHING to the monthly run rate. It is real money
 * and it belongs in the totals for its own month, but spreading it across the
 * year would quietly inflate the break-even figure with something that will not
 * happen again — and break-even is the number this whole tab exists to produce.
 */
export function monthlyCost(expense) {
  const amount = Number(expense?.amount) || 0;
  if (amount <= 0) return 0;
  switch (expense.cycle) {
    case 'monthly': return round2(amount);
    case 'annual': return round2(amount / 12);
    case 'one-time': return 0;
    default: return 0;
  }
}

/** Live costs only. Cancelled ones stay in history but stop counting. */
export const isActive = (e) => !e?.cancelled_at;

/**
 * The monthly run rate: what it costs to keep the lights on.
 *
 * Fixed (typed) and variable (measured) are kept apart on purpose. Only the
 * fixed part belongs in break-even — variable cost rises WITH customers, so
 * folding it in would mean the answer moved every time somebody generated
 * an image.
 */
export function runRate(expenses = [], measured = { fal: 0, kie: 0 }) {
  const active = expenses.filter(isActive);
  const fixed = round2(active.reduce((n, e) => n + monthlyCost(e), 0));
  const variable = round2((Number(measured.fal) || 0) + (Number(measured.kie) || 0));
  return {
    fixed,
    variable,
    total: round2(fixed + variable),
    byCategory: byCategory(active),
    cancelled: expenses.filter((e) => !isActive(e)).length,
  };
}

export function byCategory(expenses = []) {
  const map = new Map();
  for (const e of expenses) {
    const key = e.category || 'other';
    map.set(key, round2((map.get(key) || 0) + monthlyCost(e)));
  }
  return [...map.entries()]
    .map(([category, monthly]) => ({ category, monthly }))
    .sort((a, b) => b.monthly - a.monthly);
}

/**
 * How many paying customers cover the overheads.
 *
 * THE NUMBER THAT MAKES A WORKSHOP QUOTABLE. Deliberately uses FIXED cost only:
 * variable cost scales with usage, so including it would make break-even a
 * moving target that answers nothing.
 *
 * Returns null rather than Infinity or a guess when margin is unknown — a
 * break-even of "∞" on a screen reads as a bug, and a made-up margin reads as a
 * fact.
 */
export function breakEven(fixedMonthly, marginPerSubscription) {
  const margin = Number(marginPerSubscription);
  if (!Number.isFinite(margin) || margin <= 0) return null;
  const fixed = Number(fixedMonthly) || 0;
  return {
    subscriptions: Math.ceil(fixed / margin),
    marginUsed: round2(margin),
    fixedMonthly: round2(fixed),
  };
}

/**
 * What is about to renew, and how urgently.
 *
 * ── THE DANGEROUS ONE IS THE DOMAIN ────────────────────────────────────────
 * If voxel-ai.ai lapses, the site AND every email address stop — including the
 * address password resets are sent from. That is not "a bill was missed", it is
 * the platform and the ability to recover it, gone together. So this warns at
 * 60, 30 and 7 days: before, never on the day.
 */
/**
 * A renewal date is a CALENDAR DAY, not a moment — and reading it as a moment
 * was wrong by a whole day.
 *
 * node-postgres hands back a DATE column as LOCAL midnight. In Kuwait (UTC+3)
 * the 26th arrives as 2026-08-25T21:00Z, so flooring it in UTC produced the
 * 25th: every renewal displayed a day early, and would have read OVERDUE a day
 * before it was. Found on 2026-08-21 by a check that expected 5 days and got 4.
 *
 * So the calendar parts are taken as they were written — local for a Date that
 * pg built locally, verbatim for a 'YYYY-MM-DD' string — and compared as days,
 * never as timestamps.
 */
export function calendarDay(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days between two calendar days, with no timezone in the arithmetic. */
export function daysBetween(fromDay, toDay) {
  if (!fromDay || !toDay) return null;
  const ms = (day) => Date.UTC(...day.split('-').map((n, i) => (i === 1 ? +n - 1 : +n)));
  return Math.round((ms(toDay) - ms(fromDay)) / 86400000);
}

export function renewals(expenses = [], now = Date.now()) {
  const today = calendarDay(new Date(now));

  return expenses
    .filter(isActive)
    .filter((e) => e.renews_on)
    .map((e) => {
      const day = calendarDay(e.renews_on);
      if (!day) return null;
      const days = daysBetween(today, day);
      return {
        id: e.id,
        name: e.name,
        amount: round2(Number(e.amount) || 0),
        cycle: e.cycle,
        renews_on: day,
        daysLeft: days,
        // Only three states, because a scale of severity nobody agreed on is
        // just colour. Past due is its own thing: it has already happened.
        state: days < 0 ? 'overdue'
          : days <= 7 ? 'critical'
          : days <= 30 ? 'warn'
          : days <= 60 ? 'soon' : 'ok',
        critical: Boolean(e.critical),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** The line the screen leads with. */
export function renewalHeadline(list = []) {
  const overdue = list.filter((r) => r.state === 'overdue');
  const soon = list.filter((r) => ['critical', 'warn'].includes(r.state));
  if (overdue.length) {
    const worst = overdue.find((r) => r.critical) || overdue[0];
    return {
      state: 'overdue',
      text: `${worst.name} renewal date has passed`
        + (overdue.length > 1 ? ` (and ${overdue.length - 1} more)` : ''),
    };
  }
  if (soon.length) {
    const next = soon[0];
    return {
      state: next.state,
      text: `${next.name} renews in ${next.daysLeft} day${next.daysLeft === 1 ? '' : 's'}`
        + (soon.length > 1 ? ` · ${soon.length - 1} more within 30 days` : ''),
    };
  }
  return { state: 'ok', text: 'nothing renews in the next 30 days' };
}

/**
 * Month-by-month totals, so a rising bill is visible before it is a surprise.
 *
 * Fixed and variable stay separate here too: a jump in the variable line means
 * customers generated more, which is good news, and a jump in the fixed line
 * means a subscription changed, which is not.
 */
export function monthlySeries({ invoices = [], measured = [], months = 6, now = Date.now() }) {
  const out = [];
  const cur = new Date(now);
  cur.setUTCDate(1);
  cur.setUTCHours(0, 0, 0, 0);
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const forMonth = invoices.filter((r) => String(r.month) === key);
    const inv = forMonth.reduce((n, r) => n + (Number(r.amount) || 0), 0);
    // A month still accruing is labelled, never presented as a settled bill.
    const isPreview = forMonth.some((r) => r.preview);
    const m = measured.find((r) => String(r.month) === key);
    out.push({
      month: key,
      infrastructure: round2(inv),
      preview: isPreview,
      suppliers: round2((Number(m?.fal) || 0) + (Number(m?.kie) || 0)),
      total: round2(inv + (Number(m?.fal) || 0) + (Number(m?.kie) || 0)),
    });
  }
  return out;
}
