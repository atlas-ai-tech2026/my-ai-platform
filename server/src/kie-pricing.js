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

// ─── CALIBRATION AGAINST THE REAL INVOICE ────────────────────────────────────
// DISPLAY ONLY. This must never touch usdToCredits() or the costing engine.
//
// KIE_USD_PER_CREDIT above is used in BOTH directions — credits are derived
// from our per-model USD table on the way in, and multiplied back out on the
// way to a screen — so it cancels itself and cannot correct a reporting error.
// Changing it would appear to fix rows already stored and leave every future
// row exactly as wrong.
//
// The real gap is that our per-model KIE prices are high. Measured 2026-08-15
// against kie.ai's own dashboard for 2–15 Aug 2026:
//
//     our 361,087.30 credits × $0.005 = $1,805.44
//     kie.ai actually billed          = $1,559.068
//     ratio                           = 0.863541  (≈ $0.004318/credit)
//
// Applied only where we REPORT what a supplier cost us. The recorded credits,
// the customer's charge, and the ≥40% margin rule are all untouched — pricing
// stays deliberately conservative, so real margins run BETTER than the CRM
// shows, which is the safe direction to be wrong in.
//
// ⚠️ ONE INVOICE, ONE WINDOW, dominated by Kling 3.0. If kie.ai gives volume
// discounts this drifts with the model mix. Re-measure on the next invoice and
// update the three numbers below together — never the ratio alone, or the
// provenance stops meaning anything.
export const KIE_CALIBRATION = {
  factor: 0.863541,
  measured_on: '2026-08-15',
  window: '2026-08-02..2026-08-15',
  our_estimate_usd: 1805.44,
  billed_usd: 1559.068,
};

/** What a recorded KIE credit really costs, per the last invoice. */
export const kieBilledUsdPerCredit = () => KIE_USD_PER_CREDIT * KIE_CALIBRATION.factor;

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
  // ── Kling models moved off FAL 2026-09-03 (owner: every Kling choice
  //    calls its kie twin). Bases: kie 2.5 Turbo Pro $0.21 per 5 s clip
  //    (costing seed row 46); kie 2.1 Standard 25 credits = $0.125 per 5 s
  //    (kie's own page). Motion control: the kie-credit-per-second figures
  //    quoted at migration (3.0 std 9 / pro 12, 2.6 std 5 / pro 8) — to be
  //    confirmed against kie's price line, see task #101. Kling 3.0 Omni
  //    (kie O3) has no price read yet → deliberately absent → ledger "—".
  'Kling 2.5':                { perSecond: { flat: 0.042 } },
  'Kling 2.1':                { perSecond: { flat: 0.025 } },
  'Kling 3.0 Motion Control': { perSecond: { '720p': 0.045, '1080p': 0.06 } },
  'Kling Motion Control':     { perSecond: { '720p': 0.025, '1080p': 0.04 } },

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
  // ── conservative bases from creditPricing.js restored catalog (the "≤$X"
  //    figures the sale prices were derived from at 40% margin) ──
  'Sora 2':           { perVideo: { flat: 0.30 } },
  'Wan 2.6':          { perSecond: { flat: 0.076 } },
  'Grok Imagine':     { perSecond: { flat: 0.019 } },
  'Seedance 1.5 Pro': { perSecond: { '480p': 0.076, '720p': 0.133, '1080p': 0.247 } },
  'GPT-4o Image':     { perImage: { '1K': 0.05, '2K': 0.05, '4K': 0.05 } },
  'Midjourney':       { perImage: { '1K': 0.08, '2K': 0.08, '4K': 0.08 } }, // per task (4 images)
  'Flux Kontext Max': { perImage: { '1K': 0.08, '2K': 0.08, '4K': 0.08 } },
  'Flux 2':           { perImage: { '1K': 0.04, '2K': 0.04, '4K': 0.04 } },
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

// ─── Historical backfill ─────────────────────────────────────────────────────
// Ledger rows from before per-transaction KIE tracking (2026-07-26) carry
// only a label ("video: Kling 3.0") and the voxel amount — no resolution,
// duration, or audio flag. Two inference tricks recover a solid estimate:
//
//  • IMAGES — the voxel amount encodes the quality tier (Nano Banana Pro:
//    4 cr = 1K/2K → $0.09 → 18 kie cr; 8 cr = 4K → $0.12 → 24 kie cr), so
//    the mapping is nearly exact.
//  • VIDEO — voxel price and kie price are both ~proportional to
//    duration×resolution, and the 40%-margin formula makes their ratio a
//    per-model constant: kie_credits ≈ voxel_credits × (kieUSD/basisUSD) ×
//    (1−margin)×creditValue/0.005 ≈ voxel × 7.6 when kie IS the basis,
//    lower when FAL was the pricier supplier. Accurate to ~±10%.
//
// Only rows AFTER the model's FAL→kie switch date may be backfilled — a
// "Kling 3.0" generated on 2026-07-15 ran on FAL and cost us zero kie
// credits. Models with no confirmed kie price stay null.

