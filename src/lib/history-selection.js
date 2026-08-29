// ─── history-selection.js ────────────────────────────────────────────────────
// Choosing pictures, and knowing exactly how many are chosen.
//
// ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
// Because the number is a PROMISE. The confirmation says "Delete 128
// pictures?" and the customer presses yes on the strength of that number. If
// the selection actually holds 60, two thirds of their work quietly survives a
// delete they believed they had made — and they find out weeks later.
//
// So the counting lives here, alone, with tests, rather than being scattered
// through a component where it can drift from what the button says.
//
// ── AND WHY SELECTING IS A MODE ────────────────────────────────────────────
// Cards are not tickable by default. With a delete on the same screen, an
// accidental tick that becomes an accidental delete is one press too easy.

export const emptySelection = () => ({ on: false, ids: [] });

/** Turn selection on or off. Leaving the mode always CLEARS — a selection that
 *  survives being switched off is one nobody can see and can still delete. */
export function setMode(sel, on) {
  return on ? { on: true, ids: sel.ids || [] } : { on: false, ids: [] };
}

export function toggle(sel, id) {
  if (!id) return sel;
  const has = sel.ids.includes(id);
  return { ...sel, ids: has ? sel.ids.filter((x) => x !== id) : [...sel.ids, id] };
}

/** Replace the whole selection — used by "Select all", where the ids come from
 *  the server rather than from what happens to be on screen. */
export const selectAll = (sel, ids) => ({ ...sel, ids: [...new Set((ids || []).filter(Boolean))] });

export const clear = (sel) => ({ ...sel, ids: [] });
export const isSelected = (sel, id) => sel.ids.includes(id);
export const count = (sel) => sel.ids.length;

/**
 * What the buttons say.
 *
 * `total` is what the SERVER counted for the current filter, which may be more
 * than what is loaded. The "select all" label uses that number, because
 * offering "Select all 60" when 128 match would be answering a question the
 * customer did not ask.
 */
export function labels(sel, { total = null, loaded = 0 } = {}) {
  const n = count(sel);
  const all = total ?? loaded;
  return {
    selectAll: `Select all${all ? ` ${all.toLocaleString()}` : ''}`,
    remove: n ? `Delete ${n.toLocaleString()}` : 'Delete',
    selected: n ? `${n.toLocaleString()} selected` : 'Nothing selected',
    canDelete: n > 0,
  };
}

/**
 * The sentence on the confirmation.
 *
 * It names the FILTER as well as the count. "Delete 128 pictures?" does not
 * say WHICH 128 — and if a filter was set and forgotten, that is exactly the
 * moment to be reminded of it.
 */
export function confirmSentence(n, filter = {}, recoveryDays = 30) {
  const bits = [];
  if ((filter.text || '').trim()) bits.push(`matching “${filter.text.trim()}”`);
  if (filter.model && filter.model !== 'any') bits.push(`made with ${filter.model}`);
  if (filter.preset && filter.preset !== 'any') bits.push('from the period you have selected');
  const where = bits.length ? ` ${bits.join(', ')}` : '';
  const what = n === 1 ? '1 picture' : `${n.toLocaleString()} pictures`;
  return `Delete ${what}${where}? You can bring ${n === 1 ? 'it' : 'them'} back for `
    + `${recoveryDays} days from Recently deleted.`;
}

/**
 * What to say after the fact.
 *
 * Asking for 40 and getting 38 is a FACT the customer needs — the other two
 * were already gone. A flat "deleted" would hide it.
 */
export function afterDelete({ deleted = 0, asked = 0 }) {
  if (!deleted) return 'Nothing was deleted.';
  if (asked && deleted < asked) {
    return `${deleted} of ${asked} deleted — the rest were already gone.`;
  }
  return deleted === 1 ? '1 picture deleted' : `${deleted.toLocaleString()} pictures deleted`;
}
