// ============================================================================
// VOXEL — Credit pricing (SINGLE SOURCE OF TRUTH)
// ----------------------------------------------------------------------------
// Derived from Voxel_MASTER_PLAN.xlsx  → sheet "HF Verified Credits"
// and Voxel_Credit_Calculator.html. These are the verified Higgsfield credit
// costs charged to the user per generation.
//
// If you change a number here, the Image/Video GENERATE buttons update
// automatically — nothing else to touch.
//
// Mapping notes (documented assumptions — adjust freely):
//   • The app's image "quality" selector is [Draft, 1K, 2K, 4K]. The sheet has
//     no "Draft" tier, so Draft reuses the cheapest (1K) price.
//   • GPT Image models have Low/Mid/High variants in the sheet but the app has
//     no variant selector — we use the HIGH variant (the flagship tier).
//   • Models a sheet entry only lists at one resolution reuse that price for
//     every quality (e.g. Seedream 4.5, WAN 2.2, Flux Kontext).
//   • Video has no resolution selector in the app, so each video model uses a
//     default resolution (1080p where available, else 720p).
//   • "pending: true" = NOT in the master plan yet. Its credit cost falls back
//     to the value baked into the model list until you send verified numbers.
// ============================================================================

// ---- Subscription plans (from "Voxel Plans" sheet / calculator tier-grid) ---
export const CREDIT_PLANS = [
  { id: 'pro',     name: 'Pro',    pricePerMonth: 29,  creditsPerMonth: 800  },
  { id: 'proPlus', name: 'Pro+',   pricePerMonth: 49,  creditsPerMonth: 1400 },
  { id: 'studio',  name: 'Studio', pricePerMonth: 129, creditsPerMonth: 4000 },
];

// $/credit for each plan (derived, used for retail-price math if needed)
export const PLAN_RATES = Object.fromEntries(
  CREDIT_PLANS.map(p => [p.id, p.pricePerMonth / p.creditsPerMonth])
);

// ----------------------------------------------------------------------------
// IMAGE — credits per generated image, keyed by app model id then quality.
// Quality keys match the app selector: 'Draft' | '1K' | '2K' | '4K'.
// ----------------------------------------------------------------------------
export const IMAGE_CREDITS = {
  // app id        sheet model            Draft  1K   2K   4K
  'nano-pro':     { Draft: 2,   '1K': 2,   '2K': 2,   '4K': 4   }, // Nano Banana Pro
  'nano-2':       { Draft: 1.5, '1K': 1.5, '2K': 2,   '4K': 3   }, // Nano Banana 2
  'seedream-4':   { Draft: 1,   '1K': 1,   '2K': 1,   '4K': 1   }, // Seedream 4.5
  'gpt-image-2':  { Draft: 4,   '1K': 4,   '2K': 7,   '4K': 12  }, // GPT Image 2 (High variant)
  'gpt-image':    { Draft: 6,   '1K': 6,   '2K': 6,   '4K': 6   }, // GPT Image 1.5 (High, 1K-only in sheet)
  'flux-kontext': { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // Flux Kontext Max (Default rate)
  'flux-2':       { Draft: 1,   '1K': 1,   '2K': 1.5, '4K': 1.5 }, // FLUX.2 Pro
  'wan-22':       { Draft: 1,   '1K': 1,   '2K': 1,   '4K': 1   }, // WAN 2.2 image (Default rate)
};

// Image models NOT in the master plan yet — fall back to model-list `credits`.
export const IMAGE_PENDING = new Set([
  'soul-2', 'seedream-5-lite', 'skin-enhancer', 'face-swap', 'relight',
]);

// ----------------------------------------------------------------------------
// VIDEO — keyed by REAL app model id (from VideoModelModal). Three cost shapes:
//   type: 'per-sec'  → credits = ratePerSec(res, audio) * durationSeconds
//   type: 'flat'     → credits = flat(res)   (duration-independent)
//   type: 'per-gen'  → credits = table keyed by (res, sheet duration; snapped)
// `defaultRes` is used when the panel's resolution isn't priced for that model.
// ----------------------------------------------------------------------------
export const VIDEO_CREDITS = {
  // Kling 3.0 — per second; 1080p splits by audio (sheet: 1.5 / 2.0 cr/s)
  'kling-3': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: {
      '720p':  { off: 1.75, on: 1.75 },
      '1080p': { off: 1.5,  on: 2.0  },
      '4K':    { off: 6,    on: 6    },
    },
  },
  // Kling 2.6 — per second @1080p (sheet: 2 cr/s)
  'kling-2-6': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '1080p': { off: 2, on: 2 } },
  },
  // Seedance 2.0 — per second by resolution (sheet: 3 / 4.5 / 9 / 22 cr/s)
  'seedance-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p':  { off: 3,   on: 3   },
      '720p':  { off: 4.5, on: 4.5 },
      '1080p': { off: 9,   on: 9   },
      '4K':    { off: 22,  on: 22  },
    },
  },
  // Seedance 2.0 Fast — per second (sheet: 1.5 / 3.5 cr/s)
  'seedance-2-fast': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 1.5, on: 1.5 },
      '720p': { off: 3.5, on: 3.5 },
    },
  },
  // Grok Imagine 1.5 (video) — per second (sheet: 2.5 / 4.5 cr/s)
  'grok-imagine': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 2.5, on: 2.5 },
      '720p': { off: 4.5, on: 4.5 },
    },
  },
  // Kling O1 → Kling O1 Video Edit — flat per generation (sheet: 9 cr both res)
  'kling-o1': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 9, '1080p': 9 },
  },
  // Veo 3.1 → mapped to Veo 3.1 Quality — flat per gen by (res, duration 4/6/8)
  'veo-3-1': {
    type: 'per-gen', defaultRes: '1080p',
    byResDuration: {
      '720p':  { 4: 29, 6: 44, 8: 58 },
      '1080p': { 4: 29, 6: 44, 8: 58 },
      '4K':    { 4: 44, 6: 66, 8: 88 },
    },
  },
  // Sora 2 — flat per generation by duration (sheet: 4/8/12 s, single res)
  'sora-2': {
    type: 'per-gen', defaultRes: 'Default',
    byResDuration: { 'Default': { 4: 10, 8: 20, 12: 29 } },
  },
  // Kling 3.0 Omni — not in the sheet; mapped to Kling 3.0 per-sec pricing.
  'kling-3-omni': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: {
      '720p':  { off: 1.75, on: 1.75 },
      '1080p': { off: 1.5,  on: 2.0  },
      '4K':    { off: 6,    on: 6    },
    },
  },

  // ---- Motion Control + Edit panels (keyed by model NAME, not id) ----------
  // These are flat per-generation by resolution.
  // Kling 3.0 Motion Control (sheet: 720p=7, 1080p=10)
  'Kling 3.0 Motion Control': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 7, '1080p': 10 },
  },
  // Kling Motion Control (older) (sheet: 720p=5, 1080p=7)
  'Kling Motion Control': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 5, '1080p': 7 },
  },
  // Kling O1 Video Edit (sheet: 9 at both resolutions)
  'Kling O1 Video Edit': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 9, '1080p': 9 },
  },
  // Kling 3.0 Omni Edit — not in the sheet; mapped to Kling O1 Video Edit (9).
  'Kling 3.0 Omni Edit': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 9, '1080p': 9 },
  },
};

