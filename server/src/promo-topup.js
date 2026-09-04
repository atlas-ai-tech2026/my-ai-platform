// ─── promo-topup.js ──────────────────────────────────────────────────────────
// Raising a promo code's value, and levelling up everyone who already used it.
//
// Owner, 2026-09-04: "They told me, please, we need to keep it with the same
// promo code, and I need to increase the credit with the same promo code and
// account." Telling a paying customer "no, take a second code" is a bad
// answer, and it is how four codes ended up named "SPA News Academy 5th".
//
// ☠ RAISING THE NUMBER ALONE WOULD DO NOTHING FOR THEM.
// A code grants its credits AT THE MOMENT OF REDEMPTION. Change the figure and
// only future redeemers are affected — the 59 people who already used it get
// nothing. And they cannot simply redeem again: the database enforces one
// redemption per person per code, and that rule is protecting the owner.
//
// So a top-up is two things at once: the code's value goes UP, and everyone
// who already redeemed receives THE DIFFERENCE. One number, everyone equal,
// past and future.
//
// ── IT ONLY GOES UP, AND THAT IS NOT LAZINESS ──────────────────────────────
// Lowering a code's value cannot take back credits people have already spent.
// A "reduction" would either do nothing or leave balances that disagree with
// the code — so it is refused, out loud, rather than half-performed.

/**
 * What raising a code to `next` credits would do.
 *
 * @param code      { code, credits, redeemed_count }
 * @param redeemed  how many people have already redeemed it
 * @param next      the new per-redemption value
 */
export function planTopUp(code, redeemed, next, { creditValueUsd = 0.063333 } = {}) {
  // ☠ Number(null) is 0, not NaN. Without this the guard below passes with
  // `now = 0`, a code whose value cannot be read is treated as WORTH NOTHING,
  // and raising it to 250 hands everybody the full 250 — from a code we could
  // not read. Caught by its own test before it could run.
  const raw = code?.credits;
  const now = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  const want = Number(next);
  const people = Number(redeemed) || 0;

  if (!Number.isFinite(want) || want <= 0) {
    return { ok: false, reason: 'no-value', sentence: 'Enter the new value for this code.' };
  }
  if (!Number.isFinite(now)) {
    return { ok: false, reason: 'unreadable', sentence: 'This code has no readable credit value.' };
  }
  if (want === now) {
    return { ok: false, reason: 'unchanged',
      sentence: `${code.code} is already worth ${now} credits.` };
  }
  if (want < now) {
    return { ok: false, reason: 'lower',
      sentence: `${code.code} is worth ${now} credits and cannot be lowered to ${want}. `
        + 'Credits people have already spent cannot be taken back, so a reduction would either '
        + 'do nothing or leave balances that disagree with the code. Deactivate it and issue a '
        + 'new one instead.' };
  }

  const each = Math.round((want - now) * 100) / 100;
  const total = Math.round(each * people * 100) / 100;
  return {
    ok: true,
    from: now, to: want, each, people,
    total_credits: total,
    total_usd: Math.round(total * creditValueUsd * 100) / 100,
    sentence: people
      ? `Raise ${code.code} from ${now} to ${want} credits. `
        + `${people} ${people === 1 ? 'person who has' : 'people who have'} already redeemed it `
        + `will each receive ${each} more — ${total.toLocaleString()} credits, about `
        + `$${(total * creditValueUsd).toFixed(2)}. Anyone redeeming from now on gets ${want}.`
      : `Raise ${code.code} from ${now} to ${want} credits. Nobody has redeemed it yet, so no `
        + `credits are given out now — everyone who redeems from here gets ${want}.`,
  };
}

/** The words in the ledger, so the entry explains itself a year later. */
export function topUpReason(code, from, to) {
  return `promo top-up: ${code} ${from} → ${to}`;
}
