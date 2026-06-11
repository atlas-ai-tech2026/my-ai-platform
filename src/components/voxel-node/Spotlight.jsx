// Voxel Node — Spotlight quick-add palette. Searchable, categorized node
// menu (Higgsfield-style). Opens via the + tool, or Space / "/". Picking
// a node adds it to the canvas at the last cursor position.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Type, Image as ImageIcon, Video as VideoIcon, StickyNote } from 'lucide-react';
import { NODE_LIST } from './nodeRegistry';

const ICONS = { Type, Image: ImageIcon, Video: VideoIcon, StickyNote };

// Per-category accent for the rounded icon tile (visual only).
const CATEGORY_TINT = {
  Input: '#4F8DFF',
  Image: '#B57BFF',
  Video: '#7B7BFF',
  Audio: '#F39C2A',
  Utilities: '#E3B23C',
};

// Display order of the category sections.
const CATEGORY_ORDER = ['Input', 'Image', 'Video', 'Audio', 'Utilities'];

export default function Spotlight({ open, onClose, onPick }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      // focus the search box on open
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = NODE_LIST.filter((d) => !q || d.label.toLowerCase().includes(q));
    const byCat = {};
    matches.forEach((d) => {
      const cat = d.category || 'Other';
      (byCat[cat] ||= []).push(d);
    });
    const cats = Object.keys(byCat).sort(
      (a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99)
    );
    return cats.map((cat) => ({ cat, items: byCat[cat] }));
  }, [query]);

  if (!open) return null;

  return (
    <>
      {/* click-away backdrop */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40 }} />
      <div
        style={{
          position: 'absolute', bottom: 84, left: '50%', transform: 'translateX(-50%)',
          width: 320, maxHeight: '60vh', overflowY: 'auto', zIndex: 41,
          background: 'rgba(20,20,20,0.97)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16,
          padding: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          fontFamily: '"DM Sans", sans-serif',
        }}
        className="hide-scrollbar"
      >
        {/* Search box */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 6,
          background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10,
        }}>
          <Search style={{ width: 15, height: 15, color: '#878787' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontSize: 14, fontFamily: 'inherit',
            }}
          />
        </div>

        {grouped.length === 0 && (
          <div style={{ padding: '14px 12px', color: '#878787', fontSize: 13 }}>No nodes match “{query}”.</div>
        )}

        {grouped.map(({ cat, items }) => (
          <div key={cat} style={{ marginBottom: 4 }}>
            <div style={{ padding: '8px 10px 4px', fontSize: 11, color: '#878787', letterSpacing: '0.04em' }}>{cat}</div>
            {items.map((d) => {
              const Icon = ICONS[d.icon] || Type;
              const tint = CATEGORY_TINT[d.category] || '#878787';
              return (
                <button
                  key={d.type}
                  onClick={() => { onPick(d.type); onClose(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, width: '100%',
                    padding: '8px 10px', borderRadius: 10, border: 'none',
                    background: 'transparent', color: '#fff', cursor: 'pointer',
                    fontSize: 14, fontFamily: 'inherit', textAlign: 'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `${tint}22`, border: `1px solid ${tint}55`,
                  }}>
                    <Icon style={{ width: 16, height: 16, color: tint }} />
                  </span>
                  {d.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
