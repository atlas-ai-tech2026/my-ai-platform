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
import { fetchFalCatalog, newModelFamilies } from './fal-catalog.js';
import { proposeChange, describe as describeChange } from './price-watch.js';
import { fetchKieCatalog } from './kie-catalog.js';

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

// ─── provider catalogue discovery ────────────────────────────────────────────
//
// The job above answers "what do we sell that has no cost?". This one answers
// "what does the provider sell that we don't?" — the owner's onboarding queue.
//
// Matching is by NAME, normalised. There is no shared identifier between fal's
// catalogue and our model labels, so this cannot be exact: a model we already
// sell under a different name can surface as "new". That is why rows are
// dismissable — a false positive costs one click, whereas dropping a real new
// model would be invisible. Erring toward showing is the safe direction.

/**
 * Compare names ignoring case, spacing, punctuation and — importantly —
 * version FORMAT. Providers and our own catalogue disagree constantly about
 * the same product: fal says "Seedream 5.0 Pro" where we say "Seedream 5 Pro",
 * and "Kling v3 Turbo" where we say "Kling 3.0 Turbo". Without folding these,
 * models we already sell surface as new, and a queue full of things the owner
 * already has is a queue they stop reading.
 */
export function normaliseName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bv(\d)/g, '$1')      // "v3"   → "3"
    .replace(/(\d)\.0(?!\d)/g, '$1') // "5.0"  → "5"
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Names we already sell — the costing table's model_name column plus the
 * human labels for id-style rows, so both "kling-3" and "Kling 3.0" match.
 */
export function knownNameSet(costingModelNames = []) {
  const set = new Set();
  for (const n of costingModelNames) {
    set.add(normaliseName(n));
    set.add(normaliseName(titleise(n)));
  }
  for (const label of Object.values(LIVE_ID_TO_COSTING_MODEL)) set.add(normaliseName(label));
  return set;
}

/** True when a catalogue family is something we already offer. */
export function alreadySold(family, known) {
  const n = normaliseName(family);
  if (!n) return true;                       // unnameable → do not surface
  if (known.has(n)) return true;
  // "Kling v3 Turbo" vs "Kling 3.0 Turbo": treat one as known if either
  // contains the other, which catches version-format differences without the
  // false matches a looser fuzzy test would produce.
  for (const k of known) {
    if (k.length < 6) continue;
    const [longer, shorter] = n.length >= k.length ? [n, k] : [k, n];
    if (!longer.startsWith(shorter) && !longer.includes(shorter)) continue;
    // A bare substring match treats a DIFFERENT VERSION as the same model:
    // "Seedance 2.0" normalises to "seedance2", which is a prefix of
    // "seedance25", so Seedance 2.5 was hidden as already-sold. That is the
    // exact model the owner was looking for and could not find.
    //
    // If the extra characters begin with a digit, it is a version number and
    // these are different products. "kling3" vs "kling3turbo" still matches,
    // because "turbo" is a variant of the same family — which is what this
    // rule was written for.
    const extra = longer.slice(longer.indexOf(shorter) + shorter.length);
    if (/^\d/.test(extra)) continue;
    return true;
  }
  return false;
}

/**
 * Refresh the catalogue table from fal. Insert-only for existing rows (so a
 * dismissal is never undone), and it never deletes: a model vanishing from one
 * page of the API should not silently erase the owner's queue.
 */
/**
 * Record what a supplier is charging today and notice when it moves.
 *
 * The sweep below is insert-only by design (a dismissal must never be undone),
 * which meant an EXISTING model's price was written once and never looked at
 * again. A supplier could double a price and nothing would say so — the margin
 * would just erode. This closes that without changing the insert-only rule:
 * the catalogue row keeps its first-seen price, while every observation goes to
 * history and any material move is queued for the owner.
 *
 * Nothing here applies a price. See price-watch.js for why that gate exists.
 */
