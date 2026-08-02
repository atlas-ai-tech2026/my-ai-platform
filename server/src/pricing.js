// ─── pricing.js ──────────────────────────────────────────────────────────────
// AUTHORITATIVE sale-price tables — what a generation costs the USER in
// voxel credits. Fix C1 (security audit 2026-07-28): the server computes
// every charge from these tables; the client's `credit_cost` is accepted
// only as a display-confirmation hint and rejected with 409 when it
// disagrees. Never charge a client-supplied number.
//
// Source of the numbers: Voxel_Plans_and_Credits.xlsx (2026-07-21) — the
// same workbook src/lib/creditPricing.js was built from. The frontend now
// fetches these tables via GET /api/pricing (its bundled copy is only a
// fallback until that fetch resolves); pricing.test.js keeps the two files
// in lockstep. If you change a number, change it HERE — the UI follows.
//
// Distinct from fal-pricing.js / kie-pricing.js, which track what the
// generation costs US at the provider (ledger display only).

// ---- IMAGE — credits per generated image, keyed by app model id then
// quality ('Draft' | '1K' | '2K' | '4K'). Mirrors creditPricing.js. ----------
export const IMAGE_CREDITS = {
  'nano-pro':         { Draft: 4,   '1K': 4,   '2K': 4,   '4K': 8   },
  'nano-2':           { Draft: 4,   '1K': 4,   '2K': 4,   '4K': 8   },
  'gpt-image-2':      { Draft: 6,   '1K': 6,   '2K': 6.5, '4K': 11  },
  'seedream-5-lite':  { Draft: 1,   '1K': 1,   '2K': 1,   '4K': 1   },
  'gpt-image':        { Draft: 4.5, '1K': 4.5, '2K': 4.5, '4K': 4.5 },
  'seedream-4':       { Draft: 1,   '1K': 1,   '2K': 1,   '4K': 2   },
  'flux-kontext':     { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 },
  'flux-2':           { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 },
  'gpt-4o-image':     { Draft: 2,   '1K': 2,   '2K': 2,   '4K': 2   },
  'flux-kontext-max': { Draft: 3,   '1K': 3,   '2K': 3,   '4K': 3   },
  'midjourney':       { Draft: 3,   '1K': 3,   '2K': 3,   '4K': 3   },
  'soul-2':           { Draft: 1,   '1K': 1,   '2K': 1,   '4K': 1   },
  'wan-22':           { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 },
  'skin-enhancer':    { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 },
  'face-swap':        { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 },
  'relight':          { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 },
};

