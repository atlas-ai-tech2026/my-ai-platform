// ─── fal-pricing.js ──────────────────────────────────────────────────────────
// What each generation costs US at fal.ai, in USD — the FAL twin of
// kie-pricing.js, so the admin Logs/Usage pages show all three meters:
// voxel credits (user), KIE credits (kie.ai balance), FAL cost $ (fal bill).
//
// Source: Voxel_Plans_and_Credits.xlsx → "Model Credits" (fal cost column,
// USD, read 2026-07-26). FAL is postpaid USD — there are no "FAL credits"
// and no balance API, so this is dollars, and estimates only. Models absent
// from the workbook (Soul 2.0, Kling 2.5/2.1/Omni, Wan 2.2, LTX, music,
// motion control, …) yield null → the UI shows "—". Extend the table as
// invoice data accumulates.

// Keyed by app model label. Same unit shapes as kie-pricing:
//   { perImage: {'1K':usd,'2K':usd,'4K':usd} }
//   { perSecond: {'480p':usd,...} }  (video, ×duration; audio tiers allowed)
//   { per1kChars: usd }              (TTS)
const FAL_USD = {
  // ── images (per image) ──
  'Nano Banana Pro':   { perImage: { '1K': 0.15, '2K': 0.15, '4K': 0.30 } },
  'Nano Banana 2':     { perImage: { '1K': 0.15, '2K': 0.15, '4K': 0.30 } },
  'GPT Image 2':       { perImage: { '1K': 0.219, '2K': 0.234, '4K': 0.413 } },
  'Seedream 5.0 Lite': { perImage: { '1K': 0.035, '2K': 0.035, '4K': 0.035 } },
  'Imagen 4':          { perImage: { '1K': 0.05, '2K': 0.05, '4K': 0.06 } },

  // ── video, per second ──
  'Seedance 2.0':      { perSecond: { '480p': 0.1406, '720p': 0.3024, '1080p': 0.6804, '4K': 1.56 } },
  'Seedance 2.0 Fast': { perSecond: { '480p': 0.1125, '720p': 0.2419 } },
  'Kling 3.0': {
    perSecond: { audio: { '1080p': 0.112 }, noAudio: { '1080p': 0.084 } },
  },

  // ── conservative bases from creditPricing.js restored catalog (the "≤$X"
  //    figures the 40%-margin sale prices were derived from) ──
  'Kling 3.0 Omni':    { perSecond: { flat: 0.152 } },
  'Kling 2.5':         { perSecond: { flat: 0.0456 } },
  'Kling 2.1':         { perSecond: { flat: 0.057 } },
  'Kling O1 Video Edit': { perVideo: { flat: 0.38 } },
  'Hailuo 2.3':        { perVideo: { flat: 0.285 } },
  'Seedance 1':        { perSecond: { flat: 0.057 } },
  'LTX 2':             { perSecond: { flat: 0.076 } },
  'Vidu':              { perVideo: { flat: 0.42 } },
  'PixVerse 5':        { perSecond: { flat: 0.038 } },
  'Wan 2.2':           { perSecond: { flat: 0.057 } },
  'Soul 2.0':          { perImage: { '1K': 0.025, '2K': 0.025, '4K': 0.025 } },
  'Wan 2.2 Image':     { perImage: { '1K': 0.05, '2K': 0.05, '4K': 0.05 } },
  'Skin Enhancer':     { perImage: { '1K': 0.05, '2K': 0.05, '4K': 0.05 } },
  'Face Swap':         { perImage: { '1K': 0.04, '2K': 0.04, '4K': 0.04 } },
  'Relight':           { perImage: { '1K': 0.04, '2K': 0.04, '4K': 0.04 } },
  // Motion Control panels (sheet voxel prices × the 0.038 margin share)
  'Kling 3.0 Motion Control': { perVideo: { '720p': 0.266, '1080p': 0.38 } },
  'Kling Motion Control':     { perVideo: { '720p': 0.19, '1080p': 0.266 } },

  // ── audio (per 1,000 characters, ElevenLabs via FAL) ──
  'TTS': { per1kChars: 0.1 },
};

const RES_ORDER = ['480p', '720p', '1080p', '4K'];
const round4 = (v) => Math.round(v * 10000) / 10000;

function normalizeRes(resolution) {
  const r = String(resolution || '').toLowerCase();
  if (r.includes('4k')) return '4K';
  if (r.includes('1080')) return '1080p';
  if (r.includes('720')) return '720p';
  if (r.includes('480')) return '480p';
  return '1080p';
}

function normalizeQuality(quality) {
  const q = String(quality || '').toUpperCase();
  if (q.includes('4K')) return '4K';
  if (q.includes('2K')) return '2K';
  return '1K';
}

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

/**
 * Estimated FAL cost (USD) of a generation. `chars` applies to TTS.
 * Returns a number (4dp) or null when the model has no fal price on file.
 */
