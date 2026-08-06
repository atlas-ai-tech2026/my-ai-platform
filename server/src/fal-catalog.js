// ─── fal-catalog.js ──────────────────────────────────────────────────────────
// What fal.ai OFFERS, as opposed to what we sell. Feeds the Costing screen's
// "New models" section: models available at the provider that the website does
// not sell yet, so the owner can see what is worth onboarding.
//
// Source: https://fal.ai/api/models — fal's own public JSON catalogue. No key,
// no scraping, no headless browser. Shape (verified 2026-08-06):
//   { items: [ { id, title, category, modelFamily, modelLab, date,
//                pricingInfoOverride, status, deprecated, removed, … } ],
//     page, size, pages, total }   → 1,421 models over 36 pages.
//
// kie.ai has NO equivalent. Its /pricing page is a client-rendered Next.js app
// with no embedded payload and no documented catalogue endpoint (checked
// 2026-08-06: docs.kie.ai exposes createTask / recordInfo / chat/credit only).
// Reading it would need a headless browser — a ~300 MB dependency on a 1 GB
// instance — so kie costs keep coming from kie-pricing.js and the owner's own
// entries instead. This module is FAL-only on purpose, and says so rather than
// pretending the picture is complete.

const FAL_CATALOG_URL = 'https://fal.ai/api/models';

/** Categories the platform actually sells. Everything else (training, 3d,
 *  vision, llm, json…) is noise on a pricing screen. */
export const SELLABLE_CATEGORIES = [
  'text-to-image', 'image-to-image',
  'text-to-video', 'image-to-video',
  'text-to-speech', 'text-to-audio',
];

// ─── price parsing ───────────────────────────────────────────────────────────
//
// fal states price as PROSE, and the shapes genuinely differ:
//   "Your request will cost **$0.08** per image."
//   "For every second of video you generated, you will be charged **$0.112**
//    (audio off) or **$0.168** (audio on)"
//   "For every second of 720p video … **$0.3034/second** and for 1080p …"
//   "Text tokens (per 1M): **$5.00** input, …"          ← NOT a per-image price
//   "**$0.03** for the first megapixel of output, plus …"
//
// Taking "the first dollar amount" would read GPT Image 2 as $5.00 per image —
// a 60× error that renders as a confident, wrong margin. That is the single
// most dangerous output a pricing tool can produce, so this parser recognises
// only shapes it is sure of and returns null for everything else. Unknown is a
// legitimate answer here; a guess is not.

const MONEY = String.raw`\*{0,2}\$\s*([0-9]+(?:\.[0-9]+)?)\*{0,2}`;

/** Every dollar figure in a string. */
function amounts(text) {
  return [...String(text).matchAll(new RegExp(MONEY, 'g'))].map((m) => Number(m[1]));
}

// Sentences that state a CONDITIONAL EXTRA rather than the base rate. Reading
// one of these as the price is not a rounding error — fal's Nano Banana Pro
// entry says "$0.15 per image" and then "if web search is used, an additional
// $0.015 will be charged". Scanning the whole string and taking the smallest
// number returns $0.015: a 10x understatement of cost, which inflates the
// margin. Verified against fal-pricing.js, which has the confirmed $0.15.
const SURCHARGE = /\b(if |additional|plus |extra|surcharge|note:|may change|otherwise)\b/i;

// "For $1.00, you can run this model 12 times" restates the same rate as a
// quantity. Its $1.00 is not a unit price.
const PER_DOLLAR = /for\s*\*{0,2}\$\s*1(\.00)?\*{0,2}\s*,?\s*you can run/i;

/**
 * Amounts belonging to the clause that actually states the base rate:
 * sentences mentioning the unit, minus surcharge and per-dollar restatements.
 */
function baseRateAmounts(text, unitPattern) {
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const relevant = sentences.filter((s) =>
    unitPattern.test(s.toLowerCase()) && !SURCHARGE.test(s) && !PER_DOLLAR.test(s));

  // "Your request will cost $X per image" is fal's canonical statement of the
  // BASE rate. When it is present it wins outright, because sibling sentences
  // quote cheaper tiers in the same units — Nano Banana 2 follows its $0.08
  // base with "0.5K (512px) resolution outputs will be charged $0.002 per
  // image". Both say "per image"; only the first is the price we would pay for
  // a standard request, and taking the minimum across both understates cost 40x.
  const primary = relevant.filter((s) => /your request will cost/i.test(s));
  const scope = primary.length ? primary : relevant;

  return scope.flatMap(amounts).filter((n) => n > 0);
}

/**
 * Parse fal's pricing prose into a structured cost.
 * @returns {{unit:'image'|'second'|'video'|'1k_chars', usd:number}|null}
 *          null when the shape is not recognised — never a guess.
 */