// ---- VIDEO — keyed by app model id (plus panel model NAMES for the
// Motion Control / Edit tabs, matching creditPricing.js). Shapes:
//   type 'per-sec' → credits = byRes[res].(on|off) × seconds
//   type 'flat'    → credits = byRes[res] (duration-independent) ------------
export const VIDEO_CREDITS = {
  'kling-3': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: {
      '720p':  { off: 2.5, on: 4 },
      '1080p': { off: 2.5, on: 4 },
      '4K':    { off: 9,   on: 9 },
    },
  },
  // Kling 3.0 Turbo — added 2026-08-02. Derived with the standard formula:
  // basis = MAX(fal, kie) cost (no FAL entry, so kie is the basis:
  // 720p $0.09/s, 1080p $0.1125/s) → sale = basis / (1 − 40%) →
  // credits = CEILING(sale / $0.063333, 0.5). Yields 2.5 and 3 cr/s, at
  // 43.2% and 40.8% margin. Turbo has NO audio parameter, so on === off.
  'kling-3-turbo': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '720p':  { off: 2.5, on: 2.5 },
      '1080p': { off: 3,   on: 3   },
    },
  },
  'kling-2-6': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '1080p': { off: 1.5, on: 2.9 } },
  },
  'seedance-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p':  { off: 4,    on: 4    },
      '720p':  { off: 8,    on: 8    },
      '1080p': { off: 18,   on: 18   },
      '4K':    { off: 41.5, on: 41.5 },
    },
  },
  'seedance-2-fast': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 3,   on: 3   },
      '720p': { off: 6.5, on: 6.5 },
    },
  },
  'seedance-2-mini': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 1.5, on: 1.5 },
      '720p': { off: 3,   on: 3   },
    },
  },
  'veo-3-1': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 33, '1080p': 34, '4K': 49 },
  },
  'veo-3': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 33, '1080p': 34, '4K': 49 },
  },
  'veo-3-fast': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 8, '1080p': 9 },
  },
  'sora-2': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 8, '1080p': 8 },
  },
  'wan-2-6': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '720p': { off: 2, on: 2 }, '1080p': { off: 2, on: 2 } },
  },
  'seedance-1-5': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p':  { off: 2,   on: 2   },
      '720p':  { off: 3.5, on: 3.5 },
      '1080p': { off: 6.5, on: 6.5 },
    },
  },
  'grok-imagine': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '480p': { off: 0.5, on: 0.5 }, '720p': { off: 0.5, on: 0.5 } },
  },
  'kling-3-omni': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '720p': { off: 4, on: 4 }, '1080p': { off: 4, on: 4 } },
  },
  'kling-2-5': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '1080p': { off: 1.2, on: 1.2 } },
  },
  'kling-2-1': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '1080p': { off: 2, on: 2 } },
  },
  'kling-o1': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 10, '1080p': 10 },
  },
  'hailuo-2-3': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 7.5, '1080p': 7.5 },
  },
  'seedance-1': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '480p': { off: 2, on: 2 }, '720p': { off: 2, on: 2 } },
  },
  'ltx-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '720p': { off: 2, on: 2 }, '4K': { off: 2, on: 2 } },
  },
  'vidu-q3': { type: 'flat', defaultRes: '1080p', byRes: { '720p': 11.5, '1080p': 11.5 } },
  'vidu-q2': { type: 'flat', defaultRes: '1080p', byRes: { '720p': 11.5, '1080p': 11.5 } },
  'pixverse-5': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '720p': { off: 1, on: 1 }, '1080p': { off: 1, on: 1 } },
  },
  'wan-2-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '480p': { off: 2, on: 2 }, '720p': { off: 2, on: 2 } },
  },

  // ---- Motion Control + Edit panels (keyed by model NAME, like the UI) ----
  'Kling 3.0 Motion Control': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 8, '1080p': 11 },
  },
  'Kling Motion Control': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 6, '1080p': 8 },
  },
  'Kling O1 Video Edit': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 10, '1080p': 10 },
  },
  'Kling 3.0 Omni Edit': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 10, '1080p': 10 },
  },
};

// ---- Server routes receive display LABELS ("Nano Banana Pro"), the
// pricing tables are keyed by app id ('nano-pro'). Motion/Edit entries are
// keyed by label already and resolve to themselves. --------------------------
export const IMAGE_LABEL_TO_ID = {
  'Nano Banana Pro': 'nano-pro',
  'Nano Banana 2': 'nano-2',
  'GPT Image 2': 'gpt-image-2',
  'GPT Image 1.5': 'gpt-image',
  'GPT-4o Image': 'gpt-4o-image',
  'Seedream 5.0 Lite': 'seedream-5-lite',
  'Seedream 4.5': 'seedream-4',
  'Flux Kontext': 'flux-kontext',
  'Flux Kontext Max': 'flux-kontext-max',
  'Flux 2': 'flux-2',
  'Midjourney': 'midjourney',
  'Soul 2.0': 'soul-2',
  'Wan 2.2 Image': 'wan-22',
  'Skin Enhancer': 'skin-enhancer',
  'Face Swap': 'face-swap',
  'Relight': 'relight',
};

