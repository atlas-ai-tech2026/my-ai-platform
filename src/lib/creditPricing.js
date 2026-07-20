// ============================================================================
// VOXEL — Credit pricing (SINGLE SOURCE OF TRUTH)
// ----------------------------------------------------------------------------
// Derived from Voxel_MASTER_PLAN.xlsx  → sheet "HF Verified Credits"
// and Voxel_Credit_Calculator.html. These are the verified Higgsfield credit
// costs charged to the user per generation.
//
// PRICE RAISE (applied on top of the verified baseline): every model is +1
// credit per generation. For per-second video models that means +0.2 cr/s, so
// a representative 5-second clip rises by exactly 1 credit. Per-generation
// prices (images, flat video, per-gen video) are simply +1.
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
  // app id        sheet model            Draft  1K   2K   4K   (baseline +1)
  'nano-pro':     { Draft: 3,   '1K': 3,   '2K': 3,   '4K': 5   }, // Nano Banana Pro
  'nano-2':       { Draft: 2.5, '1K': 2.5, '2K': 3,   '4K': 4   }, // Nano Banana 2
  'seedream-4':   { Draft: 2,   '1K': 2,   '2K': 2,   '4K': 2   }, // Seedream 4.5
  'gpt-image-2':  { Draft: 5,   '1K': 5,   '2K': 8,   '4K': 13  }, // GPT Image 2 (High variant)
  'gpt-image':    { Draft: 7,   '1K': 7,   '2K': 7,   '4K': 7   }, // GPT Image 1.5 (High, 1K-only in sheet)
  'flux-kontext': { Draft: 2.5, '1K': 2.5, '2K': 2.5, '4K': 2.5 }, // Flux Kontext Max (Default rate)
  'flux-2':       { Draft: 2,   '1K': 2,   '2K': 2.5, '4K': 2.5 }, // FLUX.2 Pro
  'wan-22':       { Draft: 2,   '1K': 2,   '2K': 2,   '4K': 2   }, // WAN 2.2 image (Default rate)
  // ---- kie.ai-backed models (flat — kie has no quality tiers) --------------
  // Priced with the house margin rule: kie_cost × 1.10 ÷ 0.03225 (Studio
  // $/credit), rounded UP to the nearest 0.5 so every plan clears ≥10%:
  //   GPT-4o Image     ~$0.05/img → 1.71 → 2
  //   Flux Kontext Max ~$0.08/img → 2.73 → 3
  //   Midjourney       ~$0.08/task (4 images!) → 2.73 → 3
  'gpt-4o-image':     { Draft: 2, '1K': 2, '2K': 2, '4K': 2 },
  'flux-kontext-max': { Draft: 3, '1K': 3, '2K': 3, '4K': 3 },
  'midjourney':       { Draft: 3, '1K': 3, '2K': 3, '4K': 3 },
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
  // Kling 3.0 — per second; 1080p splits by audio (sheet: 1.5 / 2.0 cr/s, +0.2)
  'kling-3': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: {
      '720p':  { off: 1.95, on: 1.95 },
      '1080p': { off: 1.7,  on: 2.2  },
      '4K':    { off: 6.2,  on: 6.2  },
    },
  },
  // Kling 2.6 — per second @1080p (sheet: 2 cr/s, +0.2)
  'kling-2-6': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '1080p': { off: 2.2, on: 2.2 } },
  },
  // Seedance 2.0 — per second by resolution (sheet: 3 / 4.5 / 9 / 22 cr/s, +0.2)
  'seedance-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p':  { off: 3.2,  on: 3.2  },
      '720p':  { off: 4.7,  on: 4.7  },
      '1080p': { off: 9.2,  on: 9.2  },
      '4K':    { off: 22.2, on: 22.2 },
    },
  },
  // Seedance 2.0 Fast — per second (sheet: 1.5 / 3.5 cr/s, +0.2)
  'seedance-2-fast': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 1.7, on: 1.7 },
      '720p': { off: 3.7, on: 3.7 },
    },
  },
  // Seedance 2.0 Mini — per second. Priced for a guaranteed ≥10% profit over
  // FAL's output cost ($0.0721/s @480p, $0.1547/s @720p), calibrated against
  // the lowest-$/credit plan (Studio @ $0.03225/cr) so every plan clears 10%:
  //   480p: 0.0721×1.10 ÷ 0.03225 = 2.46 → 2.5 cr/s (+0.2 raise → 2.7)
  //   720p: 0.1547×1.10 ÷ 0.03225 = 5.28 → 5.5 cr/s (+0.2 raise → 5.7)
  // (audio is free on Seedance, so on === off.)
  'seedance-2-mini': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 2.7, on: 2.7 },
      '720p': { off: 5.7, on: 5.7 },
    },
  },
  // Grok Imagine 1.5 (video) — per second (sheet: 2.5 / 4.5 cr/s, +0.2)
  'grok-imagine': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 2.7, on: 2.7 },
      '720p': { off: 4.7, on: 4.7 },
    },
  },
  // Kling O1 → Kling O1 Video Edit — flat per generation (sheet: 9 cr, +1)
  'kling-o1': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 10, '1080p': 10 },
  },
  // Veo 3.1 → mapped to Veo 3.1 Quality — flat per gen by (res, duration 4/6/8, +1)
  'veo-3-1': {
    type: 'per-gen', defaultRes: '1080p',
    byResDuration: {
      '720p':  { 4: 30, 6: 45, 8: 59 },
      '1080p': { 4: 30, 6: 45, 8: 59 },
      '4K':    { 4: 45, 6: 67, 8: 89 },
    },
  },
  // Sora 2 — flat per generation by duration (sheet: 4/8/12 s, single res, +1)
  'sora-2': {
    type: 'per-gen', defaultRes: 'Default',
    byResDuration: { 'Default': { 4: 11, 8: 21, 12: 30 } },
  },
  // Veo 3 / Veo 3 Fast via kie.ai — flat per generation regardless of
  // duration (kie prices per video: Veo 3 $1.25, Veo 3 Fast $0.30). House
  // margin rule (cost × 1.10 ÷ 0.03225, rounded up to 0.5):
  //   Veo 3:      1.25 → 42.64 → 43
  //   Veo 3 Fast: 0.30 → 10.23 → 10.5
  'veo-3': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 43, '1080p': 43 },
  },
  'veo-3-fast': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 10.5, '1080p': 10.5 },
  },
  // Kling 3.0 Omni — not in the sheet; mapped to Kling 3.0 per-sec pricing (+0.2).
  'kling-3-omni': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: {
      '720p':  { off: 1.95, on: 1.95 },
      '1080p': { off: 1.7,  on: 2.2  },
      '4K':    { off: 6.2,  on: 6.2  },
    },
  },

  // ---- Motion Control + Edit panels (keyed by model NAME, not id) ----------
  // These are flat per-generation by resolution.
  // Kling 3.0 Motion Control (sheet: 720p=7, 1080p=10, +1)
  'Kling 3.0 Motion Control': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 8, '1080p': 11 },
  },
  // Kling Motion Control (older) (sheet: 720p=5, 1080p=7, +1)
  'Kling Motion Control': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 6, '1080p': 8 },
  },
  // Kling O1 Video Edit (sheet: 9 at both resolutions, +1)
  'Kling O1 Video Edit': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 10, '1080p': 10 },
  },
  // Kling 3.0 Omni Edit — not in the sheet; mapped to Kling O1 Video Edit (+1).
  'Kling 3.0 Omni Edit': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 10, '1080p': 10 },
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
