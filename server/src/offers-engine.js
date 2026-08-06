// ─── offers-engine.js ────────────────────────────────────────────────────────
// What an offer does to margin. Pure functions, no database, no HTTP — the
// same shape as costing-engine.js, and it deliberately DEPENDS on that module's
// settings rather than restating any of its numbers.
//
// The one input everything hangs off is the cost share:
//
//     costShare = 1 − margin_target
//
// margin_target is the owner's setting in the Costing screen (0.40 today, and
// changeable there). Hardcoding 0.60 anywhere in this file would silently
// decouple offers from the pricing policy the moment that setting moved — so
// it is derived, every time, from the settings row that is passed in.
//
// ─── WHAT IS AND IS NOT REDEEMABLE TODAY ─────────────────────────────────────
// Voxel has no checkout: no payment provider, no purchase endpoint, no
// recurring billing. Verified 2026-08-07 — credits reach users through an admin
// grant, a promo code or a gift, and `package` is a label an admin sets.
//
// So two of the four offer types have nothing to reduce:
//   pct   — % off a plan price   → NO PRICE IS CHARGED
//   fixed — $ off a plan price   → NO PRICE IS CHARGED
// and two work end to end on today's platform:
//   bonus — % bonus credits      → the existing credit-grant path
//   days  — free days            → extends users.expires_at
//
// By the owner's decision (2026-08-07) all four are BUILT and their margins
// calculated, so a campaign can be designed and approved in advance; the two
// price types are marked `requires_checkout` and the redemption path refuses
// them rather than pretending. When a payment flow lands, they work with no
// rebuild. Pretending they are live would be the worse failure: an approved
// discount nobody can actually use looks identical to a working one.

/** The share of the sale price that goes to supplier cost, worst-case. */
export function costShareOf(settings) {
  const t = Number(settings?.margin_target);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) return null;
  return 1 - t;
}

/** The margin floor an offer may not cross without explicit approval. */
export const DEFAULT_MARGIN_FLOOR = 0.25;

export function marginFloorOf(settings) {
  const raw = settings?.margin_floor;
  // Number(null) is 0, and 0 is a VALID floor meaning "no floor" — so a null
  // column would disable the approval gate entirely and every offer would pass
  // unchallenged. Reject null/undefined/'' before converting, not after.
  if (raw == null || raw === '') return DEFAULT_MARGIN_FLOOR;
  const f = Number(raw);
  if (!Number.isFinite(f) || f < 0 || f >= 1) return DEFAULT_MARGIN_FLOOR;
  return f;
}

export const OFFER_TYPES = ['pct', 'bonus', 'days', 'fixed'];

/** Types that need a price to reduce, and so cannot be redeemed yet. */
export const TYPES_REQUIRING_CHECKOUT = ['pct', 'fixed'];

export function requiresCheckout(type) {
  return TYPES_REQUIRING_CHECKOUT.includes(type);
}

/**
 * Margin on a plan once the offer applies.
 *
 *   pct   : 1 − costShare / (1 − d)          d = discount fraction
 *   bonus : 1 − costShare · (1 + b)          b = bonus fraction
 *   fixed : 1 − costShare · P / (P − A)      P = price, A = amount off
 *   days  : null — cost-based, not a margin (see estimatedDaysCost)
 *
 * @returns number | null   null when the type has no margin (days) or the
 *                          inputs are unusable. Never a fabricated number.
 */
export function offerMargin(type, value, price, settings) {
  const costShare = costShareOf(settings);
  if (costShare == null) return null;
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;

  if (type === 'pct') {
    const d = v / 100;
    // 100% off is free: there is no revenue to take a margin of, and 1−d = 0
    // would divide by zero. Report it as unusable rather than as Infinity.
    if (d >= 1) return null;
    return 1 - costShare / (1 - d);
  }

  if (type === 'bonus') {
    return 1 - costShare * (1 + v / 100);
  }

  if (type === 'fixed') {
    const P = Number(price);
    if (!Number.isFinite(P) || P <= 0) return null;
    // Giving away the whole price (or more) leaves nothing to earn on.
    if (P - v <= 0) return null;
    return 1 - costShare * P / (P - v);
  }

  return null; // 'days' and anything unrecognised
}

/**
 * Free days are a cost, not a discount: the client pays the same and we carry
 * `days` worth of supplier cost. Estimated pro-rata on a 30-day month.
 */
export function estimatedDaysCost(value, price, settings) {
  const costShare = costShareOf(settings);
  const days = Number(value);
  const P = Number(price);
  if (costShare == null || !Number.isFinite(days) || days <= 0) return null;
  if (!Number.isFinite(P) || P <= 0) return null;
  return costShare * P * days / 30;
}

/** The price a client would actually pay. null when the type does not move price. */
export function discountedPrice(type, value, price) {
  const P = Number(price);
  const v = Number(value);
  if (!Number.isFinite(P) || !Number.isFinite(v)) return null;
  if (type === 'pct') return Math.max(0, P * (1 - v / 100));
  if (type === 'fixed') return Math.max(0, P - v);
  return null; // bonus and days leave the price alone — that is their point
}

/**
 * Per-plan before/after for the create screen and the approval gate.
 * `plans` are rows from pricing_plans: { id, name, price_usd }.
 */