// Video models NOT in the master plan yet — show "—" until you send costs.
// (kling-3-omni, seedance-1-5, wan-2-6, kling-2-5, kling-2-1, hailuo-2-3,
//  seedance-1, ltx-2, ltx-2-audio, vidu-q3, pixverse-5, wan-2-2, vidu-q2)
export const VIDEO_PENDING = new Set([
  'seedance-1-5', 'wan-2-6', 'kling-2-5', 'kling-2-1',
  'hailuo-2-3', 'seedance-1', 'ltx-2', 'ltx-2-audio', 'vidu-q3',
  'pixverse-5', 'wan-2-2', 'vidu-q2',
]);

// ---- helpers ---------------------------------------------------------------

// Parse "8 sec" / "8s" / 8 → 8 (number of seconds)
function toSeconds(duration) {
  if (typeof duration === 'number') return duration;
  const m = String(duration).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// Snap a requested duration to the nearest key the sheet actually prices.
// Ties resolve to the higher duration; values above the max clamp to the max.
function snapDuration(seconds, keys) {
  const opts = keys.map(Number).sort((a, b) => a - b);
  let best = opts[0];
  let bestDelta = Infinity;
  for (const k of opts) {
    const d = Math.abs(k - seconds);
    if (d < bestDelta || (d === bestDelta && k > best)) { best = k; bestDelta = d; }
  }
  return best;
}

/**
 * Credits for one generated image.
 * @param {string} modelId  app model id (e.g. 'gpt-image-2')
 * @param {string} quality  'Draft' | '1K' | '2K' | '4K'
 * @param {number} [fallback]  model-list credits, used for pending models
 * @returns {number|null} credits, or null if unknown
 */
export function getImageCredits(modelId, quality, fallback) {
  if (IMAGE_PENDING.has(modelId)) return fallback ?? null;
  const row = IMAGE_CREDITS[modelId];
  if (!row) return fallback ?? null;
  return row[quality] ?? row['1K'] ?? fallback ?? null;
}

/**
 * Credits for one generated video.
 * @param {string} modelId  app model id (e.g. 'kling-3')
 * @param {object} opts  { resolution, duration, audio }
 * @param {number} [fallback]  model-list credits, used for pending models
 * @returns {number|null} credits, or null if unknown/pending
 */
export function getVideoCredits(modelId, { resolution, duration = 5, audio = false } = {}, fallback) {
  if (VIDEO_PENDING.has(modelId)) return fallback ?? null;
  const cfg = VIDEO_CREDITS[modelId];
  if (!cfg) return fallback ?? null;
  const seconds = toSeconds(duration);

  if (cfg.type === 'per-sec') {
    const r = cfg.byRes[resolution] || cfg.byRes[cfg.defaultRes];
    if (!r) return fallback ?? null;
    const rate = audio ? r.on : r.off;
    return Math.round(rate * seconds * 100) / 100;
  }
  if (cfg.type === 'flat') {
    const flat = cfg.byRes[resolution] ?? cfg.byRes[cfg.defaultRes];
    return flat ?? fallback ?? null;
  }
  if (cfg.type === 'per-gen') {
    const table = cfg.byResDuration[resolution] || cfg.byResDuration[cfg.defaultRes];
    if (!table) return fallback ?? null;
    const key = snapDuration(seconds, Object.keys(table));
    return table[key] ?? fallback ?? null;
  }
  return fallback ?? null;
}
