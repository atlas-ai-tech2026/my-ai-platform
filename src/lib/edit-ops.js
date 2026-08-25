// ─── edit-ops.js ─────────────────────────────────────────────────────────────
// The tool layer: every editing operation, defined exactly once.
//
// ── WHY THIS FILE EXISTS BEFORE ANY UI ─────────────────────────────────────
// The owner's instinct on 2026-08-21 was to build the MCP server FIRST, because
// "this will be more easy to build the edit tab". The ORDER was wrong — someone
// who discovers VOXEL through MCP has no way to become a customer, since there
// is no checkout anywhere — but the ARCHITECTURAL instinct was exactly right,
// and this file is that instinct made real.
//
//   THREE SURFACES, ONE LAYER
//     Phase 1   edit tab buttons    drag a trim handle   → trim()
//     Phase 2   chat side panel     "make it 30 seconds" → trim()
//     Phase 3   MCP                 Claude calls voxel.trim
//
// Defined once here, MCP later is a WRAPPER rather than a rewrite. That only
// holds if operations are data — name, parameters, validation, cost — with
// EXECUTION left to whoever happens to be running them.
//
// ── WHY EXECUTION IS DELIBERATELY NOT IN THIS FILE ─────────────────────────
// Phase 1 runs ffmpeg in the BROWSER (ffmpeg.wasm). Verified 2026-08-21 against
// DigitalOcean's own docs: their Node buildpack has NO ffmpeg, and production is
// 2 × apps-s-1vcpu-1gb — so a server-side render would compete with Express for
// the single vCPU and slow the live site for everyone, to prove a feature nobody
// has asked for yet. Phase 2 moves the same operations to a dedicated worker.
//
// Both implement this contract. NEITHER changes it. That is the whole point:
// this file is what makes the browser→worker move a swap instead of a rewrite.
//
// ── THE LINE THAT DECIDES EVERYTHING ───────────────────────────────────────
// Settled with the owner across 2026-08-20/21, and it turned out to answer two
// separate questions with one rule:
//
//     Is an AI making something NEW, or are you ARRANGING what you already have?
//
//   ARRANGING  → free, and a TOOL (drag, click, handle). No model is involved,
//                so routing it through language would only add latency and
//                ambiguity. Language is bad at coordinates: "cut until he starts
//                talking" takes three guesses; dragging the handle takes one
//                second.
//   MAKING     → costs credits, and a PROMPT or BUTTON. Generative work is
//                genuinely hard to do and easy to say, so description really is
//                the fastest input.
//
// That the same rule sets both the price AND the interface is not a coincidence.
// It is the same underlying fact asked twice.
//
// ── ONE CREDIT POOL ────────────────────────────────────────────────────────
// Editing deducts from the SAME plan credits as generation. There is no separate
// edit plan. The owner proposed this and was right: a separate plan forces the
// customer to guess their editing volume before they have edited anything,
// doubles the lines on a B2B invoice, and would need a THIRD pricing answer the
// moment MCP exists.

/**
 * How an operation is paid for.
 *
 * FREE is not "we are being generous" — it is a statement of fact about cost.
 * These operations never leave your own infrastructure, so there is no supplier
 * invoice behind them and nothing to recover per use.
 */
export const FREE = 'free';
export const METERED = 'metered';

/**
 * ── EXPORT IS FREE, AND THAT WAS A REVERSAL ────────────────────────────────
 * I first proposed a small credit charge on final export to stop somebody
 * rendering 4K for eight hours, then withdrew it — the abuse argument is real
 * but it is the weaker one.
 *
 * Free editing makes every GENERATION credit worth more. If one generated clip
 * can freely become a reel AND a post AND a story, a single credit buys three
 * usable assets, which makes customers more willing to spend credits generating.
 * Charging for the repurposing taxes precisely the behaviour that makes a plan
 * feel worth renewing.
 *
 * And a charge at export is the worst possible placement: the customer does all
 * the work, then hits a paywall to get their own file out. That is the moment
 * they cancel.
 *
 * The render machine is protected by LIMITS instead (see PLAN_LIMITS), which are
 * also the natural reason to move from Micro to Max.
 */

