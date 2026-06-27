// Voxel Node — "drag a line to empty canvas → choose the node to build".
// Appears at the drop point with only the node types that can connect to the
// port you dragged from; picking one creates it and wires the connection.
import React, { useEffect, useRef, useState } from 'react';
import { Search, Type, Image as ImageIcon, Video as VideoIcon, StickyNote, Mic, Music } from 'lucide-react';

const ICONS = { Type, Image: ImageIcon, Video: VideoIcon, StickyNote, Mic, Music };
const TINT = { Input: '#4F8DFF', Image: '#B57BFF', Video: '#38C77A', Audio: '#F39C2A', Utilities: '#E3B23C' };
const GENERATORS = new Set(['Image', 'Video', 'Audio']);
const font = '"DM Sans", sans-serif';

export default function ConnectMenu({ x, y, options, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => !q || o.def.label.toLowerCase().includes(q));
  const primary = filtered.filter((o) => GENERATORS.has(o.def.category));
  const other = filtered.filter((o) => !GENERATORS.has(o.def.category));

  // Keep the menu on-screen.
  const left = Math.min(x, window.innerWidth - 280);
  const top = Math.min(y, window.innerHeight - 320);

  const Row = ({ o }) => {
    const Icon = ICONS[o.def.icon] || Type;
    const tint = TINT[o.def.category] || '#878787';
    return (
      <button
        onClick={() => onPick(o)}
        title={`Add ${o.def.label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          padding: '9px 10px', borderRadius: 10, border: 'none', background: 'transparent',
          color: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: font,
          fontSize: 15, fontWeight: 600,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${tint}26`, border: `1px solid ${tint}55` }}>
          <Icon style={{ width: 17, height: 17, color: tint }} />
        </span>
        {o.def.label}
      </button>
    );
  };

  return (
    <>
      <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div
        style={{
          position: 'fixed', left, top, width: 264, zIndex: 61,
          background: 'rgba(22,22,24,0.98)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
          padding: 10, boxShadow: '0 24px 70px rgba(0,0,0,0.7)', fontFamily: font,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', marginBottom: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
          <Search style={{ width: 15, height: 15, color: '#878787' }} />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 14, fontFamily: font }} />
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: '12px 11px', color: '#878787', fontSize: 13 }}>Nothing connects here.</div>
        )}
        {primary.map((o) => <Row key={o.def.type} o={o} />)}
        {other.length > 0 && (
          <div style={{ padding: '8px 11px 4px', fontSize: 12, color: '#6f6f6f', fontWeight: 600 }}>Other</div>
        )}
        {other.map((o) => <Row key={o.def.type} o={o} />)}
      </div>
    </>
  );
}
