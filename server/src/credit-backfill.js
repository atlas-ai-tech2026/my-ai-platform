// ─── credit-backfill.js ──────────────────────────────────────────────────────
// Give the credits that already exist their addition dates.
//
// The owner's rule (2026-08-25, confirmed twice — THIRTY days, the
// transcription's "thirteen" was checked and corrected): every credit addition
// lives 30 days from the day it was added, and it applies to credits already
// sitting in accounts, dated from when they were actually added.
//
// The ledger (credits_history) has every addition with its date. The balance
// is one pooled number. This module decides — purely, no database, no clock of
// its own — how today's balance maps back onto those dated additions.
//
// ── WHY NEWEST-FIRST ───────────────────────────────────────────────────────
// Spending drains soonest-expiring first, which for same-life lots means
// oldest first. So whatever remains of a balance belongs to the NEWEST
// additions — the old ones were spent first. Attributing newest-first is not
// a choice among equals; it is the only attribution consistent with the
// spending order the system itself uses.
//
// ── THE REMAINDER THE LEDGER CANNOT EXPLAIN ────────────────────────────────
// A balance larger than the sum of recorded additions (rows before the ledger
// existed, or gaps) leaves an unattributed remainder. It becomes ONE lot dated
// from the backfill moment with the standard life — a fair 30 days, visibly
// labelled 'backfill-unattributed', never silently dropped and never silently
// expired. The preview names it before anything is taken.

import { round2 } from './credit-lots.js';

export const CREDIT_LIFE_DAYS = 30;
const DAY_MS = 86400000;

const at = (v) => (v instanceof Date ? v : new Date(v));

/**
 * Map a user's current balance onto their dated additions.
 *
 * @param balance  users.credits right now
 * @param additions POSITIVE ledger rows [{amount, action, reason, created_at}],
 *                  any order — sorted newest-first here so callers can't get
 *                  the attribution wrong by querying differently.
 * @param now      the backfill moment (passed in; nothing reads the clock)
 * @param days     lot life; the 30-day standard unless a test says otherwise
 * @returns { lots, attributed, unattributed } — lots carry amount, remaining,
 *          source, reason, granted_at, expires_at, ready to INSERT.
 */
export function planBackfill({ balance, additions = [], now = Date.now(), days = CREDIT_LIFE_DAYS }) {
  const total = round2(balance);
  if (!(total > 0)) return { lots: [], attributed: 0, unattributed: 0 };

  const rows = additions
    .filter((r) => Number(r.amount) > 0)
    .slice()
    .sort((a, b) => at(b.created_at).getTime() - at(a.created_at).getTime());

  const lots = [];
  let left = total;
  for (const row of rows) {
    if (left <= 0) break;
    const take = round2(Math.min(Number(row.amount), left));
    if (take <= 0) continue;
    const granted = at(row.created_at);
    lots.push({
      amount: take,
      remaining: take,
      source: 'backfill',
      reason: `backfill: ${row.action}${row.reason ? ` — ${String(row.reason).slice(0, 200)}` : ''}`,
      granted_at: granted,
      expires_at: new Date(granted.getTime() + days * DAY_MS),
    });
    left = round2(left - take);
  }

  const attributed = round2(total - left);
  let unattributed = 0;
  if (left > 0) {
    // Dated from now, not from a guess: expiring it instantly would punish
    // the customer for OUR missing records, and hiding it would make the
    // balance and the lots disagree forever.
    unattributed = left;
    const granted = at(now);
    lots.push({
      amount: left,
      remaining: left,
      source: 'backfill-unattributed',
      reason: 'backfill: balance the ledger could not account for — given the standard life from the backfill date',
      granted_at: granted,
      expires_at: new Date(granted.getTime() + days * DAY_MS),
    });
  }

  return { lots, attributed, unattributed };
}