export function parseFalPrice(text, category = '') {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ').trim();
  const low = t.toLowerCase();

  // Token-priced models (LLM-style billing). We sell per image/second, so a
  // token price is not convertible — refuse rather than mislead.
  if (/per\s*1m|per million|tokens?\s*\(per/.test(low)) return null;

  // Megapixel / per-input-image billing depends on request shape we don't know
  // here. Refuse: the owner can enter the real number.
  if (/megapixel|per extra|additional input image/.test(low)) return null;

  if (!amounts(t).length) return null;

  // Each shape reads amounts ONLY from the sentence that names its unit, so a
  // surcharge sentence elsewhere in the blurb cannot become the price. Where a
  // single clause lists several tiers (audio on/off, 720p/1080p) the lowest is
  // the base rate — and erring low on cost errs low on margin, which is the
  // safe direction: the owner sees a worse margin, never a flattering one.
  const pick = (unitPattern, unit) => {
    const nums = baseRateAmounts(t, unitPattern);
    return nums.length ? { unit, usd: Math.min(...nums) } : null;
  };

  // Per second of video — the dominant video shape.
  if (/(per|every)\s+second|\/second|per-second/.test(low)) {
    const hit = pick(/(per|every)\s+second|\/second|per-second/, 'second');
    if (hit) return hit;
  }

  // Per image.
  if (/per image|per output image/.test(low)) {
    const hit = pick(/per image|per output image/, 'image');
    if (hit) return hit;
  }

  // Per generated video / clip.
  if (/per video|per clip/.test(low)) {
    const hit = pick(/per video|per clip/, 'video');
    if (hit) return hit;
  }

  // "per generation" is unit-neutral — it means one image for an image model
  // and one clip for a video model. Reading it as 'video' labelled Ideogram's
  // image-editing model as per-clip, so take the unit from the category.
  if (/per generation/.test(low)) {
    const unit = /-to-image$/.test(category) ? 'image'
      : /-to-video$/.test(category) ? 'video' : null;
    if (unit) {
      const hit = pick(/per generation/, unit);
      if (hit) return hit;
    }
  }

  // Speech: per 1,000 characters.
  if (/per 1,?000 characters|per 1k characters|per character/.test(low)) {
    const hit = pick(/per 1,?000 characters|per 1k characters|per character/, '1k_chars');
    if (hit) return hit;
  }

  // A bare "Your request will cost $X" with no unit stated — infer the unit
  // from the category, which fal sets reliably.
  if (/your request will cost/.test(low)) {
    const unit = /-to-video$/.test(category) ? 'video'
      : /-to-image$/.test(category) ? 'image' : null;
    if (unit) {
      const hit = pick(/your request will cost/, unit);
      if (hit) return hit;
    }
  }

  return null;
}

// ─── fetching ────────────────────────────────────────────────────────────────

/**
 * Page through fal's catalogue. `fetchImpl` is injectable so tests never touch
 * the network. Returns the raw items; filtering is the caller's job.
 */
export async function fetchFalCatalog({
  fetchImpl = fetch,
  maxPages = 40,
  signal,
} = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(`${FAL_CATALOG_URL}?page=${page}`, {
      headers: { 'User-Agent': 'voxel-costing/1.0' },
      signal,
    });
    if (!res.ok) {
      // Partial data is still useful, but never pretend it is complete.
      throw new Error(`fal catalogue page ${page} returned ${res.status}`);
    }
    const body = await res.json();
    items.push(...(body.items || []));
    if (!body.pages || page >= body.pages) break;
  }
  return items;
}

/** Models a customer could actually be sold: public, current, right category. */
export function sellableModels(items) {
  return items.filter((m) =>
    m && m.status === 'public' && !m.deprecated && !m.removed &&
    SELLABLE_CATEGORIES.includes(m.category));
}

/**
 * Collapse endpoints into products. fal lists Flux 3 as eight endpoints
 * (text-to-video, image-to-video, extend, draft…); the owner is deciding about
 * "Flux 3", not about eight rows. Falls back to the title when fal has not set
 * a family — 570 of 982 sellable models carry one.
 */
export function groupByFamily(items) {
  const out = new Map();
  for (const m of items) {
    const key = m.modelFamily || m.title;
    if (!key) continue;
    if (!out.has(key)) {
      out.set(key, {
        family: key,
        lab: m.modelLab || null,
        category: m.category,
        first_seen: m.date || null,
        endpoints: [],
        price: null,
      });
    }
    const g = out.get(key);
    g.endpoints.push({ id: m.id, title: m.title, category: m.category });
    // Newest date across the family — "when did this product appear".
    if (m.date && (!g.first_seen || m.date > g.first_seen)) g.first_seen = m.date;
    // Keep the first price we can parse confidently.
    if (!g.price) {
      const p = parseFalPrice(m.pricingInfoOverride, m.category);
      if (p) g.price = p;
    }
  }
  return [...out.values()];
}

/**
 * The "New models" list: product families fal offers that we do not dispatch to.
 *
 * @param items       raw catalogue items
 * @param knownFalIds Set of fal endpoint ids the server already calls
 * @param since       ISO date string; families whose newest endpoint predates
 *                    this are old news, not "new". Defaults to 3 months, which
 *                    kept the list at ~52 families instead of 477.
 */
export function newModelFamilies(items, knownFalIds = new Set(), { since = null } = {}) {
  const known = new Set([...knownFalIds]);
  const sellable = sellableModels(items)
    .filter((m) => !known.has(m.id));
  let fams = groupByFamily(sellable);
  if (since) fams = fams.filter((f) => f.first_seen && f.first_seen >= since);
  return fams.sort((a, b) => String(b.first_seen).localeCompare(String(a.first_seen)));
}
