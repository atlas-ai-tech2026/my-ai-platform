// ─── bulk-credits.js ─────────────────────────────────────────────────────────
// Giving credits to a list of people who ALREADY have accounts.
//
// Bulk has only ever CREATED accounts. Hand it a list of returning attendees
// and it skips every one of them — its own banner says so, because the owner
// nearly did exactly that on 2026-08-20 and asked first. The batch half-works,
// which is the dangerous kind: it reads as success.
//
// ☠ THIS SPENDS REAL MONEY, SO IT SHOWS THE BILL BEFORE IT MOVES.
// 61 accounts × 158 credits is 9,638 credits — about $610. A confirm box
// saying "are you sure?" is not consent to that; a number is. So the preview
// states the accounts, the credits and the dollars, and applying sends back
// the count it was shown. If the list changed in between, that approval was
// for something else and the write is refused.
//
// ── AND ANYONE MISSING IS SAID OUT LOUD ────────────────────────────────────
// An address with no account cannot receive credits. Bulk's habit is to skip
// quietly; here it is reported as its own number, because a list where some
// entries silently do nothing is exactly what cost ten people their promo
// codes on 2026-09-02.

import { splitList } from './list-check.js';

/** Credit life, in the same words the promo code uses. */
export const STANDARD_CREDIT_DAYS = 30;

/**
 * What a top-up would do, before it does it.
 *
 * @param raw       the pasted or uploaded list
 * @param known     emails that already have accounts (from the database)
 * @param credits   how many each account receives
 * @param creditValueUsd  for the money line
 */
export function planTopUp(raw, known, { credits, creditValueUsd = 0.063333, accessDays = null } = {}) {
  const split = splitList(raw, known);
  const each = Number(credits);
  const ok = Number.isFinite(each) && each > 0;
  const n = split.existing.length;
  const total = ok ? Math.round(each * n * 100) / 100 : 0;

  return {
    ...split,
    credits_each: ok ? each : null,
    accounts: n,
    total_credits: total,
    total_usd: Math.round(total * creditValueUsd * 100) / 100,
    // Blank means the standard life, exactly as a promo code's Access days.
    days: accessDays == null || accessDays === '' ? STANDARD_CREDIT_DAYS : Number(accessDays),
    // ☠ The people this CANNOT reach. Its own number, never folded into a
    // total, because "nothing happened for these twelve" is the half of the
    // answer that gets lost.
    no_account: split.fresh,
    sentence: !ok
      ? 'Enter how many credits each account should receive.'
      : n === 0
        ? `None of these ${split.counts.usable} addresses has an account yet — nobody would receive anything. `
          + 'Create them first, or invite them to a promo code.'
        : `${n} account${n === 1 ? '' : 's'} would receive ${each} credits each — `
          + `${total.toLocaleString()} credits, about $${(total * creditValueUsd).toFixed(2)}`
          + (split.fresh.length
            ? `. ${split.fresh.length} address${split.fresh.length === 1 ? ' has' : 'es have'} no account and would receive nothing.`
            : '.'),
  };
}

/** The words written into the ledger, so the entry explains itself later. */
export function topUpReason(typed) {
  const t = String(typed ?? '').trim().slice(0, 400);
  return `bulk top-up: ${t}`;
}
