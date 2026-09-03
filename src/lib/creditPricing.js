// ============================================================================
// VOXEL — Credit pricing (DISPLAY MIRROR of the server tables)
// ----------------------------------------------------------------------------
// C1 (security audit 2026-07-28): the AUTHORITATIVE price tables live in
// server/src/pricing.js — the server computes and charges every generation
// price itself. This file only drives what the UI displays. At app boot,
// syncPricingFromServer() fetches GET /api/pricing and overwrites the
// bundled tables below in place, so the displayed price always matches
// what the server will charge; the bundled values are the offline/startup
// fallback (kept in lockstep by server/src/pricing.test.js).
// The `credit_cost` the app sends with a generation is a display hint the
// server validates (409 on mismatch) — it can never set the charge.
//
// Derived from Voxel_Plans_and_Credits.xlsx (2026-07-21) — sheets "Plans",
// "Model Credits", "Profit Check".
//
// Pricing rules (from that workbook):
//   • 1 credit = $0.063333 (anchor: $19 plan / 300 credits) — identical on
//     every plan, so all plans carry the same margin.
//   • Cost basis per model = the HIGHER of the fal and kie cost. Sale price =
//     basis / (1 − 40%). Credits = CEILING(sale / credit value, 0.5).
//   • Result: every model clears ≥40% profit of sale even against the more
//     expensive supplier — against the real kie backend the margin is larger.
//     Worst case anywhere in the sheet: 40.1%.
//
// If you change a number here, the Image/Video GENERATE buttons update
// automatically — nothing else to touch.
//
// Mapping notes:
//   • The app's image "quality" selector is [Draft, 1K, 2K, 4K]. The sheet
//     prices 1K/2K together for Nano models; Draft reuses the 1K price.
//   • Video per-second rows: credits = rate/s × duration. Kling 2.6 is priced
//     per 5s clip in the sheet (7.5 / 14.5 with audio) → 1.5 / 2.9 per second.
//   • Veo 3.1 is per WHOLE video (kie bills per clip), duration-independent.
// ============================================================================

// ---- Subscription plans (Voxel_Plans_and_Credits.xlsx → "Plans") -----------
export const CREDIT_PLANS = [
  { id: 'micro',   name: 'Micro',   pricePerMonth: 5,   creditsPerMonth: 79   },
  { id: 'starter', name: 'Starter', pricePerMonth: 10,  creditsPerMonth: 158  },
  { id: 'basic',   name: 'Basic',   pricePerMonth: 19,  creditsPerMonth: 300  },
  { id: 'plus',    name: 'Plus',    pricePerMonth: 59,  creditsPerMonth: 932  },
  { id: 'pro',     name: 'Pro',     pricePerMonth: 95,  creditsPerMonth: 1500 },
  { id: 'max',     name: 'Max',     pricePerMonth: 129, creditsPerMonth: 2037 },
];

// $/credit — constant across plans by design ($19 / 300).
export const CREDIT_VALUE_USD = 19 / 300;

// $/credit for each plan (derived, used for retail-price math if needed)
export const PLAN_RATES = Object.fromEntries(
  CREDIT_PLANS.map(p => [p.id, p.pricePerMonth / p.creditsPerMonth])
);

