// Voxel Node — left sidebar node library (Freepik Spaces / Higgsfield style).
// Always-visible, categorized list of every node you can add, plus a
// prominent Upload action. Click a row to drop the node on the canvas, or
// drag it onto the canvas to place it where you release.
import React, { useRef, useState } from 'react';
import {
  Type, Image as ImageIcon, Video as VideoIcon, StickyNote, Mic, Music,
  Upload, Search, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { NODE_LIST } from './nodeRegistry';

const ICONS = { Type, Image: ImageIcon, Video: VideoIcon, StickyNote, Mic, Music };

// Per-category accent (matches Spotlight).
const CATEGORY_TINT = {
  Input: '#4F8DFF', Image: '#B57BFF', Video: '#38C77A', Audio: '#F39C2A', Utilities: '#E3B23C',
};
const CATEGORY_ORDER = ['Input', 'Image', 'Video', 'Audio', 'Utilities'];

// One-line helper text per node type.
const DESC = {
  text: 'Prompt / note that feeds other nodes',
  image: 'Upload an image as a reference',
  'image-generator': 'Text or reference → image',
  'video-generator': 'Text or image → video',
  voiceover: 'Script → spoken audio',
  music: 'Prompt → music track',
  'sticky-note': 'A note on the canvas',
};

const font = '"DM Sans", sans-serif';

export default function NodePanel({ onAdd, onUpload }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const fileRef = useRef(null);

  const q = query.trim().toLowerCase();
  const matches = NODE_LIST.filter((d) => !d.ui || d.type === 'sticky-note').filter(
    (d) => !q || d.label.toLowerCase().includes(q) || (DESC[d.type] || '').toLowerCase().includes(q)
  );
  const byCat = {};
  matches.forEach((d) => { (byCat[d.category || 'Other'] ||= []).push(d); });
  const cats = Object.keys(byCat).sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99)
  );

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onUpload?.(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Show node library"
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 22, width: 40, height: 40,
          borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
          background: 'rgba(20,20,20,0.92)', backdropFilter: 'blur(16px)', color: '#CCC',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <PanelLeftOpen style={{ width: 18, height: 18 }} />
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 248, zIndex: 21,
        background: 'rgba(13,13,13,0.96)', backdropFilter: 'blur(18px)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column', fontFamily: font,
      }}
    >
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 14px 10px' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Add nodes</span>
        <button onClick={() => setCollapsed(true)} title="Hide panel"
          style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PanelLeftClose style={{ width: 16, height: 16 }} />
        </button>
      </div>

      {/* Prominent Upload */}
      <div style={{ flexShrink: 0, padding: '0 12px 10px' }}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} style={{ display: 'none' }} />
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'linear-gradient(135deg, #FF2A2A, #B30F0F)', color: '#fff', border: 'none',
            borderRadius: 10, padding: '11px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: font, boxShadow: '0 4px 14px rgba(227,28,28,0.35)',
          }}
        >
          <Upload style={{ width: 16, height: 16 }} /> Upload image
        </button>
      </div>

      {/* Search */}
      <div style={{ flexShrink: 0, padding: '0 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 9 }}>
          <Search style={{ width: 14, height: 14, color: '#878787' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nodes"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 13, fontFamily: font }} />
        </div>
      </div>

      {/* Node list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 16px' }} className="hide-scrollbar">
        {cats.length === 0 && (
          <div style={{ padding: '14px 10px', color: '#878787', fontSize: 13 }}>No nodes match “{query}”.</div>
        )}
        {cats.map((cat) => (
          <div key={cat} style={{ marginBottom: 6 }}>
            <div style={{ padding: '8px 8px 4px', fontSize: 11, color: '#6f6f6f', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>{cat}</div>
            {byCat[cat].map((d) => {
              const Icon = ICONS[d.icon] || Type;
              const tint = CATEGORY_TINT[d.category] || '#878787';
              return (
                <button
                  key={d.type}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/voxel-node', d.type); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={() => onAdd?.(d.type)}
                  title={`Add ${d.label}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, width: '100%',
                    padding: '9px 9px', borderRadius: 10, border: '1px solid transparent',
                    background: 'transparent', color: '#fff', cursor: 'grab', textAlign: 'left',
                    fontFamily: font, marginBottom: 2,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                >
                  <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${tint}22`, border: `1px solid ${tint}55` }}>
                    <Icon style={{ width: 16, height: 16, color: tint }} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{d.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#7f7f7f', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{DESC[d.type] || ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <div style={{ padding: '8px 10px 0', fontSize: 11, color: '#5f5f5f', lineHeight: 1.5 }}>
          Tip: press <b style={{ color: '#9a9a9a' }}>Space</b> or <b style={{ color: '#9a9a9a' }}>/</b> for Spotlight, or drag an image onto the canvas.
        </div>
      </div>
    </div>
  );
}
