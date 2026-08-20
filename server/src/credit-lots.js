// ─── credit-lots.js ──────────────────────────────────────────────────────────
// Credits that carry their own expiry, spent soonest-to-expire first.
//
// ── WHY ────────────────────────────────────────────────────────────────────
// `users.credits` is ONE pooled number and `users.expires_at` is ONE
// account-level date. So the owner's case had no answer:
//
//   10 promo credits expiring 1 September
// + 100 bulk credits expiring 15 September
// = 110 credits expiring 15 September
//
// The promo silently gained two weeks. Every time that person appears in a
// later batch it happens again, so a 15-day code becomes a month whenever
// someone is re-invited. At workshop scale that is revenue leaking quietly.
//
// ── THE ORDER, AND WHY IT IS THE ONLY SENSIBLE ONE ─────────────────────────
// The owner asked the right question before being told: how does the system
// know which credits to spend first? SOONEST TO EXPIRE. The 10 drain before
// the 100.
//
// Any other order deliberately wastes the credits nearest death: the customer
// watches 10 credits expire on 1 September while 100 sit untouched, and every
// one of those is a support message. First-expiring-first is the only rule
// under which nobody loses credits they could have used.
//
// A lot that NEVER expires sorts LAST for the same reason — undated credits
// can wait, dated ones cannot.
//
// ── WHAT THIS FILE IS, AND IS NOT ──────────────────────────────────────────
// Pure decisions only: given lots and an amount, which lots pay and how much.
// No database, no clock of its own. That is deliberate — this is the money
// path, and the money path should be exhaustively testable without a server,
// a connection, or a mock that agrees with whatever I assumed.

/** Nothing here reads the clock on its own; `now` is always passed in. */
const at = (v) => (v == null ? null : (v instanceof Date ? v : new Date(v)));

/** Currency-safe arithmetic: credits are NUMERIC(10,2) and floats drift. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Has this lot's expiry passed? A lot with no expiry never has. */
export function isExpired(lot, now = Date.now()) {
  const exp = at(lot?.expires_at);
  if (!exp) return false;
  return exp.getTime() <= new Date(now).getTime();
}

/** Lots that can still pay for something, in the order they should be spent. */
export function spendOrder(lots = [], now = Date.now()) {
  return lots
    .filter((l) => Number(l.remaining) > 0 && !isExpired(l, now))
    .sort((a, b) => {
      const ea = at(a.expires_at);
      const eb = at(b.expires_at);
      // A lot that never expires goes last: undated credits can wait, dated
      // ones cannot. Putting them first would let dated credits die untouched,
      // which is the exact waste this ordering exists to prevent.
      if (!ea && !eb) return byAge(a, b);
      if (!ea) return 1;
      if (!eb) return -1;
      const d = ea.getTime() - eb.getTime();
      // Same expiry — oldest grant first, so behaviour is deterministic
      // rather than dependent on whatever order the rows came back in.
      return d !== 0 ? d : byAge(a, b);
    });
}

function byAge(a, b) {
  const ca = at(a.created_at)?.getTime() ?? 0;
  const cb = at(b.created_at)?.getTime() ?? 0;
  return ca !== cb ? ca - cb : (a.id ?? 0) - (b.id ?? 0);
}

/** What is actually spendable right now. Expired lots count for nothing. */
export function liveBalance(lots = [], now = Date.now()) {
  return round2(spendOrder(lots, now).reduce((n, l) => n + Number(l.remaining), 0));
}

/**
 * Which lots pay for a charge, and how much each gives.
 *
 * Returns a PLAN, and performs nothing — so the same function that decides can
 * be tested to exhaustion, and the caller can refuse to write anything when
 * `ok` is false. A partial spend is never returned as a success: charging 30
 * against a balance of 20 must fail whole, not silently take what it can.
 */
export function planSpend(lots = [], amount, now = Date.now()) {
  const want = round2(amount);
  if (!(want > 0)) return { ok: false, reason: 'amount must be positive', draws: [], spent: 0 };

  const available = liveBalance(lots, now);
  if (available < want) {
    return {
      ok: false,
      reason: 'insufficient',
      shortfall: round2(want - available),
      available,
      draws: [],
      spent: 0,
    };
  }

  const draws = [];
  let left = want;
  for (const lot of spendOrder(lots, now)) {
    if (left <= 0) break;
    const take = round2(Math.min(Number(lot.remaining), left));
    if (take <= 0) continue;
    draws.push({ lotId: lot.id, take, remainingAfter: round2(Number(lot.remaining) - take) });
    left = round2(left - take);
  }
  return { ok: true, draws, spent: want, balanceAfter: round2(available - want) };
}

/**
 * Where a refund goes back to.
 *
 * Back to the lot it came from — that is the honest reversal, and it keeps the
 * refunded credits on their original expiry rather than quietly extending them.
 *
 * BUT NOT IF THAT LOT HAS SINCE EXPIRED. A refund exists because something on
 * OUR side failed, and the stuck-charge sweeper can settle hours after the
 * charge. Returning credits into a dead lot would mean a customer loses them to
 * a timing accident caused by our own outage. In that case they go to the
 * newest live lot instead, and if the person has none, the refund says so
 * rather than silently vanishing.
 */
export function planRefund(lots = [], draws = [], now = Date.now()) {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const live = spendOrder(lots, now);
  // Newest LIVE lot as the fallback: it has the most life left, so a customer
  // compensated for our failure gets the longest usable window.
  const fallback = live.length ? live[live.length - 1] : null;

  const returns = [];
  let orphaned = 0;
  for (const d of draws) {
    const lot = byId.get(d.lotId);
    const amount = round2(d.take);
    if (amount <= 0) continue;
    if (lot && !isExpired(lot, now)) {
      returns.push({ lotId: lot.id, amount, to: 'original' });
    } else if (fallback) {
      returns.push({ lotId: fallback.id, amount, to: 'newest-live', originalLotId: d.lotId });
    } else {
      // Nowhere live to put it. Reported, never dropped on the floor — a
      // refund that disappears silently is how a balance and its ledger start
      // disagreeing, and nobody notices until a customer counts.
      orphaned = round2(orphaned + amount);
    }
  }
  return { returns, orphaned, refunded: round2(returns.reduce((n, r) => n + r.amount, 0)) };
}

/**
 * What to tell the customer.
 *
 * A bare "110" is how the first of September becomes "my credits disappeared".
 * The soonest expiry is stated because it is the one that will bite.
 */
export function describeBalance(lots = [], now = Date.now()) {
  const live = spendOrder(lots, now);
  const total = liveBalance(lots, now);
  const dated = live.filter((l) => at(l.expires_at));
  if (!dated.length) {
    return { total, soonest: null, soonestAmount: 0, text: `${total} credits` };
  }
  // spendOrder already put the soonest-expiring first.
  const next = dated[0];
  const when = at(next.expires_at);
  const sameDay = dated.filter(
    (l) => at(l.expires_at).toISOString().slice(0, 10) === when.toISOString().slice(0, 10));
  const amount = round2(sameDay.reduce((n, l) => n + Number(l.remaining), 0));
  return {
    total,
    soonest: when.toISOString(),
    soonestAmount: amount,
    text: `${total} credits · ${amount} expiring ${when.toISOString().slice(0, 10)}`,
  };
}

/** Lots whose time has passed and still hold credits — what a sweep zeroes. */
export function expiredLots(lots = [], now = Date.now()) {
  return lots.filter((l) => Number(l.remaining) > 0 && isExpired(l, now));
}