export const VIDEO_LABEL_TO_ID = {
  'Kling 3.0': 'kling-3',
  'Kling 3.0 Turbo': 'kling-3-turbo',
  'Kling 2.6': 'kling-2-6',
  'Kling 2.5': 'kling-2-5',
  'Kling 2.1': 'kling-2-1',
  'Kling O1': 'kling-o1',
  'Kling 3.0 Omni': 'kling-3-omni',
  'Seedance 2.0': 'seedance-2',
  'Seedance 2.0 Fast': 'seedance-2-fast',
  'Seedance 2.0 Mini': 'seedance-2-mini',
  'Seedance 1.5 Pro': 'seedance-1-5',
  'Seedance 1': 'seedance-1',
  'Veo 3.1': 'veo-3-1',
  'Veo 3': 'veo-3',
  'Veo 3 Fast': 'veo-3-fast',
  'Sora 2': 'sora-2',
  'Wan 2.6': 'wan-2-6',
  'Wan 2.2': 'wan-2-2',
  'Grok Imagine': 'grok-imagine',
  'Hailuo 2.3': 'hailuo-2-3',
  'LTX 2': 'ltx-2',
  'Vidu Q3': 'vidu-q3',
  'Vidu Q2': 'vidu-q2',
  'PixVerse 5': 'pixverse-5',
};

// ---- helpers (identical math to src/lib/creditPricing.js) ------------------

function toSeconds(duration) {
  if (typeof duration === 'number') return duration;
  const m = String(duration).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * Credits for one generated image. Returns a number or null when the model
 * has no price on file (caller must reject the request — never guess).
 */
export function getImageCredits(model, quality) {
  const id = IMAGE_LABEL_TO_ID[model] || model;
  const row = IMAGE_CREDITS[id];
  if (!row) return null;
  return row[quality] ?? row['1K'] ?? null;
}

/**
 * Credits for one generated video. Returns a number or null when the model
 * has no price on file. Duration 'auto'/missing prices as the app default
 * 5s (matches the frontend's "~5s" estimate).
 */
export function getVideoCredits(model, { resolution, duration = 5, audio = false } = {}) {
  const id = VIDEO_LABEL_TO_ID[model] || model;
  const cfg = VIDEO_CREDITS[id];
  if (!cfg) return null;
  let seconds = toSeconds(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 5;

  if (cfg.type === 'per-sec') {
    const r = cfg.byRes[resolution] || cfg.byRes[cfg.defaultRes];
    if (!r) return null;
    const rate = audio ? r.on : r.off;
    return Math.round(rate * seconds * 100) / 100;
  }
  // flat — duration-independent
  const flat = cfg.byRes[resolution] ?? cfg.byRes[cfg.defaultRes];
  return flat ?? null;
}

export class UnpricedModelError extends Error {
  constructor(model) {
    super(`No price on file for model: ${model}`);
    this.name = 'UnpricedModelError';
    this.model = model;
  }
}

export class PriceMismatchError extends Error {
  constructor(correctCost, clientCost) {
    super(`Price mismatch: this generation costs ${correctCost} credits`);
    this.name = 'PriceMismatchError';
    this.correctCost = correctCost;
    this.clientCost = clientCost;
  }
}

/**
 * THE C1 gate. Computes the authoritative charge for a generation and
 * validates the client's optional `credit_cost` hint against it.
 *
 *   - model has no price on file      → UnpricedModelError (route: 400)
 *   - hint present and disagrees      → PriceMismatchError (route: 409)
 *   - otherwise                       → the server-computed cost, which is
 *                                       the ONLY value ever passed to
 *                                       chargeCredits().
 *
 * The hint is display confirmation only — it can veto (409, so a stale UI
 * never silently pays a different price than it showed), never set a price.
 */
export function resolveChargeCost({ kind, model, quality, resolution, duration, audio, clientCost }) {
  const cost = kind === 'image'
    ? getImageCredits(model, quality || '1K')
    : getVideoCredits(model, { resolution, duration, audio });
  if (cost == null || !Number.isFinite(cost) || cost <= 0) {
    throw new UnpricedModelError(model);
  }

  const hint = Number(clientCost);
  if (clientCost != null && Number.isFinite(hint) && Math.abs(hint - cost) > 0.009) {
    throw new PriceMismatchError(cost, hint);
  }
  return cost;
}