export function estimateFalCost({ kind, model, resolution, duration, audio, quality, chars } = {}) {
  const entry = FAL_USD[model];
  if (!entry) return null;

  if (entry.perImage) {
    const usd = entry.perImage[normalizeQuality(quality || resolution)];
    return usd == null ? null : round4(usd);
  }
  if (entry.per1kChars) {
    const n = Math.max(1, Number(chars) || 1000);
    return round4(entry.per1kChars * (n / 1000));
  }
  const table = entry.perSecond || entry.perVideo;
  const tiered = table.audio || table.noAudio ? (audio ? table.audio : table.noAudio) : table;
  const usd = pickRes(tiered, resolution);
  if (usd == null) return null;
  if (entry.perSecond) {
    const secs = Math.max(1, parseInt(duration, 10) || 5);
    return round4(usd * secs);
  }
  return round4(usd);
}

// ─── Historical backfill ─────────────────────────────────────────────────────
// Mirror of kie-pricing's backfill, for the FAL side of history. A labeled
// row is FAL-era when the model either never moved to kie, or the row
// predates the model's FAL→kie switch date — the exact complement of the
// kie backfill, so no row ever gets both estimates.

// FAL→kie switch dates (same values as kie-pricing.KIE_SWITCH_DATE).
// Models NOT listed here are FAL-backed for their whole history.
const KIE_SWITCH_DATE = {
  'Kling 3.0': '2026-07-20', 'Kling 2.6': '2026-07-20',
  'Seedance 2.0': '2026-07-20', 'Seedance 2.0 Fast': '2026-07-20', 'Seedance 2.0 Mini': '2026-07-20',
  'Veo 3': '2026-07-20', 'Veo 3.1': '2026-07-20', 'Veo 3 Fast': '2026-07-20',
  'Nano Banana Pro': '2026-07-20',
  'Nano Banana 2': '2026-07-21', 'Flux Kontext': '2026-07-21', 'Seedream 4.5': '2026-07-21',
  'Seedream 5.0 Lite': '2026-07-21', 'GPT Image 1.5': '2026-07-21', 'GPT Image 2': '2026-07-21',
  // kie-only since the restored catalog — FAL never billed these here
  'Sora 2': '2026-07-21', 'Wan 2.6': '2026-07-21', 'Grok Imagine': '2026-07-21',
  'Seedance 1.5 Pro': '2026-07-21', 'GPT-4o Image': '2026-07-21', 'Midjourney': '2026-07-21',
  'Flux Kontext Max': '2026-07-21', 'Flux 2': '2026-07-21',
};

// amount (positive voxel credits) → FAL USD, per image model — the voxel
// amount encodes the quality tier exactly like the kie backfill.
const IMAGE_BACKFILL = {
  'Nano Banana Pro':   (a) => (a >= 8 ? 0.30 : 0.15),
  'Nano Banana 2':     (a) => (a >= 8 ? 0.30 : 0.15),
  'GPT Image 2':       (a) => (a >= 11 ? 0.413 : a >= 6.5 ? 0.234 : 0.219),
  'Seedream 5.0 Lite': () => 0.035,
  'Soul 2.0':          () => 0.025,
  'Wan 2.2 Image':     () => 0.05,
  'Skin Enhancer':     () => 0.05,
  'Face Swap':         () => 0.04,
  'Relight':           () => 0.04,
};

// voxel→FAL-USD multiplier per video model: voxel credits × creditValue ×
// (1−margin) × (falUSD/basisUSD). For FAL-only models fal IS the basis →
// voxel × 0.038 (the DEFAULT below); overrides where the documented basis
// sits below the 40%-margin ceiling (ceiling rounding inflated the credits).
const FAL_DEFAULT_MULTIPLIER = 0.038;
const VIDEO_BACKFILL_MULTIPLIER = {
  'Kling 3.0': 0.032,
  'Kling 2.1': 0.0285,
  'Seedance 1': 0.0285,
};

/**
 * Estimate FAL cost (USD) for a PRE-TRACKING ledger row. Returns a number
 * or null (kie-era row, unlabeled, or no fal price on file).
 */
export function backfillFalEstimate({ reason, amount, createdAt }) {
  // node runs were always FAL-billed; their labels are "node: X" /
  // "node video: X" and take the video fallback path.
  const m = /^(image|video|audio|node video|node):\s*(.+)$/.exec(String(reason || '').trim());
  if (!m) return null;
  const model = m[2].trim();
  const voxel = Math.abs(Number(amount));
  if (!Number.isFinite(voxel) || voxel <= 0) return null;

  // kie-era rows belong to the kie backfill, not this one.
  const switchDate = KIE_SWITCH_DATE[model];
  if (switchDate && new Date(createdAt) >= new Date(switchDate)) return null;

  if (m[1] === 'audio') {
    // 'audio: TTS' rows are flat 1 voxel credit with no char count recorded;
    // assume a typical full take (~1,000 chars → $0.10). Other audio spends
    // (Music) fall back to the margin share of the voxel price.
    return model === 'TTS' ? 0.1 : round4(voxel * FAL_DEFAULT_MULTIPLIER);
  }
  if (m[1] === 'image') {
    const fn = IMAGE_BACKFILL[model];
    // Unknown FAL image models: margin share of the voxel price.
    return round4(fn ? fn(voxel) : voxel * FAL_DEFAULT_MULTIPLIER);
  }
  // Video (incl. Edit / Motion Control / node labels): per-model override or
  // the universal 40%-margin share. Every non-kie label here was FAL-billed.
  const mult = VIDEO_BACKFILL_MULTIPLIER[model] ?? FAL_DEFAULT_MULTIPLIER;
  return round4(voxel * mult);
}
