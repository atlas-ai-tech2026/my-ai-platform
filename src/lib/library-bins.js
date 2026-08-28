// ─── library-bins.js ─────────────────────────────────────────────────────────
// Folders for the library — "Workshop Tuesday", "the client's brand", "keep".
//
// ── WHY PER-BROWSER, AND WHAT THAT COSTS ───────────────────────────────────
// Amr was asked where folders should live and the question stayed open, so
// this takes the answer that needs no decision from him: the browser.
//
// It cannot touch customer data, needs no column on a table holding 601
// people's history, and is deleted by clearing one key. The cost is real and
// stated in the UI rather than discovered: bins DO NOT FOLLOW YOU to another
// machine. For a workshop attendee on one laptop for one day — who this
// feature is for — that is enough.
//
// Everything here is a pure function over a plain object, so moving to
// per-account later means swapping load/save for two API calls. Nothing in
// the components would change.
//
// ── A BIN HOLDS IDs, NEVER RECORDS ─────────────────────────────────────────
// Deleting a bin must never look like deleting work. Holding copies would
// also mean a renamed prompt or a rescued url going stale inside a folder,
// and the customer seeing two versions of the same generation.

/** Storage key. Namespaced like the timeline's row height and library view. */
export const BINS_KEY = 'voxel.edit.bins';

/** Enough to organise a workshop, few enough to stay a row of chips rather
 *  than a second navigation problem. */
export const MAX_BINS = 12;
export const MAX_NAME = 40;

const uid = () => `b${Math.random().toString(36).slice(2, 9)}`;

/** An empty, valid state. Used whenever storage is unreadable — never null,
 *  so no caller has to guard. */
export const emptyBins = () => ({ bins: [] });

/**
 * Read what is stored, tolerating anything.
 *
 * A corrupt value must degrade to "no bins", never to a crash: the library is
 * the customer's own work, and refusing to render it because a folder name is
 * malformed would be a bad trade at any price.
 */
export function loadBins(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(BINS_KEY);
    if (!raw) return emptyBins();
    const parsed = JSON.parse(raw);
    const bins = Array.isArray(parsed?.bins) ? parsed.bins : [];
    return {
      bins: bins
        .filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string')
        .slice(0, MAX_BINS)
        .map((b) => ({
          id: b.id,
          name: String(b.name).slice(0, MAX_NAME),
          // De-duplicated on read as well as on write: a file edited by hand,
          // or an older shape, should not produce a bin that counts an item
          // twice.
          items: [...new Set((Array.isArray(b.items) ? b.items : []).filter((x) => typeof x === 'string'))],
        })),
    };
  } catch {
    return emptyBins();
  }
}

/** Persist. Failure is swallowed — private mode is not worth breaking over. */
export function saveBins(state, storage = globalThis.localStorage) {
  try { storage?.setItem(BINS_KEY, JSON.stringify(state)); } catch { /* no storage */ }
  return state;
}

/** @returns {{ok:true, state}} or {{ok:false, reason}} — a refusal always says why. */
export function createBin(state, name) {
  const clean = String(name || '').trim().slice(0, MAX_NAME);
  if (!clean) return { ok: false, reason: 'Give the folder a name.' };
  if (state.bins.length >= MAX_BINS) {
    return { ok: false, reason: `${MAX_BINS} folders is the limit.` };
  }
  if (state.bins.some((b) => b.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: `There is already a folder called “${clean}”.` };
  }
  return { ok: true, state: { bins: [...state.bins, { id: uid(), name: clean, items: [] }] } };
}

export function renameBin(state, id, name) {
  const clean = String(name || '').trim().slice(0, MAX_NAME);
  if (!clean) return { ok: false, reason: 'Give the folder a name.' };
  if (state.bins.some((b) => b.id !== id && b.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: `There is already a folder called “${clean}”.` };
  }
  return { ok: true, state: { bins: state.bins.map((b) => (b.id === id ? { ...b, name: clean } : b)) } };
}

/**
 * Remove a folder. The GENERATIONS ARE UNTOUCHED — a bin holds ids, and this
 * drops the list, not the work. Said here because "delete" on a folder full of
 * pictures is the most frightening button in the panel.
 */
export function removeBin(state, id) {
  return { ok: true, state: { bins: state.bins.filter((b) => b.id !== id) } };
}

/** Put a generation in a folder. Idempotent. */
export function addToBin(state, binId, itemId) {
  if (!itemId) return { ok: false, reason: 'Nothing selected.' };
  const bin = state.bins.find((b) => b.id === binId);
  if (!bin) return { ok: false, reason: 'That folder is gone.' };
  if (bin.items.includes(itemId)) return { ok: true, state, already: true };
  return {
    ok: true,
    state: { bins: state.bins.map((b) => (b.id === binId ? { ...b, items: [...b.items, itemId] } : b)) },
  };
}

export function removeFromBin(state, binId, itemId) {
  return {
    ok: true,
    state: {
      bins: state.bins.map((b) => (
        b.id === binId ? { ...b, items: b.items.filter((i) => i !== itemId) } : b)),
    },
  };
}

/** Which folders is this generation in? For showing a mark on the card. */
export const binsHolding = (state, itemId) =>
  state.bins.filter((b) => b.items.includes(itemId));

/**
 * The records a folder contains, in the order the LIBRARY gives them — not the
 * order they were added. A folder that reshuffles itself as you file things
 * reads as broken.
 *
 * Ids whose generation no longer exists are simply absent. Self-healing on
 * purpose: a deleted generation should not leave a hole that needs tidying,
 * and an empty folder is easier to understand than one that miscounts.
 */
export function recordsInBin(state, binId, records) {
  const bin = state.bins.find((b) => b.id === binId);
  if (!bin) return [];
  const want = new Set(bin.items);
  return (records || []).filter((r) => want.has(r?.id));
}

/** How many of a bin's ids still exist. The number on the chip must match what
 *  opening it shows, or the chip is lying. */
export const countInBin = (state, binId, records) => recordsInBin(state, binId, records).length;
