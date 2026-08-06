// ─── costing-coverage.js ─────────────────────────────────────────────────────
// Which models the Costing calculator actually covers, and which it does not.
//
// WHY THIS EXISTS. Production charges 52 models through server/src/pricing.js.
// The costing brief seeds 50 ROWS covering only 20 of them (its rows are per
// resolution, so 50 rows is far fewer than 50 models). Without this module the
// Costing screen would look like the whole picture while a majority of the
// catalogue sat outside it — and the gap would be discovered the first time
// someone re-priced from a table that never mentioned Sora, Midjourney or the
// Kling Motion Control family.
//
// The mapping below is deliberately EXPLICIT rather than fuzzy string matching.
// A near-miss here would silently claim coverage the calculator does not have,
// which is worse than reporting the gap honestly.

import { IMAGE_CREDITS, VIDEO_CREDITS, VOICE_CREDITS_PER_1K } from './pricing.js';

/**
 * Production model id → the model_name used in the costing seed.
 * Only ids listed here are considered costed. Anything else is reported as a
 * gap, which is the safe direction to be wrong in.
 */
export const LIVE_ID_TO_COSTING_MODEL = {
  'nano-pro':          'Nano Banana Pro',
  'nano-2':            'Nano Banana 2',
  'gpt-image-2':       'GPT Image 2',
  'seedream-5-lite':   'Seedream 5.0 Lite',
  'seedream-5-pro':    'Seedream 5 Pro',
  'imagen-4-fast':     'Imagen 4',
  'imagen-4':          'Imagen 4',
  'imagen-4-ultra':    'Imagen 4',
  'kling-3':           'Kling 3.0',
  'kling-3-turbo':     'Kling 3.0 Turbo',
  'gemini-omni':       'Gemini Omni',
  'kling-2-6':         'Kling 2.6',
  'kling-2-5':         'Kling 2.5 Turbo Pro',
  'seedance-2':        'Seedance 2.0',
  'seedance-2-fast':   'Seedance 2.0 Fast',
  'seedance-2-mini':   'Seedance 2.0 Mini',
  'veo-3-1':           'Veo 3.1',
  'multilingual-v2':   'ElevenLabs TTS',
  'turbo-v2-5':        'ElevenLabs TTS',
  'eleven-v3':         'ElevenLabs V3',
};

/** Every model id production can currently charge for. */
export function liveModelIds() {
  return [
    ...Object.keys(IMAGE_CREDITS),
    ...Object.keys(VIDEO_CREDITS),
    ...Object.keys(VOICE_CREDITS_PER_1K),
  ];
}

/**
 * The coverage picture, for the CRM to display plainly.
 *
 * `uncosted` are models customers can be charged for today whose supplier cost
 * the calculator does not know — so their margin is genuinely unknown here,
 * not zero and not fine. They are listed, never hidden.
 */
export function coverageReport(seed = null) {
  const live = liveModelIds();
  const costed = [];
  const uncosted = [];
  for (const id of live) {
    (LIVE_ID_TO_COSTING_MODEL[id] ? costed : uncosted).push(id);
  }
  return {
    live_total: live.length,
    costed_total: costed.length,
    uncosted_total: uncosted.length,
    costed,
    uncosted,
    seed_rows: seed ? seed.length : null,
    note: uncosted.length
      ? `${uncosted.length} models are charged in production but have no supplier cost recorded here — their margin is unknown, not verified.`
      : 'Every model production charges for has a cost recorded.',
  };
}
