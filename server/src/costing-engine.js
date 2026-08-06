// ─── costing-engine.js ───────────────────────────────────────────────────────
// The ONE place Voxel's pricing arithmetic lives.
//
// Ported verbatim from the verified reference implementation shipped with the
// costing brief (2026-08-06), which was itself checked against the
// "Voxel Plans & Credits V 1.0" workbook to the cent. costing-engine.test.js
// asserts all 50 seed rows, the six plan credit totals and the worst-case plan
// margins, so a drift here fails the build rather than quietly re-pricing.
//
// WHY IT LIVES SERVER-SIDE: the brief requires exactly one engine shared by the
// backend and the CRM screen, with the server's numbers canonical. The frontend
// imports this same file, so client-side recalculation is a UX nicety that
// cannot disagree with the server.
//
// ── SCOPE, AND THIS MATTERS ────────────────────────────────────────────────
// This engine does NOT charge anybody. What customers actually pay comes from
// server/src/pricing.js (finding C1 of the July audit made that the single
// authority for charging). Costing is a management calculator on top: it works
// out what the credit price SHOULD be from supplier costs and a margin target.
// Moving a number here changes nothing a customer sees until someone
// deliberately carries it into pricing.js. Do not wire this into the charge
// path without the owner's explicit approval — see docs/COSTING.md.

// Guards float error exactly on half-credit boundaries: without it,
// 0.09/(1-0.4)/0.0633… lands a hair above 4.0 and CEILING pushes it to 4.5.
export const EPS = 1e-9;

/**
 * The cost we price against. When both suppliers carry a model we take the
 * HIGHER of the two, so the margin holds whichever one actually serves the
 * request. A null FAL price means KIE is the only supplier.
 */
export function basisOf(model) {
  const kie = Number(model.kie_cost ?? model.kie);
  const falRaw = model.fal_cost ?? model.fal;
  if (falRaw == null) return kie;
  return Math.max(kie, Number(falRaw));
}

/** Per-model margin target, falling back to the global setting. */
export function targetOf(model, settings) {
  const own = model.margin_override ?? model.marginOverride;
  return own == null ? Number(settings.margin_target) : Number(own);
}

/**
 * Credits the formula produces: cost ÷ (1 − target) ÷ credit value, rounded UP
 * to the next half credit. Rounding up (never to nearest) is what guarantees
 * the realised margin never lands below target.
 */
export function autoCredits(model, settings) {
  const sale = basisOf(model) / (1 - targetOf(model, settings));
  return Math.ceil(sale / Number(settings.credit_value) * 2 - EPS) / 2;
}

/** The formula unless a human has pinned a value. */
export function creditsOf(model, settings) {
  const override = model.credits_override ?? model.override;
  return override == null ? autoCredits(model, settings) : Number(override);
}

export function saleOf(model, settings) {
  return creditsOf(model, settings) * Number(settings.credit_value);
}

/** Margin against the cost we price on (the safe, higher supplier). */
export function marginVsBasis(model, settings) {
  return 1 - basisOf(model) / saleOf(model, settings);
}

/** Margin if the request happens to be served by KIE — always ≥ marginVsBasis. */
export function marginVsKie(model, settings) {
  return 1 - Number(model.kie_cost ?? model.kie) / saleOf(model, settings);
}

export function planCredits(plan, settings) {
  const override = plan.credits_override ?? plan.creditsOverride;
  if (override != null) return Number(override);
  return Math.round(Number(plan.price_usd ?? plan.price) / Number(settings.credit_value));
}

export function autoPlanCredits(plan, settings) {
  return Math.round(Number(plan.price_usd ?? plan.price) / Number(settings.credit_value));
}

/** How many units of this model a plan buys, if spent entirely on it. */
export function planQty(model, plan, settings) {
  return Math.floor(planCredits(plan, settings) / creditsOf(model, settings) + EPS);
}

/**
 * The number that actually matters: realised margin when a customer spends a
 * whole plan on ONE model. Worse than marginVsBasis because leftover credits
 * they cannot spend are still revenue we keep — and because integer quantities
 * mean they sometimes get slightly more value than the per-unit price implies.
 */
export function profitMargin(model, plan, settings, cost) {
  return 1 - planQty(model, plan, settings) * cost / Number(plan.price_usd ?? plan.price);
}

/** Cost basis for the Profit Check view. 'fal' may be null → caller shows "—". */
export function costForMode(model, mode) {
  if (mode === 'kie') return Number(model.kie_cost ?? model.kie);
  if (mode === 'fal') {
    const fal = model.fal_cost ?? model.fal;
    return fal == null ? null : Number(fal);
  }
  return basisOf(model);
}

/** Worst realised margin across every model for one plan — the headline number. */
export function worstMarginForPlan(models, plan, settings, mode = 'max') {
  let worst = Infinity;
  for (const m of models) {
    const cost = costForMode(m, mode);
    if (cost == null) continue;
    const margin = profitMargin(m, plan, settings, cost);
    if (margin < worst) worst = margin;
  }
  return worst === Infinity ? null : worst;
}

/** Every model whose realised margin falls under its own target, for any plan. */
export function belowTarget(models, plans, settings, mode = 'max') {
  const out = [];
  for (const m of models) {
    const cost = costForMode(m, mode);
    if (cost == null) continue;
    for (const p of plans) {
      const margin = profitMargin(m, p, settings, cost);
      if (margin < targetOf(m, settings) - 1e-6) {
        out.push({ model: m, plan: p, margin, target: targetOf(m, settings) });
      }
    }
  }
  return out;
}
