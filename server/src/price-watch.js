// ─── price-watch.js ──────────────────────────────────────────────────────────
// Noticing when a supplier changes a price, and working out what our sale price
// would have to become to hold the margin.
//
// Until now the catalogue sweep was INSERT-ONLY (`ON CONFLICT DO NOTHING`): it
// discovered models we did not sell and never once looked at a price it had
// already recorded. A supplier could double a price and nothing anywhere would
// say so — the margin would simply erode, silently, which is the same class of
// failure as the reconciler that returned 'pending' forever.
//
// ── WHY NOTHING HERE APPLIES ITSELF ──────────────────────────────────────────
//
// This module DECIDES NOTHING about what a customer pays. It computes a
// proposal and hands it to a human. That is deliberate, and it is not caution
// for its own sake:
//
//   fal states prices in prose that mixes per-second, per-megapixel and token
//   billing, and it has already produced confidently wrong numbers twice in
//   this project. An unattended 40%-margin rule fed one bad parse would
//   multiply a customer's price by ten, overnight, with nobody watching.
//
// C1 of the July audit made pricing.js the single charging authority. A path
// from a third party's API straight to a customer's price would undo that, so
// the queue exists as the gate: detect → compute → REVIEW → apply.
//
// ── THE ASYMMETRY, WHICH IS THE OWNER'S RULE ────────────────────────────────
// A price RISE erodes margin, so it needs action. A price FALL just widens the
// margin, so it is recorded and reported but never lowers what we charge.

/** Below this, a move is rounding or noise rather than a price change. */
export const MIN_PCT = 1;

/**
 * Above this, treat the jump as suspect rather than real. Held for explicit
 * confirmation even when the owner has approved everything else — a supplier
 * genuinely doubling a price is rare; a misparsed unit is not.
 */
export const SUSPECT_PCT = 50;

/** Percent change, positive = more expensive. Null when it cannot be computed. */
export function pctChange(oldUsd, newUsd) {
  const a = Number(oldUsd), b = Number(newUsd);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return null;
  return Math.round(((b - a) / a) * 10000) / 100;
}

/**
 * What kind of move this is.
 *
 *   'none'        — unchanged, or too small to act on
 *   'decrease'    — cheaper: recorded, reported, never changes our price
 *   'increase'    — dearer: our price must rise to hold the margin
 *   'needs_check' — too large to believe; almost certainly a parse error
 *   'unknown'     — a price appeared or vanished; nothing to compare
 */
export function classify(oldUsd, newUsd, { suspectPct = SUSPECT_PCT, minPct = MIN_PCT } = {}) {
  const a = Number(oldUsd), b = Number(newUsd);
  const had = Number.isFinite(a) && a > 0;
  const has = Number.isFinite(b) && b > 0;
  if (!had || !has) return { kind: 'unknown', pct: null };

  const pct = pctChange(a, b);
  if (pct === null || Math.abs(pct) < minPct) return { kind: 'none', pct };
  // Magnitude, not direction: a price collapsing by 90% is just as likely to be
  // a bad parse as one tripling, and acting on it would give the product away.
  if (Math.abs(pct) >= suspectPct) return { kind: 'needs_check', pct };
  return { kind: pct > 0 ? 'increase' : 'decrease', pct };
}

/**
 * The sale price that holds the target margin against a new supplier cost.
 *
 * Deliberately mirrors costing-engine's formula rather than importing it: this
 * runs against a SUPPLIER price for one model family, where the engine works on
 * a costing row with two suppliers and overrides. Same arithmetic, different
 * input — and `basis` here is the caller's business, because the margin rule is
 * MAX(fal, kie): a fal rise only matters if fal is the dearer of the two.
 */
export function saleCreditsFor(basisUsd, { marginTarget = 0.4, usdPerCredit = 0.063333 } = {}) {
  const basis = Number(basisUsd);
  if (!Number.isFinite(basis) || basis <= 0) return null;
  if (!(marginTarget >= 0 && marginTarget < 1)) return null;
  const saleUsd = basis / (1 - marginTarget);
  // Half-credit granularity, always rounding UP: rounding down would sell below
  // the margin the whole rule exists to protect.
  return Math.ceil((saleUsd / usdPerCredit) * 2 - 1e-9) / 2;
}

/**
 * Turn one observed price into a queue entry, or null if there is nothing to do.
 *
 * `basisAfter` is the cost we would price against AFTER the change — the caller
 * computes it, because only it knows the other supplier's price.
 */
export function proposeChange({
  provider, family, modelId = null,
  oldUsd, newUsd, basisBefore, basisAfter,
  marginTarget = 0.4, usdPerCredit = 0.063333,
  currentCredits = null,
} = {}) {
  const { kind, pct } = classify(oldUsd, newUsd);
  if (kind === 'none' || kind === 'unknown') return null;

  const newCredits = saleCreditsFor(basisAfter, { marginTarget, usdPerCredit });
  const oldCredits = currentCredits != null
    ? Number(currentCredits)
    : saleCreditsFor(basisBefore, { marginTarget, usdPerCredit });

  // A rise that does not move the basis (the OTHER supplier is still dearer)
  // changes nothing we charge. Worth recording in history, not worth asking a
  // human about.
  if (kind === 'increase' && newCredits != null && oldCredits != null && newCredits <= oldCredits) {
    return null;
  }

  return {
    provider, family, model_id: modelId,
    old_price_usd: Number(oldUsd), new_price_usd: Number(newUsd),
    pct_change: pct,
    old_credits: oldCredits, new_credits: newCredits,
    // A fall never proposes a price change, so it is filed as resolved rather
    // than sitting in the queue asking for a decision that does not exist.
    status: kind === 'needs_check' ? 'needs_check' : (kind === 'increase' ? 'pending' : 'skipped'),
    kind,
  };
}

/** Human summary for the log line and the CRM row. */
export function describe(c) {
  if (!c) return '';
  const dir = c.pct_change > 0 ? '↑' : '↓';
  const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(4)}`);
  const credits = c.new_credits != null && c.old_credits != null
    ? ` · our price ${c.old_credits} → ${c.new_credits} credits` : '';
  return `${c.family}: ${money(c.old_price_usd)} → ${money(c.new_price_usd)} ${dir}${Math.abs(c.pct_change)}%${credits}`;
}
