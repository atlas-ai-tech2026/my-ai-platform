// ─── costing-sync.js ─────────────────────────────────────────────────────────
// Keeps the Costing table in step with the models the platform can actually
// charge for.
//
// TWO JOBS, ONE FUNCTION:
//   1. Seed the models that exist in production but were not in the costing
//      workbook — added WITHOUT supplier costs, flagged so the screen can show
//      them in their own colour until the owner fills the numbers in.
//   2. Run daily to catch models added later. A model that ships without ever
//      reaching this table is one nobody is checking the margin on, and the
//      failure is silent — which is exactly why this runs on a schedule rather
//      than relying on someone remembering.
//
// Category and unit are DERIVED, never guessed: video entries in pricing.js
// carry an explicit `type` of 'per-sec' or 'per-gen', which maps exactly onto
// the brief's video_sec / video_clip split.

import { IMAGE_CREDITS, VIDEO_CREDITS, VOICE_CREDITS_PER_1K } from './pricing.js';
import { LIVE_ID_TO_COSTING_MODEL } from './costing-coverage.js';

/** A readable name for a model id we only know by its slug. */
function titleise(id) {
  return String(id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();
}

/** The credit value production charges today, used as the starting point so
 *  the row shows the real current price rather than a blank. */
function representativeCredits(id) {
  if (id in IMAGE_CREDITS) {
    const byRes = IMAGE_CREDITS[id];
    return byRes['1K'] ?? byRes.Draft ?? Object.values(byRes)[0] ?? null;
  }
  if (id in VOICE_CREDITS_PER_1K) return VOICE_CREDITS_PER_1K[id];
  const v = VIDEO_CREDITS[id];
  if (!v) return null;
  if (v.type === 'per-sec') {
    const res = v.byRes?.[v.defaultRes] ?? Object.values(v.byRes || {})[0];
    if (res == null) return null;
    return typeof res === 'number' ? res : (res.off ?? res.on ?? null);
  }
  if (v.type === 'per-gen') {
    const byDur = v.byResDuration?.[v.defaultRes] ?? Object.values(v.byResDuration || {})[0];
    if (!byDur) return null;
    const shortest = Math.min(...Object.keys(byDur).map(Number));
    return byDur[shortest] ?? null;
  }
  // 'flat' — one fixed price for the whole clip regardless of length.
  if (v.type === 'flat') {
    return v.byRes?.[v.defaultRes] ?? Object.values(v.byRes || {})[0] ?? null;
  }
  return null;
}

/** Category + unit, derived from which table the model lives in and its type. */
function classify(id) {
  if (id in IMAGE_CREDITS) return { category: 'image', unit: 'image' };
  if (id in VOICE_CREDITS_PER_1K) return { category: 'voice', unit: '1,000 chars' };
  const v = VIDEO_CREDITS[id];
  if (v?.type === 'per-sec') return { category: 'video_sec', unit: 'second' };
  // Both 'per-gen' and 'flat' bill for a whole clip rather than per second —
  // the brief's video_clip category. Only the price CURVE differs, and that
  // does not change the unit the margin is calculated against.
  if (v?.type === 'per-gen' || v?.type === 'flat') return { category: 'video_clip', unit: 'video' };
  // Genuinely unrecognised shape — say so rather than guessing a unit, which
  // would make the margin arithmetic silently wrong.
  return { category: 'video_clip', unit: 'unknown' };
}

export function liveModelIds() {
  return [
    ...Object.keys(IMAGE_CREDITS),
    ...Object.keys(VIDEO_CREDITS),
    ...Object.keys(VOICE_CREDITS_PER_1K),
  ];
}

/**
 * Row descriptors for every production model that has no costing row yet.
 * `known` marks the ones the workbook already covers under a different name,
 * so they are not duplicated.
 */
export function uncostedRows(existingNames = new Set()) {
  const rows = [];
  let order = 1000;   // after the 50 seeded rows
  for (const id of liveModelIds()) {
    const mapped = LIVE_ID_TO_COSTING_MODEL[id];
    if (mapped) continue;                       // already costed under its proper name
    if (existingNames.has(id)) continue;        // already added by a previous sync
    const { category, unit } = classify(id);
    rows.push({
      category,
      model_name: id,                            // the production id, so it is unambiguous
      variant: titleise(id),
      resolution: null,
      unit,
      kie_cost: null,                            // ← the whole point: cost UNKNOWN
      fal_cost: null,
      credits_override: representativeCredits(id),
      sort_order: order++,
      needs_cost: true,
    });
  }
  return rows;
}

/**
 * Insert any missing models. Returns what it added so a caller can log or
 * surface it. Insert-only — never touches a row that already exists, so an
 * owner-entered cost is safe from every future run.
 */
export async function syncCostingModels(pool, { changedBy = 'model_sync' } = {}) {
  const { rows: existing } = await pool.query('SELECT model_name FROM pricing_models');
  const have = new Set(existing.map((r) => r.model_name));
  const toAdd = uncostedRows(have);

  for (const r of toAdd) {
    await pool.query(
      `INSERT INTO pricing_models
         (category, model_name, variant, resolution, unit, kie_cost, fal_cost,
          credits_override, sort_order, updated_by)
       VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,$7,$8)
       ON CONFLICT (model_name, COALESCE(variant,''), COALESCE(resolution,'')) DO NOTHING`,
      [r.category, r.model_name, r.variant, r.resolution, r.unit,
       r.credits_override, r.sort_order, changedBy]
    );
    await pool.query(
      `INSERT INTO pricing_audit_log (entity, field, new_value, changed_by, note)
       VALUES ('model', 'added', $1, $2, 'found in production with no cost recorded')`,
      [r.model_name, changedBy]
    ).catch(() => {});
  }
  return toAdd.map((r) => r.model_name);
}

/** Daily check. Adds anything new and logs plainly; the CRM shows the result. */
export async function runDailyModelSync(pool, dbReady) {
  if (!dbReady()) return { added: [] };
  try {
    const added = await syncCostingModels(pool);
    if (added.length) {
      console.warn(`[costing-sync] ${added.length} model(s) are charged in production with no cost recorded: ${added.join(', ')}`);
    } else {
      console.log('[costing-sync] every production model has a costing row');
    }
    return { added };
  } catch (e) {
    console.error('[costing-sync] failed:', e.message);
    return { added: [], error: e.message };
  }
}