/**
 * Every operation the editor can perform.
 *
 * `billing` is the single source of truth for both the price AND whether the UI
 * shows it as a direct-manipulation tool or as a prompt/button with a credit
 * badge. One field, because they are one decision.
 */
export const OPERATIONS = {
  // ── ARRANGING — free, tools ────────────────────────────────────────────
  trim: {
    billing: FREE,
    label: 'Trim',
    params: { start: 'seconds', end: 'seconds' },
    summary: 'Cut a clip down to the part you want.',
  },
  concat: {
    billing: FREE,
    label: 'Join',
    params: { clips: 'clip[]' },
    summary: 'Join several clips into one, in order.',
  },
  resize: {
    billing: FREE,
    label: 'Resize',
    params: { ratio: 'ratio', mode: 'crop|pad' },
    // The owner's own example: one generated video, exported for Reels, for a
    // square post, and for YouTube. Three formats, no model, no charge.
    summary: 'Change the shape for a platform — Reels, post, YouTube.',
  },
  overlay: {
    billing: FREE,
    label: 'Watermark',
    params: { image: 'asset', position: 'corner', opacity: 'fraction' },
    summary: 'Put a logo or watermark on the video.',
  },
  addText: {
    billing: FREE,
    label: 'Text',
    params: { text: 'string', start: 'seconds', end: 'seconds', style: 'style' },
    summary: 'Add a title, caption or subtitle.',
  },
  mixAudio: {
    // ── THE MOST CONFUSABLE POINT IN THE WHOLE PRODUCT ───────────────────
    // "ADD music" and "MAKE music" are different operations with different
    // prices, and a customer will absolutely read them as the same thing.
    // Dropping in a track you already have is ffmpeg mixing two audio
    // streams: no model, no supplier, no charge. Asking an AI to compose one
    // is a real call to FAL. Same for voice.
    //
    // They are separate entries here so they can never accidentally share a
    // price, and the UI must keep them visibly apart.
    billing: FREE,
    label: 'Add audio',
    params: { audio: 'asset', gain: 'db', start: 'seconds' },
    summary: 'Add music or a voice track you already have.',
  },
  volume: {
    billing: FREE,
    label: 'Volume',
    params: { gain: 'db', fadeIn: 'seconds', fadeOut: 'seconds' },
    summary: 'Adjust loudness, fade in or out.',
  },
  speed: {
    billing: FREE,
    label: 'Speed',
    params: { rate: 'multiplier' },
    summary: 'Speed up or slow down.',
  },

  // ── MAKING — costs credits, prompts and buttons ────────────────────────
  generateMusic: {
    billing: METERED,
    label: 'Make music',
    kind: 'audio',
    params: { prompt: 'string', duration: 'seconds' },
    summary: 'Compose a new track from a description.',
  },
  generateVoice: {
    billing: METERED,
    label: 'Make voice-over',
    kind: 'audio',
    params: { text: 'string', voice: 'voiceId' },
    summary: 'Speak your script in a chosen voice.',
  },
  removeBackground: {
    billing: METERED,
    label: 'Remove background',
    kind: 'image',
    params: { clip: 'asset' },
    summary: 'Cut the subject out of the background.',
  },
  upscale: {
    billing: METERED,
    label: 'Upscale',
    kind: 'image',
    params: { clip: 'asset', factor: 'multiplier' },
    summary: 'Increase resolution.',
  },
  omniEdit: {
    billing: METERED,
    label: 'AI edit',
    kind: 'video',
    params: { clip: 'asset', prompt: 'string' },
    summary: 'Change what is inside the frame — "remove the car", "make it night".',
  },
  generativeResize: {
    // ── THE SECOND TRAP ──────────────────────────────────────────────────
    // Reshaping 16:9 → 9:16 by CROPPING is free ffmpeg. Asking a model to
    // PAINT IN the empty space instead of cropping is a generation, and costs.
    // Both are "change the size" to a customer, so they must be two visibly
    // different buttons rather than a checkbox inside one.
    billing: METERED,
    kind: 'video',
    label: 'Smart resize',
    params: { clip: 'asset', ratio: 'ratio' },
    summary: 'Reshape by filling in the new space with AI instead of cropping.',
  },
};