// ----------------------------------------------------------------------------
// IMAGE — credits per generated image, keyed by app model id then quality.
// Quality keys match the app selector: 'Draft' | '1K' | '2K' | '4K'.
// ----------------------------------------------------------------------------
export const IMAGE_CREDITS = {
  // ── workbook rows (Voxel_Plans_and_Credits.xlsx) ──
  // app id           workbook row                 Draft  1K   2K    4K
  'nano-pro':        { Draft: 4, '1K': 4, '2K': 4,   '4K': 8  }, // Nano Banana Pro (basis .15/.30)
  'nano-2':          { Draft: 4, '1K': 4, '2K': 4,   '4K': 8  }, // Nano Banana 2   (basis .15/.30)
  'gpt-image-2':     { Draft: 6, '1K': 6, '2K': 6.5, '4K': 11 }, // GPT Image 2     (basis .219/.234/.413)
  'seedream-5-lite': { Draft: 1, '1K': 1, '2K': 1,   '4K': 1  }, // Seedream 5.0 Lite (basis .035, flat)
  // ── restored catalog (2026-07-21) — same 40% formula, conservative cost
  //    basis noted per row; tighten once live invoice data accumulates ──
  'gpt-image':        { Draft: 4.5, '1K': 4.5, '2K': 4.5, '4K': 4.5 }, // GPT Image 1.5, kie (basis ≤.17)
  'seedream-4':       { Draft: 1,   '1K': 1,   '2K': 1,   '4K': 2   }, // Seedream 4.5, kie (basis .03/.06)
  'flux-kontext':     { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // Flux Kontext Pro, kie (basis .04)
  'flux-2':           { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // Flux 2 Pro, kie (basis ≤.04)
  'gpt-4o-image':     { Draft: 2,   '1K': 2,   '2K': 2,   '4K': 2   }, // GPT-4o Image, kie (basis .05 → 60%)
  'flux-kontext-max': { Draft: 3,   '1K': 3,   '2K': 3,   '4K': 3   }, // Flux Kontext Max, kie (basis .08 → 58%)
  'midjourney':       { Draft: 3,   '1K': 3,   '2K': 3,   '4K': 3   }, // Midjourney task, kie (basis .08 → 58%)
  'soul-2':           { Draft: 1,   '1K': 1,   '2K': 1,   '4K': 1   }, // Soul 2.0, FAL (basis .025)
  'wan-22':           { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // Wan 2.2 Image, FAL (basis ≤.05)
  'skin-enhancer':    { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // aura-sr, FAL (basis ≤.05)
  'face-swap':        { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // FAL (basis ≤.04)
  'relight':          { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // ic-light, FAL (basis ≤.04)
  // ── added 2026-08-02 from the workbook. Must stay identical to
  //    server/src/pricing.js — enforced by the parity test. ──
  'imagen-4-fast':    { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // basis $0.040 → 57.9%
  'imagen-4':         { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // basis $0.050 → 47.4%
  'imagen-4-ultra':   { Draft: 2,   '1K': 2,   '2K': 2,   '4K': 2   }, // basis $0.060 → 52.6%
  'seedream-5-pro':   { Draft: 1,   '1K': 1,   '2K': 2,   '4K': 2   }, // tops out at 2K
};

// Image models NOT in the pricing workbook — fall back to model-list `credits`.
// Empty by design: the picker only offers workbook-priced models.
export const IMAGE_PENDING = new Set([]);

// ----------------------------------------------------------------------------
// VIDEO — keyed by REAL app model id (from VideoModelModal). Three cost shapes:
//   type: 'per-sec'  → credits = ratePerSec(res, audio) * durationSeconds
//   type: 'flat'     → credits = flat(res)   (duration-independent)
//   type: 'per-gen'  → credits = table keyed by (res, sheet duration; snapped)
// `defaultRes` is used when the panel's resolution isn't priced for that model.
// ----------------------------------------------------------------------------
export const VIDEO_CREDITS = {
  // Kling 3.0 — per second (workbook: 1080p 2.5 no-audio / 4 with audio;
  // 4K 9 with audio). 720p reuses the 1080p rate (kie "std/pro" mode covers
  // both; the sheet's 720p tier is Kling 3.0 Turbo, not offered yet).
  // Kling 3.0 — kie charges DISTINCT rates per resolution (verified against
  // kie's price table 2026-08-02): 720p $0.070/$0.100, 1080p $0.090/$0.135,
  // 4K $0.335 either way. 720p previously reused the 1080p price.
  'kling-3': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: {
      '720p':  { off: 2,   on: 3 },
      '1080p': { off: 2.5, on: 4 },
      '4K':    { off: 9,   on: 9 },
    },
  },
  // Kling 2.6 — workbook prices per 5s clip (7.5 no-audio / 14.5 audio)
  // → 1.5 / 2.9 per second; kie durations are 5s or 10s so this lands
  // exactly on the sheet numbers (and 2× for 10s).
  // Kling 3.0 Turbo — added 2026-08-02. basis = kie cost (720p $0.09/s,
  // 1080p $0.1125/s) → sale = basis / (1 − 40%) → CEILING(…, 0.5) = 2.5 and
  // 3 cr/s (43.2% / 40.8% margin). Turbo has no audio param, so on === off.
  // Must stay identical to server/src/pricing.js — enforced by a parity test.
  'kling-3-turbo': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '720p':  { off: 2.5, on: 2.5 },
      '1080p': { off: 3,   on: 3   },
    },
  },
  // Gemini Omni — priced PER SECOND (the workbook lists only the 6s clip,
  // but kie allows 4/6/8/10s and a flat price would fall to 3.9% margin at
  // 10s). $0.070/s and $0.140/s → 2 and 4 cr/s, 44.7% at every duration.
  // Gemini Omni — kie bills PER WHOLE VIDEO at a rate that is NOT linear in
  // duration (fixed base + per-second part), so it is priced per
  // (resolution, duration). 720p and 1080p cost the same.
  'gemini-omni': {
    type: 'per-gen', defaultRes: '720p',
    byResDuration: {
      '720p':  { 4: 8.5,  6: 11.5, 8: 14, 10: 17 },
      '1080p': { 4: 8.5,  6: 11.5, 8: 14, 10: 17 },
      '4K':    { 4: 19.5, 6: 22.5, 8: 25, 10: 28 },
    },
  },
  'kling-2-6': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '1080p': { off: 1.5, on: 2.9 } },
  },
  // Seedance 2.0 — per second by resolution (workbook: 4 / 8 / 18 / 41.5;
  // audio is free on Seedance, so on === off).
  'seedance-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p':  { off: 4,    on: 4    },
      '720p':  { off: 8,    on: 8    },
      '1080p': { off: 18,   on: 18   },
      '4K':    { off: 41.5, on: 41.5 },
    },
  },
  // Seedance 2.5 — kie (bytedance/seedance-2-5). Costs MEASURED from the kie
  // balance, not taken from fal: 480p $0.1400/s, 720p $0.3150/s,
  // 1080p $0.5700/s. See server/src/pricing.js for the full working.
  'seedance-2-5': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p':  { off: 4,    on: 4    },
      '720p':  { off: 8.5,  on: 8.5  },
      '1080p': { off: 15.5, on: 15.5 },
    },
  },
  // Seedance 2.0 Fast — per second (workbook: 3 / 6.5)
  'seedance-2-fast': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 3,   on: 3   },
      '720p': { off: 6.5, on: 6.5 },
    },
  },
  // Seedance 2.0 Mini — per second (workbook: 1.5 / 3)
  'seedance-2-mini': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p': { off: 1.5, on: 1.5 },
      '720p': { off: 3,   on: 3   },
    },
  },
  // Veo 3.1 Quality — flat per WHOLE video (kie bills per clip):
  // 720p 33 / 1080p 34 / 4K 49.
  'veo-3-1': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 33, '1080p': 34, '4K': 49 },
  },
  // "Veo 3" label maps to the same kie veo3 Quality backend — same price.
  'veo-3': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 33, '1080p': 34, '4K': 49 },
  },
  // Veo 3.1 Fast — flat per video: 720p 8 / 1080p 9.
  'veo-3-fast': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 8, '1080p': 9 },
  },

  // ── restored catalog (2026-07-21) — 40% formula, conservative basis ──
  // Sora 2 via kie — flat per clip (basis ≤ $0.30 covered at 40%).
  'sora-2': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 8, '1080p': 8 },
  },
  // Wan 2.6 via kie — per second (basis ≤ $0.076/s).
  'wan-2-6': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '720p': { off: 2, on: 2 }, '1080p': { off: 2, on: 2 } },
  },
  // Seedance 1.5 Pro via kie — per second by resolution.
  'seedance-1-5': {
    type: 'per-sec', defaultRes: '720p',
    byRes: {
      '480p':  { off: 2,   on: 2   },
      '720p':  { off: 3.5, on: 3.5 },
      '1080p': { off: 6.5, on: 6.5 },
    },
  },
  // Grok Imagine via kie — per second, durations up to 30s (basis ≤$0.019/s).
  'grok-imagine': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '480p': { off: 0.5, on: 0.5 }, '720p': { off: 0.5, on: 0.5 } },
  },
  // Kling 3.0 Omni — kie's Kling O3 since 2026-09-03. Price unchanged (it
  // was set against a $0.152/s basis) until kie's own O3 price line is read.
  'kling-3-omni': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '720p': { off: 4, on: 4 }, '1080p': { off: 4, on: 4 } },
  },
  // Kling 2.5 — kie's 2.5 Turbo Pro since 2026-09-03 ($0.042/s → 1.2 cr/s).
  'kling-2-5': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '1080p': { off: 1.2, on: 1.2 } },
  },
  // Kling 2.1 — kie's 2.1 Standard since 2026-09-03: image-to-video, 720p,
  // $0.025/s → 1 cr/s by the standard formula (was 2 against a FAL basis).
  'kling-2-1': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '720p': { off: 1, on: 1 } },
  },
  // Kling O1 retired 2026-09-03 — it never existed on kie (Voxel's "O1" was
  // FAL's Kling 1.6 under another name).
  // Hailuo 2.3 — FAL minimax (basis ≤$0.285/clip).
  'hailuo-2-3': {
    type: 'flat', defaultRes: '1080p',
    byRes: { '720p': 7.5, '1080p': 7.5 },
  },
  // Seedance 1 — FAL lite (basis ≤$0.057/s).
  'seedance-1': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '480p': { off: 2, on: 2 }, '720p': { off: 2, on: 2 } },
  },
  // LTX 2 — FAL (basis ≤$0.076/s).
  'ltx-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '720p': { off: 2, on: 2 }, '4K': { off: 2, on: 2 } },
  },
  // Vidu — FAL q1 (basis ≤$0.42/gen).
  'vidu-q3': { type: 'flat', defaultRes: '1080p', byRes: { '720p': 11.5, '1080p': 11.5 } },
  'vidu-q2': { type: 'flat', defaultRes: '1080p', byRes: { '720p': 11.5, '1080p': 11.5 } },
  // PixVerse 5 — FAL (basis ≤$0.038/s).
  'pixverse-5': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '720p': { off: 1, on: 1 }, '1080p': { off: 1, on: 1 } },
  },
  // Wan 2.2 — FAL (basis ≤$0.057/s).
  'wan-2-2': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '480p': { off: 2, on: 2 }, '720p': { off: 2, on: 2 } },
  },

  // ---- Motion Control + Edit panels (keyed by model NAME, not id) ----------
  // Motion Control runs on kie since 2026-09-03 and kie bills PER SECOND of
  // the reference clip, so these are per-second too (was flat per clip).
  // 3.0: kie's own line ($0.10/s 720p, $0.135/s 1080p) → 3 / 4 cr/s.
  // 2.6: priced at the 3.0 rates until kie's own line is read. Working in
  // server/src/pricing.js; must stay identical (parity test).
  'Kling 3.0 Motion Control': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: { '720p': { off: 3, on: 3 }, '1080p': { off: 4, on: 4 } },
  },
  'Kling Motion Control': {
    type: 'per-sec', defaultRes: '720p',
    byRes: { '720p': { off: 3, on: 3 }, '1080p': { off: 4, on: 4 } },
  },
  // Kling O1 Video Edit retired 2026-09-03 — no kie twin.
  // Kling 3.0 Omni Edit — flat per clip, unchanged.
  'Kling 3.0 Omni Edit': {
    type: 'flat', defaultRes: '720p',
    byRes: { '720p': 10, '1080p': 10 },
  },
};

// Video models NOT in the pricing workbook — empty by design: the picker
// only offers workbook-priced, kie-backed models.
export const VIDEO_PENDING = new Set([]);

// ---- server sync (C1) ------------------------------------------------------

// Replace a table's contents in place so every module holding a reference
// (getImageCredits/getVideoCredits callers) sees the fresh numbers.
function replaceTable(target, next) {
  if (!next || typeof next !== 'object') return;
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, next);
}

/**
 * Fetch the authoritative price tables from the server and overwrite the
 * bundled fallbacks. Called once at app boot (src/main.jsx). Best-effort:
 * on failure the bundled snapshot keeps driving the display, and the
 * server's 409 price-mismatch check remains the safety net.
 */
export async function syncPricingFromServer() {
  try {
    const res = await fetch('/api/pricing');
    if (!res.ok) return false;
    const data = await res.json();
    replaceTable(IMAGE_CREDITS, data?.image);
    replaceTable(VIDEO_CREDITS, data?.video);
    return true;
  } catch {
    return false;
  }
}

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
