// ─── HistoryFilterBar.jsx ────────────────────────────────────────────────────
// Search your own work: words, date, model.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The grid was already paged and lazy, so the remaining pain was never loading
// — it was FINDING. There was no search of any kind. A customer with 349
// pictures looking for last Tuesday's work had exactly one option: scroll.
//
// ── THE DEFAULTS ARE THE DESIGN ────────────────────────────────────────────
// "Any time", not "last 7 days". Amr suggested a short default window and the
// reason not to is his own business: a code is bought and used across a MONTH,
// sometimes two. A seven-day default would hide most of a customer's own work
// from them, and the failure it produces — "my pictures are gone" — is far
// worse than a slow grid. So the date presets are 30 and 60 days, and nothing
// is narrowed until the customer narrows it.
//
// The count is not decoration either. With a grid that loads as you scroll,
// "128 pictures" is the only way to know whether a search was too narrow or
// the work simply is not there.

import React, { useEffect, useRef, useState } from 'react';

const font = '"DM Sans", sans-serif';

/** Presets, in the language of how the product is actually sold. */
export const DATE_PRESETS = [
  { id: 'any', label: 'Any time', days: null },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '60', label: 'Last 60 days', days: 60 },
];

export const EMPTY = { text: '', preset: 'any', model: 'any' };

/** Filter state → what the search endpoint expects. Pure, so it is testable
 *  without a browser and cannot drift from what the bar displays. */
export function toQuery(f, { type } = {}) {
  const days = DATE_PRESETS.find((p) => p.id === f.preset)?.days ?? null;
  return {
    type: type || undefined,
    text: (f.text || '').trim() || undefined,
    from: days ? new Date(Date.now() - days * 86400000).toISOString() : undefined,
    models: f.model && f.model !== 'any' ? [f.model] : undefined,
  };
}

/** Is anything actually narrowed? Used to decide whether to search at all —
 *  an unfiltered "search" is just the normal history feed, and running it
 *  through a second code path would give the customer two subtly different
 *  grids for the same thing. */
export const isFiltering = (f) =>
  Boolean((f.text || '').trim()) || f.preset !== 'any' || (f.model && f.model !== 'any');

/** The chips that show what is currently applied. */
export function activeChips(f) {
  const out = [];
  if ((f.text || '').trim()) out.push({ key: 'text', label: `“${f.text.trim()}”` });
  if (f.preset !== 'any') {
    out.push({ key: 'preset', label: DATE_PRESETS.find((p) => p.id === f.preset)?.label || f.preset });
  }
  if (f.model && f.model !== 'any') out.push({ key: 'model', label: f.model });
  return out;
}

export default function HistoryFilterBar({
  value, onChange, models = [], total = null, loading = false, onSelectMode, selecting = false,
}) {
  const f = value || EMPTY;
  const [draft, setDraft] = useState(f.text || '');
  const timer = useRef(null);

  // Typing must not fire a query per keystroke. 300ms is long enough that a
  // normal typist makes one request, short enough that it never feels stuck.
  useEffect(() => { setDraft(f.text || ''); }, [f.text]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const typed = (next) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ ...f, text: next }), 300);
  };

  const chips = activeChips(f);
  const clear = () => { clearTimeout(timer.current); setDraft(''); onChange({ ...EMPTY }); };

  return (
    <div style={{ padding: '0 28px 10px', fontFamily: font }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search" value={draft} onChange={(e) => typed(e.target.value)}
          placeholder="Search your prompts" aria-label="Search your prompts"
          style={{
            flex: '1 1 220px', height: 34, borderRadius: 9, padding: '0 12px',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#FFF', fontSize: 13, fontFamily: font, outline: 'none',
          }}
        />
        <select
          value={f.preset} onChange={(e) => onChange({ ...f, preset: e.target.value })}
          aria-label="When it was made" style={sel}
        >
          {DATE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {/* Their models, not all 28. A dropdown full of models a customer has
            never used, most returning nothing, reads as broken. */}
        <select
          value={f.model} onChange={(e) => onChange({ ...f, model: e.target.value })}
          aria-label="Model" style={sel} disabled={!models.length}
        >
          <option value="any">All models</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {onSelectMode && (
          <button onClick={onSelectMode} style={{ ...sel, cursor: 'pointer', paddingInline: 12 }}>
            {selecting ? 'Done' : 'Select'}
          </button>
        )}
      </div>

      {(chips.length > 0 || total !== null) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          {/* The number, first. It is the answer to "is my search too narrow?" */}
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>
            {loading ? 'Searching…'
              : total === null ? ''
              : `${total.toLocaleString()} ${total === 1 ? 'picture' : 'pictures'}`}
          </span>
          {chips.map((c) => (
            <span key={c.key} style={{
              fontSize: 11.5, padding: '3px 9px', borderRadius: 999,
              background: 'rgba(224,30,30,0.14)', border: '1px solid rgba(224,30,30,0.35)',
              color: 'rgba(255,255,255,0.85)',
            }}>{c.label}</span>
          ))}
          {chips.length > 0 && (
            <button onClick={clear} style={{
              marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.14)',
              color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: font,
            }}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

const sel = {
  height: 34, borderRadius: 9, padding: '0 10px', fontSize: 12.5, fontFamily: font,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#FFF', outline: 'none',
};
