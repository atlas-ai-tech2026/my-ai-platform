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
//
// ── COLLAPSING ─────────────────────────────────────────────────────────────
// The owner asked to be able to fold the sidebar down to icons and get the
// width back for the page. Collapsed is 56px instead of 208px — 152px returned
// to whatever table is being read, which on the Users tab is two more columns.
//
// Two rules make collapsing safe rather than another way to lose a feature:
//   · EVERY tab has an icon, including one nobody has assigned yet. A button
//     with no icon is an invisible button, which is how a tab silently
//     disappears — the same bug `groupTabs` already guards against.
//   · Nothing is lost that was visible before. Labels move into the
//     accessibility tree and a hover tooltip; counts shrink to a dot rather
//     than vanishing, so a waiting alert still shows while folded.

import React, { useState, useEffect, useRef } from 'react';
import {
  ClipboardCheck, ListChecks, Bell, Activity, Users, Ticket, Gift, Layers,
  Calculator, BadgePercent, ScrollText, Gauge, ShieldCheck, Megaphone,
  BookOpen, Circle, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

export const NAV_WIDTH = 208;
export const NAV_WIDTH_COLLAPSED = 56;

const ICONS = {
  sop: ClipboardCheck, tasks: ListChecks, alerts: Bell, live: Activity,
  users: Users, promos: Ticket, gifts: Gift, bulk: Layers,
  costing: Calculator, offers: BadgePercent,
  logs: ScrollText, usage: Gauge, security: ShieldCheck, notifications: Megaphone,
  // Not built yet (#48). Listed now so that the day it appears it is not the
  // one blank square in a column of icons.
  knowledge: BookOpen,
};

/**
 * The icon for a tab — never nothing.
 *
 * A tab added later and not listed above still gets a mark you can see and
 * click. Collapsed, a missing icon is not a cosmetic gap: it is a button of
 * blank space, and the feature behind it is gone for anyone who did not already
 * know it was there.
 */
export function iconFor(id) {
  return ICONS[id] || Circle;
}

const STORE_KEY = 'voxel.crm.nav.collapsed';

/** Remembered across visits — folding it every morning would be its own chore. */
export function readCollapsed() {
  try { return window.localStorage.getItem(STORE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(v) {
  // Private browsing throws on write. A preference that cannot be saved is a
  // preference that does not persist — not a broken sidebar.
  try { window.localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch { /* not fatal */ }
}

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

function Badge({ value, tone, dot }) {
  if (value == null || value === 0 || value === false) return null;
  // Collapsed, a count has nowhere to go — but "there is something waiting" is
  // the part that must survive, so it becomes a dot rather than nothing.
  if (dot || value === true) {
    return <span aria-hidden="true" style={{
      width: 7, height: 7, borderRadius: '50%', background: tone, flex: 'none',
      ...(dot ? { position: 'absolute', top: 6, right: 8 } : null),
    }} />;
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Which icon is being pointed at, so the label can be shown next to it. A
  // native `title` waits about a second before appearing, which is long enough
  // to give up and expand the sidebar instead.
  const [peek, setPeek] = useState(null);

  const toggle = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });

  return (
    <nav aria-label="Control panel sections" style={{
      width: collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH, flex: 'none',
      paddingRight: collapsed ? 0 : 8,
      borderRight: '1px solid var(--crm-w08)',
      // Stays put while a long table scrolls underneath it.
      position: 'sticky', top: 16,
    }}>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar to icons'}
        title={collapsed ? 'Expand' : 'Collapse'}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          justifyContent: collapsed ? 'center' : 'flex-start',
          width: '100%', padding: '6px 10px', marginBottom: 12, borderRadius: 8,
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--crm-w40)', fontFamily: 'inherit', fontSize: 11.5,
        }}>
        {collapsed
          ? <PanelLeftOpen size={16} aria-hidden="true" />
          : <PanelLeftClose size={16} aria-hidden="true" />}
        {!collapsed && <span>Collapse</span>}
      </button>

      {groups.map((g) => (
        // role=group keeps the grouping for a screen reader in BOTH states —
        // collapsed there is no room for the heading text, but the structure
        // should not quietly disappear with it.
        <div key={g.id} role="group" aria-label={g.label}
          style={{ marginBottom: collapsed ? 10 : 18 }}>
          {collapsed ? (
            <div aria-hidden="true" style={{
              height: 1, background: 'var(--crm-w08)', margin: '0 12px 8px',
            }} />
          ) : (
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
              color: 'var(--crm-w35)', padding: '0 10px', marginBottom: 6,
            }}>{g.label}</div>
          )}
          {g.items.map((t) => {
            const active = current === t.id;
            const b = badges[t.id];
            const Icon = iconFor(t.id);
            const count = typeof b?.value === 'number' && b.value > 0 ? b.value : null;
            return (
              <div key={t.id} style={{ position: 'relative' }}
                onMouseEnter={() => collapsed && setPeek(t.id)}
                onMouseLeave={() => collapsed && setPeek(null)}>
                <button onClick={() => onSelect(t.id)}
                  aria-current={active ? 'page' : undefined}
                  // Collapsed there is no visible text, so the name has to come
                  // from here — including the count, which is only a dot.
                  aria-label={collapsed ? (count ? `${t.label}, ${count}` : t.label) : undefined}
                  onFocus={() => collapsed && setPeek(t.id)}
                  onBlur={() => collapsed && setPeek(null)}
                  style={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    padding: collapsed ? '9px 0' : '7px 10px',
                    marginBottom: 1, borderRadius: 8,
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
                  <Icon size={16} aria-hidden="true" style={{ flex: 'none' }} />
                  {!collapsed && (
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                                   whiteSpace: 'nowrap' }}>{t.label}</span>
                  )}
                  <Badge value={b?.value} tone={b?.tone || 'var(--crm-w40)'} dot={collapsed} />
                </button>

                {collapsed && peek === t.id && (
                  <span aria-hidden="true" style={{
                    position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)',
                    marginLeft: 8, zIndex: 60, pointerEvents: 'none', whiteSpace: 'nowrap',
                    padding: '5px 9px', borderRadius: 7, fontSize: 12,
                    background: 'var(--crm-ink)', color: 'var(--crm-page)',
                    boxShadow: '0 6px 20px var(--crm-shadow)',
                  }}>{t.label}{count ? ` · ${count}` : ''}</span>
                )}
              </div>
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