/** Platform shapes, so nobody has to remember which number Reels wants. */
export const RATIOS = {
  '9:16': { w: 9, h: 16, label: 'Reels · TikTok · Shorts' },
  '1:1': { w: 1, h: 1, label: 'Square post' },
  '4:5': { w: 4, h: 5, label: 'Instagram feed' },
  '16:9': { w: 16, h: 9, label: 'YouTube · landscape' },
};

/**
 * How a resize handles the mismatch.
 *
 * `crop` fills the frame and loses the edges. `pad` keeps everything and adds
 * bars. Crop is the default because a padded vertical video is mostly bars, and
 * a customer choosing "Reels" wants it to look like a reel.
 */
export const RESIZE_MODES = ['crop', 'pad'];

export const isFree = (name) => OPERATIONS[name]?.billing === FREE;
export const isMetered = (name) => OPERATIONS[name]?.billing === METERED;

/** Every free operation — what the UI renders as direct-manipulation tools. */
export const freeOperations = () => Object.keys(OPERATIONS).filter(isFree);

/** Every metered one — what the UI renders with a credit badge. */
export const meteredOperations = () => Object.keys(OPERATIONS).filter(isMetered);

/**
 * What one operation costs, in VOXEL credits.
 *
 * Free operations return 0 WITHOUT consulting pricing at all — they must never
 * become chargeable by accident because a pricing table grew an entry with a
 * matching name. That is the guarantee this whole design rests on, so it is
 * enforced here rather than trusted to call sites.
 *
 * Metered operations look their price up in the pricing table that is passed in.
 * Nothing is hardcoded and nothing is guessed: an unknown price returns null,
 * meaning "ask before charging", never 0. A missing price that silently reads as
 * free would give work away; one that silently reads as some default would
 * overcharge. Both are worse than refusing to answer.
 */
export function creditCost(op, pricing = {}) {
  const name = typeof op === 'string' ? op : op?.op;
  const spec = OPERATIONS[name];
  if (!spec) return null;
  if (spec.billing === FREE) return 0;

  const price = pricing[name];
  return Number.isFinite(price) && price >= 0 ? price : null;
}

/**
 * What a whole edit plan costs before the customer commits to it.
 *
 * Returns the total, the priced lines, and — separately — anything whose price
 * could not be resolved. Unknown prices are NOT folded into the total, because a
 * total that quietly omits a line is a number the customer would be right to
 * dispute later.
 */
export function planCost(ops = [], pricing = {}) {
  const lines = [];
  const unknown = [];
  let total = 0;

  for (const op of ops) {
    const name = typeof op === 'string' ? op : op?.op;
    const cost = creditCost(op, pricing);
    if (cost === null) {
      unknown.push(name);
      continue;
    }
    lines.push({ op: name, credits: cost, billing: OPERATIONS[name].billing });
    total += cost;
  }

  return {
    credits: Math.round(total * 1000) / 1000,
    lines,
    unknown,
    // The UI leads with this: most plans are entirely free, and saying so is
    // more reassuring than showing "0 credits" next to a long list.
    allFree: unknown.length === 0 && lines.every((l) => l.billing === FREE),
  };
}

/**
 * Reject a bad operation BEFORE it reaches ffmpeg.
 *
 * ffmpeg's own errors are unreadable to a customer — a bad trim range surfaces
 * as a codec complaint about a filter graph. Since the platform's standing rule
 * is that no failure may arrive as a generic message, the parameters are checked
 * here, in the one place all three surfaces share, so the browser, the worker
 * and MCP cannot disagree about what is valid.
 */
