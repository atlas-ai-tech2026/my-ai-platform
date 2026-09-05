// ─── model-catalog.js ────────────────────────────────────────────────────────
// What kie offers, against what Voxel actually sells.
//
// Amr, 2026-09-05: "The control panel tells me there is a new model. Before you
// add it you go to kie, the page of the API, and read it properly. You will
// give me all models — if it is necessary I add it, if not I remove it, or say
// keep it pending, hold, not now."
//
// So this is not a "new models" feed. It is the WHOLE list, every row carrying
// two separate facts that must never be confused:
//
//   what I know   — have I read this model's API page and understood it?
//   what he chose — ADD, REMOVE, HOLD, or nothing yet.
//
// ☠ THE TWO ARE NOT THE SAME AND THE ROW MUST NOT BLUR THEM. A row I could not
// read must never appear as ready for him to add — his requirement, and the
// right one. "I cannot read this, not confirmed from my side" is a state, not
// an error to hide.
//
// ── WHY A ROW CAN BE "UNDECIDED" AND THAT IS FINE ──────────────────────────
// An unjudged row hidden among decided ones is how a queue rots — which is
// exactly what happened to the supplier costs: 32 of 82 active pricing rows
// have no cost, and nobody could tell the retired ones from the merely
// unpriced. Undecided is a visible state here, on purpose.

/** kie's public catalogue. No key needed — verified 2026-09-05, 104 groups. */
const KIE_CATALOG_URL = 'https://api.kie.ai/api/v1/playground/pagePlaygroundGroup';

/** The four request shapes Voxel speaks. A model outside these needs CODE. */
export const KNOWN_FAMILIES = ['jobs', 'flux', 'mj', 'gpt4o'];

/** Decisions the owner can record against a row. */
export const DECISIONS = ['add', 'remove', 'hold'];

/**
 * Fetch every group kie publishes, following pagination.
 *
 * Never throws: a catalogue that cannot be reached is a REPORTED condition,
 * not a crashed screen. The caller shows "could not reach kie" rather than an
 * empty list that looks like "kie has no models".
 */
export async function fetchKieCatalog({ fetchImpl = fetch, pageSize = 100, maxPages = 10 } = {}) {
  const groups = [];
  let total = null;
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await fetchImpl(KIE_CATALOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNum: page, pageSize }),
      });
      if (!res.ok) return { ok: false, reason: `kie replied ${res.status}`, groups, total };
      const body = await res.json();
      const data = body?.data || {};
      const rows = data.list || data.records || data.rows || [];
      if (total == null) total = Number(data.total) || null;
      groups.push(...rows);
      if (!rows.length || (total != null && groups.length >= total)) break;
    }
    return { ok: true, groups, total: total ?? groups.length };
  } catch (e) {
    return { ok: false, reason: e?.message || 'could not reach kie', groups, total };
  }
}

/** Normalise a name so "Kling V2.1" and "Kling 2.1" are recognised as one. */
export function nameKey(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/\bv(?=\d)/g, '')          // "V2.1" -> "2.1"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** What a kie group is for, in Voxel's words. */
export function kindOf(group) {
  const t = (group?.taskType || []).join(' ');
  if (/video/i.test(t)) return 'video';
  if (/image/i.test(t)) return 'image';
  if (/chat/i.test(t)) return 'chat';
  return 'other';
}

/**
 * Join kie's catalogue to what Voxel has, and to what the owner decided.
 *
 * @param groups    from fetchKieCatalog
 * @param owned     names Voxel already sells (MODEL_CONFIG + VIDEO_DIRECT_MAP)
 * @param decisions { [path]: { decision, note, at } } — the owner's own column
 * @param readings  { [path]: { read: bool, family, reason } } — mine
 */
export function buildRows(groups = [], { owned = [], decisions = {}, readings = {} } = {}) {
  const ownedKeys = new Set(owned.map(nameKey));
  return groups
    .map((g) => {
      const path = g?.path || '';
      const name = g?.groupName || path;
      const decision = decisions[path] || {};
      const reading = readings[path] || {};
      const isOwned = ownedKeys.has(nameKey(name));

      // ☠ "read" and "ready to add" are different. A model I have not read is
      // not offered, whatever else is true about it.
      let readState;
      if (isOwned) readState = 'owned';
      else if (reading.read === false) readState = 'cannot_read';
      else if (reading.read === true) readState = 'read';
      else readState = 'not_read';

      const needsCode = reading.read === true && reading.family
        && !KNOWN_FAMILIES.includes(reading.family);

      return {
        path,
        name,
        kind: kindOf(g),
        provider: g?.provider || null,
        tagline: g?.tagline || null,
        variants: Number(g?.count) || 0,
        owned: isOwned,
        read_state: readState,
        // Only true when I have read it AND it fits a shape we already speak.
        // Everything else is either not offered, or offered with a warning.
        addable: readState === 'read' && !needsCode,
        needs_code: !!needsCode,
        cannot_read_reason: reading.read === false ? (reading.reason || 'not confirmed from my side') : null,
        decision: DECISIONS.includes(decision.decision) ? decision.decision : null,
        decided_at: decision.at || null,
        note: decision.note || null,
      };
    })
    // Undecided and unowned first — the ones needing his attention. Then held,
    // then everything settled. A queue he has to hunt through is a queue he
    // stops opening.
    .sort((a, b) => {
      const rank = (r) => (r.owned ? 3 : r.decision === 'remove' ? 4 : r.decision === 'hold' ? 2 : r.decision ? 3 : 0);
      return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
    });
}

/** One line of counts for the top of the tab. */
export function summarise(rows = []) {
  const n = (f) => rows.filter(f).length;
  return {
    total: rows.length,
    owned: n((r) => r.owned),
    undecided: n((r) => !r.owned && !r.decision),
    held: n((r) => r.decision === 'hold'),
    removed: n((r) => r.decision === 'remove'),
    cannot_read: n((r) => r.read_state === 'cannot_read'),
    needs_code: n((r) => r.needs_code),
  };
}