export function marginImpact({ type, value, plans = [], settings }) {
  const target = Number(settings?.margin_target);
  const floor = marginFloorOf(settings);
  return plans.map((p) => {
    const price = Number(p.price_usd);
    const margin = offerMargin(type, value, price, settings);
    const cost = type === 'days' ? estimatedDaysCost(value, price, settings) : null;
    return {
      plan_id: p.id,
      plan_name: p.name,
      price_usd: price,
      new_price: discountedPrice(type, value, price),
      margin_before: Number.isFinite(target) ? target : null,
      margin_after: margin,
      estimated_cost: cost,
      // An UNKNOWN margin is not a pass. 'days' has no margin by definition and
      // is exempt; every other type with a null margin is unusable input and
      // must not sail through the floor check as though it were fine.
      below_floor: type === 'days' ? false : (margin == null ? true : margin < floor - 1e-9),
    };
  });
}

/** True when any selected plan would drop under the floor. */
export function violatesFloor(impact = []) {
  return impact.some((r) => r.below_floor);
}

/**
 * Everything that must be true before an offer may go live. Returns a list of
 * plain-language problems; empty means it may be approved.
 *
 * `belowFloorApproved` is the owner's explicit "yes, I know" — it clears the
 * floor objection and nothing else, and the caller audit-logs that it was used.
 */
export function validateForApproval(offer, { plans = [], settings, belowFloorApproved = false } = {}) {
  const errs = [];
  if (!offer?.name?.trim()) errs.push('give the offer a name');
  if (!OFFER_TYPES.includes(offer?.type)) errs.push('choose a valid offer type');
  if (!(Number(offer?.value) > 0)) errs.push('the offer value must be above zero');
  if (!offer?.plan_ids?.length) errs.push('select at least one plan');

  const hasDelivery = offer?.delivery_code || offer?.delivery_auto || offer?.delivery_email;
  if (!hasDelivery) errs.push('choose at least one delivery channel');
  if (offer?.delivery_code && !String(offer?.code || '').trim()) {
    errs.push('enter or generate the promo code');
  }
  // Email is a stub with no sender behind it. Approving an offer whose ONLY
  // way of reaching anyone is an unbuilt channel would create an offer that
  // silently reaches nobody.
  if (offer?.delivery_email && !offer?.delivery_code && !offer?.delivery_auto) {
    errs.push('email campaigns are on hold — add a code or auto-apply as well');
  }

  if (offer?.audience_mode === 'picked' && !offer?.picked_client_ids?.length) {
    errs.push('pick at least one client');
  }
  if (offer?.audience_mode === 'segment' && offer?.audience_count === 0) {
    errs.push('segment matches 0 clients');
  }

  if (offer?.starts_at && offer?.ends_at && String(offer.ends_at) < String(offer.starts_at)) {
    errs.push('the end date is before the start date');
  }

  const selected = plans.filter((p) => offer?.plan_ids?.includes(p.id));
  const impact = marginImpact({ type: offer?.type, value: offer?.value, plans: selected, settings });
  if (violatesFloor(impact) && !belowFloorApproved) {
    const floor = marginFloorOf(settings);
    errs.push(`this offer pushes at least one plan below the ${(floor * 100).toFixed(1)}% margin floor — confirm below-floor approval to continue`);
  }

  return errs;
}

/**
 * No stacking: when several offers match, exactly one applies — the one worth
 * most to the client. Comparing by the client's benefit (not by our cost) is
 * the deliberate choice: the brief says "apply the single best one for the
 * client", and a client who can see two offers and receives the stingier one
 * will read that as the platform cheating them.
 */
export function bestOffer(offers = [], { price, settings } = {}) {
  let best = null;
  let bestWorth = -Infinity;
  for (const o of offers) {
    const worth = clientBenefit(o, { price, settings });
    if (worth == null) continue;
    if (worth > bestWorth) { bestWorth = worth; best = o; }
  }
  return best;
}

/** What the offer is worth to the client, in dollars, for comparison only. */
export function clientBenefit(offer, { price, settings } = {}) {
  const P = Number(price);
  const v = Number(offer?.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (offer?.type === 'pct')   return Number.isFinite(P) ? P * (v / 100) : null;
  if (offer?.type === 'fixed') return Number.isFinite(P) ? Math.min(P, v) : null;
  // Bonus credits are worth what the client would otherwise have paid for them.
  if (offer?.type === 'bonus') return Number.isFinite(P) ? P * (v / 100) : null;
  if (offer?.type === 'days')  return Number.isFinite(P) ? P * v / 30 : null;
  return null;
}

/**
 * Status from the dates, so a stored status can never drift from reality.
 * `paused` and `draft` are owner states and always win over the calendar.
 */
export function effectiveStatus(offer, now = new Date()) {
  if (offer?.status === 'draft' || offer?.status === 'paused') return offer.status;
  const today = now.toISOString().slice(0, 10);
  const starts = String(offer?.starts_at || '').slice(0, 10);
  const ends = String(offer?.ends_at || '').slice(0, 10);
  if (ends && today > ends) return 'expired';
  if (starts && today < starts) return 'scheduled';
  return 'active';
}
