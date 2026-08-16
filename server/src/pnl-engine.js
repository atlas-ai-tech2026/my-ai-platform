// ─── pnl-engine.js ───────────────────────────────────────────────────────────
// Actual money in against actual money out, per workshop.
//
// This is a DIFFERENT question from the Costing tab's existing "Profit" screen.
// That one asks "if a customer spent an entire plan on one model, what would
// the margin be?" — a pricing question, answered from the model table. This
// asks "we invoiced $845 and the attendees burned N credits; did we make
// money?" — a bookkeeping question, answered from what actually happened.
//
// THE HONESTY PROBLEM THIS FILE IS BUILT AROUND. 32 of 82 active models have
// no supplier cost recorded. If their spend is silently treated as $0, every
// workshop that used them reports a BETTER margin than it earned — and a
// flattering wrong number is worse than an honest gap, because it is the
// number that sets the next workshop's price. So cost attribution here always
// returns coverage alongside the total, and every caller is expected to show
// it. `costed_pct` is not a diagnostic; it is part of the answer.

/** Strip the "video: " / "image: " / "audio: " prefix our spend rows carry. */
export function modelFromReason(reason) {
  const m = String(reason || '').match(/^\s*(?:image|video|audio)\s*:\s*(.+?)\s*$/i);
  return m ? m[1] : null;
}

/**
 * Index the costing table for lookup by the label spend rows use.
 *
 * Matching is exact on a normalised name, never fuzzy. costing-coverage.js
 * makes the case at length: a near-miss silently claims a cost we do not have.
 */
export function costIndex(models = [], basis = 'actual') {
  const idx = new Map();
  for (const m of models) {
    const usd = pickCost(m, basis);
    if (usd === null) continue;
    const key = norm(m.model_name);
    // Several rows can share a model_name (one per resolution). The dearest is
    // used: erring high on cost errs LOW on margin, and a margin that looks
    // worse than it is will never talk anyone into a bad price.
    if (!idx.has(key) || usd > idx.get(key)) idx.set(key, usd);
  }
  return idx;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Which supplier price to use — and the two bases are NOT interchangeable.
 *
 * 'safe'   = MAX(fal, kie). Correct for PRICING: charge enough to keep 40%
 *            whichever provider serves the request.
 * 'actual' = kie, falling back to fal. Correct for BOOKKEEPING: kie is who we
 *            actually buy from, so it is what the bill says.
 *
 * Checked against the real invoice on 2026-08-16 rather than assumed. For the
 * fortnight 2–15 August, against a kie bill of $1,559.07:
 *   · MAX(fal, kie) → $2,040.79  (1.31× — overstates cost by a third)
 *   · kie preferred → $1,503.23  (0.96× — within 4%)
 * So a P&L built on the pricing rule would have understated every margin by
 * about 31%, and this screen exists to inform pricing decisions.
 *
 * The kie-pricing calibration factor is deliberately NOT applied here: it was
 * measured against a different estimate method and applying it on top drags
 * the total to 0.83×, worse than leaving it alone.
 */
export function pickCost(m, basis = 'actual') {
  const n = (v) => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  const fal = n(m?.fal_cost);
  const kie = n(m?.kie_cost);
  if (basis === 'safe') {
    const vals = [fal, kie].filter((v) => v !== null);
    return vals.length ? Math.max(...vals) : null;
  }
  return kie !== null ? kie : fal;
}

/**
 * What a cohort's generations cost us.
 *
 * `spend` rows are { model, credits, uses } — already aggregated per model.
 * Returns the costed total AND what could not be costed, in both credits and
 * share of spend, so the caller can never present a partial figure as whole.
 */
export function attributeCost(spend = [], idx = new Map(), { creditValueUsd = 0.06333333 } = {}) {
  let costedUsd = 0, costedCredits = 0, uncostedCredits = 0;
  const missing = new Map();
  for (const row of spend) {
    const credits = Number(row.credits) || 0;
    const uses = Number(row.uses) || 0;
    const unitUsd = idx.get(norm(row.model));
    if (unitUsd === undefined) {
      uncostedCredits += credits;
      missing.set(row.model, (missing.get(row.model) || 0) + credits);
      continue;
    }
    costedUsd += unitUsd * uses;
    costedCredits += credits;
  }
  const totalCredits = costedCredits + uncostedCredits;
  return {
    costed_usd: round2(costedUsd),
    costed_credits: round2(costedCredits),
    uncosted_credits: round2(uncostedCredits),
    total_credits: round2(totalCredits),
    // Share of SPEND that has a supplier cost — not share of models. One
    // uncosted model carrying most of the traffic matters far more than ten
    // uncosted models nobody used.
    costed_pct: totalCredits > 0 ? round1((costedCredits / totalCredits) * 100) : null,
    // What the uncosted portion is worth at list price, so the size of the
    // blind spot is legible in money rather than credits.
    uncosted_at_list_usd: round2(uncostedCredits * creditValueUsd),
    missing_models: [...missing.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model, credits]) => ({ model, credits: round2(credits) })),
  };
}

/**
 * One workshop's P&L.
 *
 * Margin is returned as null — NOT zero, and NOT a number — whenever it cannot
 * be stated honestly: no invoice recorded, or too little of the spend costed.
 * A margin computed from 40% coverage is not a margin, it is an optimistic
 * guess, and this screen exists precisely to stop pricing being set from one.
 */
export const MIN_COVERAGE_PCT = 80;

export function workshopPnl(workshop, cost, { minCoverage = MIN_COVERAGE_PCT } = {}) {
  const invoiced = workshop?.invoiced_amount === null || workshop?.invoiced_amount === undefined
    ? null : Number(workshop.invoiced_amount);
  const reliable = cost.costed_pct !== null && cost.costed_pct >= minCoverage;
  const canState = invoiced !== null && invoiced > 0 && reliable;

  return {
    invoiced_usd: invoiced,
    supplier_cost_usd: cost.costed_usd,
    gross_profit_usd: canState ? round2(invoiced - cost.costed_usd) : null,
    margin_pct: canState ? round1(((invoiced - cost.costed_usd) / invoiced) * 100) : null,
    costed_pct: cost.costed_pct,
    // Why the number is missing, in words, so an empty cell never reads as
    // "zero" or "still loading".
    unstated_because: canState ? null
      : invoiced === null || invoiced === 0 ? 'no invoice amount recorded'
      : cost.costed_pct === null ? 'this cohort has not generated anything yet'
      : `only ${cost.costed_pct}% of their spend has a supplier cost on file`,
  };
}

/** Roll several workshops into a period total, skipping what cannot be stated. */
export function summarise(rows = []) {
  const stated = rows.filter((r) => r.margin_pct !== null);
  const invoiced = sum(rows.map((r) => r.invoiced_usd || 0));
  const cost = sum(rows.map((r) => r.supplier_cost_usd || 0));
  return {
    workshops: rows.length,
    invoiced_usd: round2(invoiced),
    supplier_cost_usd: round2(cost),
    gross_profit_usd: round2(invoiced - cost),
    margin_pct: invoiced > 0 ? round1(((invoiced - cost) / invoiced) * 100) : null,
    // The headline is only as trustworthy as its worst row, so say how many
    // rows it actually rests on.
    stated_of: `${stated.length} of ${rows.length}`,
    complete: stated.length === rows.length && rows.length > 0,
  };
}

const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
