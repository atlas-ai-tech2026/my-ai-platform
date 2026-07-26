// ─── kie-pricing.js ──────────────────────────────────────────────────────────
// What each generation costs US at kie.ai, in KIE CREDITS — so the admin
// Logs/Usage pages can show "this transaction took N voxel credits from the
// user and M kie credits from our kie.ai balance".
//
// Source: Voxel_Plans_and_Credits.xlsx → "Model Credits" (kie cost column,
// USD, read 2026-07-26) — the same workbook creditPricing.js was built from.
// kie.ai sells credits at 1 credit ≈ $0.005 (kie.ai/billing), so
//   kie credits = kie USD cost / 0.005.
//
// Estimates, not invoices: kie doesn't return per-task cost in its API, so
// these are OUR prices for THEIR meter. A model missing here (or a kie price
// we haven't confirmed) yields null → the UI shows "—". Update this table
// when kie reprices or a new kie-backed model ships; the workbook stays the
// source of truth.

export const KIE_USD_PER_CREDIT = 0.005;

// Keyed by the app's model label (what charge notes carry, e.g.
// "video: Kling 3.0"). Three unit shapes:
//   { perImage: { '1K': usd, '2K': usd, '4K': usd } }         → images
//   { perSecond: { '480p': usd, ... } | { flat: usd } }       → video, ×duration
//   { perVideo: { '720p': usd, ... } | { flat: usd } }        → video, per clip
// Video entries may key by audio tier: { audio: {...}, noAudio: {...} }.
const KIE_USD = {
  // ── images (per image) ──
  'Nano Banana Pro':   { perImage: { '1K': 0.09, '2K': 0.09, '4K': 0.12 } },
  'Nano Banana 2':     { perImage: { '1K': 0.04, '2K': 0.06, '4K': 0.09 } },
  'GPT Image 2':       { perImage: { '1K': 0.03, '2K': 0.05, '4K': 0.08 } },
  'GPT Image 1.5':     { perImage: { '1K': 0.17, '2K': 0.17, '4K': 0.17 } }, // workbook basis ≤.17, kie-only
  'Flux Kontext':      { perImage: { '1K': 0.04, '2K': 0.04, '4K': 0.04 } },
  'Seedream 4.5':      { perImage: { '1K': 0.03, '2K': 0.03, '4K': 0.06 } },
  'Seedream 5 Pro':    { perImage: { '1K': 0.035, '2K': 0.07, '4K': 0.07 } },
  'Seedream 5.0 Lite': { perImage: { '1K': 0.0275, '2K': 0.0275, '4K': 0.0275 } },
  // kie price not yet confirmed for: GPT-4o Image, Midjourney, Flux 2,
  // Flux Kontext Max → intentionally absent (estimate() returns null).

  // ── video, billed per second ──
  'Seedance 2.0':      { perSecond: { '480p': 0.095, '720p': 0.205, '1080p': 0.51, '4K': 1.04 } },
  'Seedance 2.0 Fast': { perSecond: { '480p': 0.0775, '720p': 0.165 } },
  'Seedance 2.0 Mini': { perSecond: { '480p': 0.0475, '720p': 0.1025 } },
  'Kling 3.0': {
    perSecond: {
      audio:   { '1080p': 0.135, '4K': 0.335 },
      noAudio: { '1080p': 0.09, '4K': 0.335 }, // 4K row is audio-only in the sheet
    },
  },
  'Kling 3.0 Turbo':   { perSecond: { '720p': 0.09, '1080p': 0.1125 } },

  // ── video, billed per whole clip ──
  // Veo: kie bills per video regardless of duration. "Veo 3"/"Veo 3.1" both
  // run kie's veo3 quality tier; "Veo 3 Fast" the fast tier.
  'Veo 3':      { perVideo: { '720p': 1.25, '1080p': 1.275, '4K': 1.85 } },
  'Veo 3.1':    { perVideo: { '720p': 1.25, '1080p': 1.275, '4K': 1.85 } },
  'Veo 3 Fast': { perVideo: { '720p': 0.3, '1080p': 0.325 } },
  // Kling 2.6: sheet prices the 5s clip (0.275 / 0.55 with audio); kie's
  // only durations are 5s and 10s, so scale linearly per second.
  'Kling 2.6': {
    perSecond: { audio: { flat: 0.11 }, noAudio: { flat: 0.055 } },
  },
  // kie price not yet confirmed for: Sora 2, Wan 2.6, Grok Imagine,
  // Seedance 1.5 Pro → intentionally absent.
};

const usdToCredits = (usd) => Math.round((usd / KIE_USD_PER_CREDIT) * 100) / 100;

// Pick from a per-resolution table with sane fallbacks: exact match, else
// the closest priced tier at-or-below, else the cheapest priced tier.
const RES_ORDER = ['480p', '720p', '1080p', '4K'];
function pickRes(table, resolution) {
  if (table.flat != null) return table.flat;
  const res = normalizeRes(resolution);
  if (table[res] != null) return table[res];
  const priced = RES_ORDER.filter((r) => table[r] != null);
  if (!priced.length) return null;
  const idx = RES_ORDER.indexOf(res);
  const below = priced.filter((r) => RES_ORDER.indexOf(r) <= idx);
  return table[below.length ? below[below.length - 1] : priced[0]];
}

function normalizeRes(resolution) {
  const r = String(resolution || '').toLowerCase();
  if (r.includes('4k')) return '4K';
  if (r.includes('1080')) return '1080p';
  if (r.includes('720')) return '720p';
  if (r.includes('480')) return '480p';
  return '1080p'; // app default for video
}

function normalizeQuality(quality) {
  const q = String(quality || '').toUpperCase();
  if (q.includes('4K')) return '4K';
  if (q.includes('2K')) return '2K';
  return '1K'; // Draft and 1K share pricing throughout the workbook
}

/**
 * Estimated KIE credits a generation consumes from OUR kie.ai balance.
 * Returns a number (2dp) or null when the model has no kie price on file —
 * callers store null and the UI renders "—".
 */
export function estimateKieCredits({ kind, model, resolution, duration, audio, quality } = {}) {
  const entry = KIE_USD[model];
  if (!entry) return null;

  if (entry.perImage) {
    const usd = entry.perImage[normalizeQuality(quality || resolution)];
    return usd == null ? null : usdToCredits(usd);
  }

  const table = (entry.perSecond || entry.perVideo);
  const tiered = table.audio || table.noAudio
    ? (audio ? table.audio : table.noAudio)
    : table;
  const usd = pickRes(tiered, resolution);
  if (usd == null) return null;

  if (entry.perSecond) {
    const secs = Math.max(1, parseInt(duration, 10) || 5);
    return usdToCredits(usd * secs);
  }
  return usdToCredits(usd);
}
