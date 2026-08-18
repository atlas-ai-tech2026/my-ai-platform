// ─── AdminNav.jsx ────────────────────────────────────────────────────────────
// The control panel outgrew a horizontal tab bar.
//
// Fourteen tabs and 95 characters of labels were being squeezed onto one line,
// so the text shrank until it was hard to read — and Knowledge Base makes
// fifteen. A bar that shrinks to fit is a bar that has already stopped working;
// a sidebar simply gets taller.
//
// ── WHY GROUPED ────────────────────────────────────────────────────────────
// Fourteen items in a flat list is a list you scan every time. Four groups of
// three or four is a list you learn once and then aim at. The grouping is by
// WHEN YOU USE IT, not by what built it:
//   DAILY     — open these most mornings
//   CUSTOMERS — a person emailed, or a cohort needs setting up
//   MONEY     — what things cost and what they sell for
//   SYSTEM    — occasional, and mostly when something is wrong
//
// ── BADGES ─────────────────────────────────────────────────────────────────
// A dot on SOP when a check needs attention, a count on Tasks. This is the
// point of a sidebar over a bar: room to say something without another click.
// Badges are only ever shown for things that are TRUE — an invented number
// here would be the same failure as a screen that says OK when it means "not
// checked".

import React, { useState, useEffect, useRef } from 'react';

export const GROUPS = [
  { id: 'daily',     label: 'Daily',     tabs: ['sop', 'alerts', 'tasks', 'live'] },
  { id: 'customers', label: 'Customers', tabs: ['users', 'promos', 'gifts', 'bulk'] },
  { id: 'money',     label: 'Money',     tabs: ['costing', 'offers'] },
  { id: 'system',    label: 'System',    tabs: ['logs', 'usage', 'security', 'notifications'] },
];

/**
 * Order the tabs into groups, and put anything NOT listed above into System.
 *
 * The fallback matters: a tab added later and forgotten here would otherwise
 * vanish from the navigation entirely — reachable only by someone who knew it
 * existed. Losing a feature by omission is exactly the bug this panel keeps
 * producing, so the default is "still visible", not "silently gone".
 */
export function groupTabs(tabs) {
  const known = new Set(GROUPS.flatMap((g) => g.tabs));
  const orphans = tabs.filter((t) => !known.has(t.id));
  return GROUPS.map((g) => ({
    ...g,
    items: g.tabs.map((id) => tabs.find((t) => t.id === id)).filter(Boolean)
      .concat(g.id === 'system' ? orphans : []),
  })).filter((g) => g.items.length);
}

function Badge({ value, tone }) {
  if (value == null || value === 0 || value === false) return null;
  if (value === true) {
    return <span aria-hidden="true" style={{
      width: 7, height: 7, borderRadius: '50%', background: tone, flex: 'none' }} />;
  }
  return (
    <span style={{
      minWidth: 18, height: 17, padding: '0 5px', borderRadius: 9, flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: tone, color: 'var(--crm-page)', fontSize: 10.5, fontWeight: 700,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    }}>{value > 99 ? '99+' : value}</span>
  );
}

export default function AdminNav({ tabs, current, onSelect, badges = {} }) {
  const groups = groupTabs(tabs);
  return (
    <nav aria-label="Control panel sections" style={{
      width: 208, flex: 'none', paddingRight: 8,
      borderRight: '1px solid var(--crm-w08)',
    }}>
      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
            color: 'var(--crm-w35)', padding: '0 10px', marginBottom: 6,
          }}>{g.label}</div>
          {g.items.map((t) => {
            const active = current === t.id;
            const b = badges[t.id];
            return (
              <button key={t.id} onClick={() => onSelect(t.id)}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 10px', marginBottom: 1, borderRadius: 8,
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit', fontSize: 13.5,
                  fontWeight: active ? 700 : 500,
                  background: active ? 'var(--crm-w08)' : 'transparent',
                  color: active ? 'var(--crm-ink)' : 'var(--crm-w60)',
                  // The accent rail marks the current section without moving
                  // anything — a border that appears on selection would shift
                  // every other row by three pixels.
                  boxShadow: active ? 'inset 2px 0 0 #e0442c' : 'none',
                }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap' }}>{t.label}</span>
                <Badge value={b?.value} tone={b?.tone || 'var(--crm-w40)'} />
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * ⌘K — type a few letters, hit Enter, land on the tab.
 *
 * Deliberately matches the DESCRIPTION as well as the label: "backup" should
 * find SOP even though the word is not in its name. A jump box that only
 * matches titles is one you stop using the first time it fails you.
 */
export function CommandPalette({ tabs, onSelect }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o); setQ(''); setI(0);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) return null;

  const needle = q.trim().toLowerCase();
  const hits = (needle
    ? tabs.filter((t) => t.label.toLowerCase().includes(needle)
                      || (t.desc || '').toLowerCase().includes(needle))
    : tabs).slice(0, 8);

  const go = (id) => { onSelect(id); setOpen(false); };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'var(--crm-overlay)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh',
      }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Jump to a section"
        style={{
          width: 'min(520px, 92vw)', background: 'var(--crm-surface)',
          border: '1px solid var(--crm-w12)', borderRadius: 14,
          boxShadow: '0 24px 64px var(--crm-shadow)', overflow: 'hidden',
        }}>
        <input
          ref={inputRef} value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(n + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setI((n) => Math.max(n - 1, 0)); }
            if (e.key === 'Enter' && hits[i]) go(hits[i].id);
          }}
          placeholder="Jump to…  (try “backup”, “credits”, “tasks”)"
          aria-label="Search sections"
          style={{
            width: '100%', padding: '15px 17px', fontSize: 15, fontFamily: 'inherit',
            background: 'none', border: 'none', outline: 'none', color: 'var(--crm-ink)',
            borderBottom: '1px solid var(--crm-w08)',
          }} />
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: 6 }}>
          {hits.length === 0 && (
            <div style={{ padding: '14px 12px', color: 'var(--crm-w45)', fontSize: 13 }}>
              Nothing matches “{q}”.
            </div>
          )}
          {hits.map((t, n) => (
            <button key={t.id} onClick={() => go(t.id)} onMouseEnter={() => setI(n)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                background: n === i ? 'var(--crm-w08)' : 'transparent',
              }}>
              <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--crm-ink)' }}>{t.label}</div>
              {t.desc && (
                <div style={{
                  fontSize: 11.5, color: 'var(--crm-w50)', marginTop: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t.desc}</div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