const KIE_SWITCH_DATE = {
  'Kling 3.0': '2026-07-20', 'Kling 2.6': '2026-07-20',
  'Seedance 2.0': '2026-07-20', 'Seedance 2.0 Fast': '2026-07-20', 'Seedance 2.0 Mini': '2026-07-20',
  'Veo 3': '2026-07-20', 'Veo 3.1': '2026-07-20', 'Veo 3 Fast': '2026-07-20',
  'Nano Banana Pro': '2026-07-20',
  'Nano Banana 2': '2026-07-21', 'Flux Kontext': '2026-07-21', 'Seedream 4.5': '2026-07-21',
  'Seedream 5.0 Lite': '2026-07-21', 'GPT Image 1.5': '2026-07-21', 'GPT Image 2': '2026-07-21',
  // kie-only since the restored catalog (2026-07-21) — never ran on FAL here
  'Sora 2': '2026-07-21', 'Wan 2.6': '2026-07-21', 'Grok Imagine': '2026-07-21',
  'Seedance 1.5 Pro': '2026-07-21', 'GPT-4o Image': '2026-07-21', 'Midjourney': '2026-07-21',
  'Flux Kontext Max': '2026-07-21', 'Flux 2': '2026-07-21',
  // Kling family moved off FAL (owner, 2026-09-03)
  'Kling 2.5': '2026-09-03', 'Kling 2.1': '2026-09-03', 'Kling 3.0 Omni': '2026-09-03',
  'Kling 3.0 Motion Control': '2026-09-03', 'Kling Motion Control': '2026-09-03',
};

// amount (positive voxel credits) → kie credits, per image model
const IMAGE_BACKFILL = {
  'Nano Banana Pro':   (a) => (a >= 8 ? 24 : 18),
  'Nano Banana 2':     (a) => (a >= 8 ? 18 : 8),
  'GPT Image 2':       (a) => (a >= 11 ? 16 : a >= 6.5 ? 10 : 6),
  'GPT Image 1.5':     () => 34,
  'Flux Kontext':      () => 8,
  'Seedream 4.5':      (a) => (a >= 2 ? 12 : 6),
  'Seedream 5.0 Lite': () => 5.5,
  'GPT-4o Image':      () => 10,
  'Midjourney':        () => 16,
  'Flux Kontext Max':  () => 16,
  'Flux 2':            () => 8,
};

// voxel→kie multiplier per video model (kieUSD/basisUSD scaled by the
// margin formula; 7.6 = kie is the cost basis, lower = FAL was pricier)
const VIDEO_BACKFILL_MULTIPLIER = {
  'Kling 3.0': 7.0,
  'Kling 2.6': 7.4,
  'Seedance 2.0': 5.1,
  'Seedance 2.0 Fast': 5.2,
  'Seedance 2.0 Mini': 7.6,
  'Veo 3': 7.6,
  'Veo 3.1': 7.6,
  'Veo 3 Fast': 7.6,
  // kie-only models priced at exactly 40% margin → voxel×7.6 IS the basis
  'Sora 2': 7.5,
  'Wan 2.6': 7.6,
  'Grok Imagine': 7.6,
  'Seedance 1.5 Pro': 7.6,
};

/**
 * Estimate KIE credits for a PRE-TRACKING ledger row from its label +
 * voxel amount. Returns a number or null (FAL-backed, unlabeled, unpriced,
 * or generated before the model's kie switch date).
 */
export function backfillKieEstimate({ reason, amount, createdAt }) {
  const m = /^(image|video):\s*(.+)$/.exec(String(reason || '').trim());
  if (!m) return null;
  const model = m[2].trim();
  const voxel = Math.abs(Number(amount));
  if (!Number.isFinite(voxel) || voxel <= 0) return null;

  const switchDate = KIE_SWITCH_DATE[model];
  if (!switchDate || new Date(createdAt) < new Date(switchDate)) return null;

  if (m[1] === 'image') {
    const fn = IMAGE_BACKFILL[model];
    return fn ? fn(voxel) : null;
  }
  const mult = VIDEO_BACKFILL_MULTIPLIER[model];
  return mult ? Math.round(voxel * mult * 100) / 100 : null;
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