export function validate(op) {
  const name = typeof op === 'string' ? op : op?.op;
  const spec = OPERATIONS[name];
  if (!spec) return [`Unknown operation: ${name ?? '(none)'}`];

  const errors = [];
  const p = op || {};

  switch (name) {
    case 'trim': {
      const { start, end } = p;
      if (!Number.isFinite(start) || start < 0) errors.push('Start must be 0 or more.');
      if (!Number.isFinite(end) || end <= 0) errors.push('End must be more than 0.');
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        errors.push('End must come after start.');
      }
      break;
    }
    case 'concat':
      if (!Array.isArray(p.clips) || p.clips.length < 2) {
        errors.push('Joining needs at least two clips.');
      }
      break;
    case 'resize':
      if (!RATIOS[p.ratio]) {
        errors.push(`Unknown shape: ${p.ratio}. Use ${Object.keys(RATIOS).join(', ')}.`);
      }
      if (p.mode && !RESIZE_MODES.includes(p.mode)) {
        errors.push(`Resize mode must be ${RESIZE_MODES.join(' or ')}.`);
      }
      break;
    case 'generativeResize':
      if (!RATIOS[p.ratio]) {
        errors.push(`Unknown shape: ${p.ratio}. Use ${Object.keys(RATIOS).join(', ')}.`);
      }
      break;
    case 'speed':
      // Beyond this range audio becomes unusable and ffmpeg needs chained
      // filters. Refused with a readable reason rather than produced badly.
      if (!Number.isFinite(p.rate) || p.rate < 0.25 || p.rate > 4) {
        errors.push('Speed must be between 0.25× and 4×.');
      }
      break;
    case 'overlay':
      if (!p.image) errors.push('Choose a logo or watermark image.');
      if (p.opacity != null && (!Number.isFinite(p.opacity) || p.opacity < 0 || p.opacity > 1)) {
        errors.push('Opacity must be between 0 and 1.');
      }
      break;
    case 'addText':
      if (!String(p.text || '').trim()) errors.push('Type the text to show.');
      break;
    case 'mixAudio':
      if (!p.audio) errors.push('Choose an audio track.');
      break;
    case 'generateMusic':
      if (!String(p.prompt || '').trim()) errors.push('Describe the music you want.');
      break;
    case 'generateVoice':
      if (!String(p.text || '').trim()) errors.push('Type what the voice should say.');
      break;
    case 'omniEdit':
      if (!String(p.prompt || '').trim()) errors.push('Describe the change you want.');
      break;
    default:
      break;
  }

  return errors;
}

/** Validate a whole plan, keeping each error attached to its step. */
export function validatePlan(ops = []) {
  return ops
    .map((op, index) => ({ index, op: typeof op === 'string' ? op : op?.op, errors: validate(op) }))
    .filter((r) => r.errors.length > 0);
}

/**
 * ── LIMITS INSTEAD OF A RENDER COUNTER ─────────────────────────────────────
 * The render machine is a FIXED monthly cost: one render or ten thousand, the
 * bill is identical. So counting renders recovers nothing — it only makes people
 * iterate less, which makes the product worse for the same money.
 *
 * These caps protect the machine from the one thing that actually hurts it (a
 * single customer rendering 4K for hours) while leaving normal use untouched.
 * They double as the honest reason to move from Micro to Max.
 *
 * Phase 1 runs in the browser, so only the shape of these matters now; they bite
 * for real when the Phase 2 worker exists.
 */
export const PLAN_LIMITS = {
  micro: { maxDurationSec: 60, maxHeight: 1080, savedProjects: 3, concurrentRenders: 1 },
  starter: { maxDurationSec: 120, maxHeight: 1080, savedProjects: 5, concurrentRenders: 1 },
  basic: { maxDurationSec: 300, maxHeight: 1080, savedProjects: 20, concurrentRenders: 1 },
  plus: { maxDurationSec: 600, maxHeight: 1440, savedProjects: 50, concurrentRenders: 2 },
  pro: { maxDurationSec: 900, maxHeight: 2160, savedProjects: 200, concurrentRenders: 2 },
  max: { maxDurationSec: 900, maxHeight: 2160, savedProjects: Infinity, concurrentRenders: 2 },
};

/**
 * Is this project within the plan's limits?
 *
 * Says which limit was hit and what the plan allows, because "too long" without
 * a number is a dead end for the person reading it.
 */
export function checkLimits({ plan = 'micro', durationSec = 0, height = 1080 }) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.micro;
  const problems = [];

  if (durationSec > limits.maxDurationSec) {
    problems.push({
      limit: 'duration',
      allowed: limits.maxDurationSec,
      actual: Math.round(durationSec),
      message: `Your plan allows projects up to ${limits.maxDurationSec}s — this one is ${Math.round(durationSec)}s.`,
    });
  }
  if (height > limits.maxHeight) {
    problems.push({
      limit: 'resolution',
      allowed: limits.maxHeight,
      actual: height,
      message: `Your plan exports up to ${limits.maxHeight}p — this project is ${height}p.`,
    });
  }

  return { ok: problems.length === 0, problems, limits };
}
