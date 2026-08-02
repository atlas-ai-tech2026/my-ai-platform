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
  // ── added 2026-08-02 from the workbook, standard formula ──
  // Imagen 4: kie exposes no resolution tier, so one price per variant.
  'imagen-4-fast':    { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // basis $0.040 → 57.9%
  'imagen-4':         { Draft: 1.5, '1K': 1.5, '2K': 1.5, '4K': 1.5 }, // basis $0.050 → 47.4%
  'imagen-4-ultra':   { Draft: 2,   '1K': 2,   '2K': 2,   '4K': 2   }, // basis $0.060 → 52.6%
  // Seedream 5 Pro tops out at 2K (quality basic=1K / high=2K), so a 4K
  // request is served — and charged — at the 2K tier.
  'seedream-5-pro':   { Draft: 1,   '1K': 1,   '2K': 2,   '4K': 2   }, // basis $0.035/$0.070 → 44.7%
};

// ---- VIDEO — keyed by app model id (plus panel model NAMES for the
// Motion Control / Edit tabs, matching creditPricing.js). Shapes:
//   type 'per-sec' → credits = byRes[res].(on|off) × seconds
//   type 'flat'    → credits = byRes[res] (duration-independent) ------------
export const VIDEO_CREDITS = {
  // Kling 3.0 — kie charges DISTINCT rates per resolution (verified against
  // kie's own price table, 2026-08-02):
  //   720p  $0.070/s no-audio · $0.100/s with audio
  //   1080p $0.090/s no-audio · $0.135/s with audio
  //   4K    $0.335/s (same with or without audio)
  // Priced against KIE, the supplier these actually run on (owner's
  // decision 2026-08-02, from kie's own price table). FAL's rate is higher
  // at 720p ($0.084/s), so this trades the workbook's "safe vs both
  // suppliers" guarantee for pricing that matches real cost: 720p no-audio
  // is 2 cr/s = 44.7% vs kie. If Kling 3.0 ever moves to FAL, that tier
  // drops to 33.7% and must be repriced.
  // The dispatcher must also send mode 'std' for 720p — charging a 720p
  // rate while sending 'pro' would deliver, and pay for, 1080p.
  'kling-3': {
    type: 'per-sec', defaultRes: '1080p',
    byRes: {
      '720p':  { off: 2,   on: 3 },
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
  // Gemini Omni — kie bills PER WHOLE VIDEO, and the cost is NOT linear in
  // duration: it is a fixed base plus a per-second component
  // ($0.105 + $0.0525/s at 720p/1080p; $0.525 + $0.0525/s at 4K). A
  // per-second price therefore cannot fit it — it undercharged short clips
  // (4s at 4K gave only 27.5% margin) and overcharged long ones. Priced per
  // (resolution, duration) against kie's published table instead. 720p and
  // 1080p cost the same. Verified 2026-08-02.
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

// ---- VOICE — credits per 1,000 CHARACTERS, per the workbook's
// "VOICE MODELS — per 1,000 characters" section. Same formula as everything
// else: basis = MAX(fal, kie) → sale = basis / (1 − 40%) →
// CEILING(sale / $0.063333, 0.5).
//
//   Multilingual v2  fal $0.10 / kie $0.06 → basis 0.10 → 3   cr/1k chars
//   Eleven v3        fal $0.10 / kie $0.07 → basis 0.10 → 3   cr/1k chars
//   Turbo v2.5       fal $0.05 / kie $0.03 → basis 0.05 → 1.5 cr/1k chars
//
// This replaced a FLAT 1-credit-per-take charge that ignored length
// entirely: a 5,000-character take cost us $0.50 and earned $0.063, a
// margin of −689%. Every take over ~380 characters was losing money.
export const VOICE_CREDITS_PER_1K = {
  'multilingual-v2': 3,
  'eleven-v3': 3,
  'turbo-v2-5': 1.5,
};

// PRO-RATED by character, exactly as video is pro-rated by second: the
// workbook's CEILING(…, 0.5) sets the UNIT price (3 credits per 1,000
// chars), and the charge is that unit rate × the quantity used — we don't
// re-round per generation for video, so we don't for voice either.
//
// Floored at 0.5 credits (the smallest unit the workbook uses) so a very
// short take can never round down to a free generation.
export const VOICE_MIN_CREDITS = 0.5;

export function getVoiceCredits(model, chars) {
  const rate = VOICE_CREDITS_PER_1K[model] ?? VOICE_CREDITS_PER_1K['eleven-v3'];
  const n = Math.max(0, Number(chars) || 0);
  const exact = rate * (n / 1000);
  return Math.max(VOICE_MIN_CREDITS, Math.round(exact * 100) / 100);
}

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
  'Imagen 4 Fast': 'imagen-4-fast',
  'Imagen 4': 'imagen-4',
  'Imagen 4 Ultra': 'imagen-4-ultra',
  'Seedream 5 Pro': 'seedream-5-pro',
};

export const VIDEO_LABEL_TO_ID = {
  'Kling 3.0': 'kling-3',
  'Kling 3.0 Turbo': 'kling-3-turbo',
  'Gemini Omni': 'gemini-omni',
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

// Snap a requested duration to the nearest duration the provider actually
// prices. Ties resolve UPWARD, so we never charge the cheaper tier for a
// clip that sits exactly between two. Must stay identical to the copy in
// src/lib/creditPricing.js — the parity test compares their outputs.
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
  // per-gen — the provider bills per WHOLE video at a rate that is not
  // linear in duration (a fixed base plus a per-second part), so the price
  // is looked up per (resolution, duration).
  if (cfg.type === 'per-gen') {
    const table = cfg.byResDuration[resolution] || cfg.byResDuration[cfg.defaultRes];
    if (!table) return null;
    return table[snapDuration(seconds, Object.keys(table))] ?? null;
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