async function recordObservedPrice(pool, { provider, family, usd, unit }) {
  await pool.query(
    `INSERT INTO pricing_supplier_history (provider, family, price_usd, price_unit)
     VALUES ($1,$2,$3,$4)`, [provider, family, usd ?? null, unit ?? null]);

  const { rows: prev } = await pool.query(
    `SELECT price_usd FROM pricing_supplier_history
      WHERE provider = $1 AND family = $2 AND price_usd IS NOT NULL
      ORDER BY observed_at DESC OFFSET 1 LIMIT 1`, [provider, family]);
  const oldUsd = prev[0]?.price_usd;
  if (oldUsd == null || usd == null) return null;

  // The costing row this family maps to, if we sell it — that is what carries
  // the OTHER supplier's price, and the margin rule is MAX(fal, kie).
  const { rows: model } = await pool.query(
    `SELECT id, kie_cost, fal_cost, credits_override
       FROM pricing_models
      WHERE lower(model_name) = lower($1) LIMIT 1`, [family]);
  const m = model[0];
  const other = m ? Number(provider === 'fal' ? m.kie_cost : m.fal_cost) : null;
  const basisBefore = Math.max(Number(oldUsd), Number.isFinite(other) ? other : 0);
  const basisAfter  = Math.max(Number(usd),    Number.isFinite(other) ? other : 0);

  const change = proposeChange({
    provider, family, modelId: m?.id ?? null,
    oldUsd, newUsd: usd, basisBefore, basisAfter,
    currentCredits: m?.credits_override ?? null,
  });
  if (!change) return null;

  await pool.query(
    `INSERT INTO pricing_change_queue
       (provider, family, model_id, old_price_usd, new_price_usd, pct_change,
        old_credits, new_credits, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [change.provider, change.family, change.model_id, change.old_price_usd,
     change.new_price_usd, change.pct_change, change.old_credits,
     change.new_credits, change.status]);
  console.log(`[price-watch] ${describeChange(change)} [${change.status}]`);
  return change;
}

export async function syncProviderCatalog(pool, {
  fetchCatalog, since = null, provider = 'fal',
} = {}) {
  const { rows } = await pool.query('SELECT model_name FROM pricing_models');
  const known = knownNameSet(rows.map((r) => r.model_name));

  const items = await fetchCatalog();

  // fal's fetcher returns RAW endpoint items that still need grouping; kie's
  // returns finished families. Running the latter through newModelFamilies()
  // silently discarded all 98 kie groups, because sellableModels() requires
  // `status === 'public'` and a fal category — fields kie data has never had.
  // The sweep reported "0 model group(s) we do not sell" and looked like it
  // had worked, which is how Seedance 2.5 stayed missing after the fix that
  // was supposed to find it.
  //
  // Detect the shape rather than adding a flag the caller must remember to set.
  const preGrouped = items.length > 0 && items[0] && 'family' in items[0];
  let families = preGrouped
    ? (since ? items.filter((f) => f.first_seen && f.first_seen >= since) : items)
    : newModelFamilies(items, new Set(), { since });
  families = families.filter((f) => !alreadySold(f.family, known));

  let added = 0;
  const changes = [];
  for (const f of families) {
    const res = await pool.query(
      `INSERT INTO pricing_catalog_models
         (provider, family, lab, category, endpoints, price_usd, price_unit, first_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (provider, family) DO NOTHING
       RETURNING id`,
      [provider, f.family, f.lab, f.category, f.endpoints.length,
       f.price ? f.price.usd : null, f.price ? f.price.unit : null, f.first_seen]
    );
    if (res.rowCount) added++;
    // Observe the price whether or not the row was new — this is the half that
    // was missing, and it is why an existing model's price never moved.
    if (f.price) {
      try {
        const c = await recordObservedPrice(pool, {
          provider, family: f.family, usd: f.price.usd, unit: f.price.unit });
        if (c) changes.push(c);
      } catch (e) {
        // A watch failure must never abort the sweep — discovering new models
        // is the more important half.
        console.error(`[price-watch] ${f.family}: ${e.message}`);
      }
    }
  }
  return { found: families.length, added, changes };
}

/** Daily check. Adds anything new and logs plainly; the CRM shows the result. */
export async function runDailyModelSync(pool, dbReady, { fetchCatalog = null, since = null } = {}) {
  if (!dbReady()) return { added: [] };
  const out = { added: [] };
  try {
    out.added = await syncCostingModels(pool);
    if (out.added.length) {
      console.warn(`[costing-sync] ${out.added.length} model(s) are charged in production with no cost recorded: ${out.added.join(', ')}`);
    } else {
      console.log('[costing-sync] every production model has a costing row');
    }
  } catch (e) {
    console.error('[costing-sync] failed:', e.message);
    out.error = e.message;
  }

  // The provider sweep is a SEPARATE try: it reaches the network, and a fal
  // outage must never stop the check above, which only reads our own tables.
  try {
    const fetcher = fetchCatalog || (() => fetchFalCatalog());
    const cutoff = since || defaultCatalogCutoff();
    const r = await syncProviderCatalog(pool, { fetchCatalog: fetcher, since: cutoff });
    out.catalog = r;
    console.log(`[costing-sync] fal catalogue: ${r.found} model family(ies) we do not sell, ${r.added} newly recorded`);
  } catch (e) {
    // Logged, not thrown. A missing catalogue refresh is a stale queue, not an
    // outage — and silence here is exactly the failure this feature exists to
    // prevent, so it is always reported.
    console.error('[costing-sync] fal catalogue check failed:', e.message);
    out.catalogError = e.message;
  }

  // ── kie, swept the same way ────────────────────────────────────────────
  // Added 2026-08-16. Until now only fal was swept, so a model landing on kie
  // — where nearly all our spend goes — was invisible until someone noticed by
  // hand. Seedance 2.5 sat on kie for seven weeks unlisted, which is how this
  // was found. Separate try: one provider being down must not blind us to the
  // other.
  try {
    const r = await syncProviderCatalog(pool, {
      fetchCatalog: fetchKieCatalog, since, provider: 'kie',
    });
    out.kieCatalog = r;
    console.log(`[costing-sync] kie catalogue: ${r.found} model group(s) we do not sell, ${r.added} newly recorded`);
  } catch (e) {
    console.error('[costing-sync] kie catalogue check failed:', e.message);
    out.kieCatalogError = e.message;
  }
  return out;
}

/** Only surface models that appeared in roughly the last quarter. Without a
 *  cutoff the list is 477 families of mostly historical models; with it, ~50 —
 *  a queue someone will actually read. */
export function defaultCatalogCutoff(now = new Date()) {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - 3);
  return d.toISOString();
}
