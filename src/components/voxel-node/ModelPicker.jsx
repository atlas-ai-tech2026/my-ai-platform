// Voxel Node — model picker dropdown. Searchable card list shown when the
// node's model chip is clicked. Higgsfield-style layout, but in Voxel red
// (#E31C1C) instead of their yellow-green. Metadata (badge/res/duration)
// is display-only; the server resolves the model name → FAL endpoint.
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Check } from 'lucide-react';

const RED = '#E31C1C';

// Display metadata per model name (badge + capability chips).
const META = {
  // Image
  'Nano Banana Pro':   { badge: 'NEW', chips: ['4K'] },
  'Nano Banana 2':     { badge: 'NEW', chips: ['4K'] },
  'GPT Image 2':       { badge: 'NEW', chips: ['4K'] },
  'GPT Image 1.5':     { badge: null,  chips: ['4K'] },
  'Seedream 4.5':      { badge: null,  chips: ['4K'] },
  'Seedream 5.0 Lite': { badge: null,  chips: ['2K'] },
  'Soul 2.0':          { badge: null,  chips: ['4K'] },
  'Flux Kontext':      { badge: null,  chips: ['2K'] },
  'Flux 2':            { badge: null,  chips: ['2K'] },
  'Wan 2.2 Image':     { badge: null,  chips: ['2K'] },
  // Video
  'Kling 3.0':          { badge: 'EXCLUSIVE', chips: ['4K', '3s-15s'] },
  'Kling 2.6':          { badge: null,        chips: ['1080p', '5-10s'] },
  'Veo 3.1':            { badge: null,        chips: ['4K', '4-8s'] },
  'Wan 2.6':            { badge: null,        chips: ['1080p', '5-15s'] },
  'Seedance 2.0':       { badge: 'NEW',       chips: ['720p', '4s-15s'] },
  'Hailuo 2.3':         { badge: null,        chips: ['1080p', '6-10s'] },
  'PixVerse 5':         { badge: null,        chips: ['1080p', '5-10s'] },
  'Sora 2':             { badge: null,        chips: ['1080p', '4-12s'] },
  'Luma Dream Machine': { badge: null,        chips: ['1080p', '5s'] },
};

export default function ModelPicker({ models, value, onChange, onClose, anchorRect }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const filtered = useMemo(
    () => models.filter((m) => m.toLowerCase().includes(q.toLowerCase())),
    [models, q]
  );

  // Position the dropdown in viewport coordinates (fixed) so it pops OUT
  // over the canvas instead of being clipped by the node's overflow:hidden.
  // Opens upward from the model chip; clamps to the viewport.
  const W = 340;
  const left = anchorRect
    ? Math.min(Math.max(8, anchorRect.left), window.innerWidth - W - 8)
    : 100;
  const bottom = anchorRect
    ? Math.max(8, window.innerHeight - anchorRect.top + 8)
    : 100;

  const menu = (
    <div
      ref={ref}
      className="nodrag nowheel"
      style={{
        position: 'fixed', left, bottom, zIndex: 9999,
        width: W, maxHeight: 420, overflowY: 'auto',
        background: 'rgba(18,18,18,0.95)',
        backdropFilter: 'blur(36px) saturate(1.4)', WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16,
        boxShadow: '0 24px 70px rgba(0,0,0,0.7)', padding: 10,
        fontFamily: '"DM Sans", sans-serif',
      }}
    >
      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 10 }}>
        <Search style={{ width: 15, height: 15, color: '#878787' }} />
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 13, fontFamily: 'inherit' }}
        />
      </div>

      {filtered.map((m) => {
        const meta = META[m] || { badge: null, chips: [] };
        const sel = m === value;
        return (
          <button
            key={m}
            onClick={() => { onChange(m); onClose(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
              background: sel ? 'rgba(227,28,28,0.12)' : 'transparent',
              border: `1px solid ${sel ? 'rgba(227,28,28,0.45)' : 'transparent'}`,
              borderRadius: 12, fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{m}</span>
                {meta.badge && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                    color: RED, background: 'rgba(227,28,28,0.15)',
                    border: `1px solid rgba(227,28,28,0.4)`, borderRadius: 5, padding: '2px 6px',
                  }}>{meta.badge}</span>
                )}
              </div>
              {meta.chips.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {meta.chips.map((c) => (
                    <span key={c} style={{
                      fontSize: 10, color: '#aaa', background: 'rgba(255,255,255,0.06)',
                      borderRadius: 5, padding: '2px 7px',
                    }}>{c}</span>
                  ))}
                </div>
              )}
            </div>
            {sel && <Check style={{ width: 16, height: 16, color: RED, flexShrink: 0 }} />}
          </button>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: '#878787', fontSize: 12 }}>No models match.</div>
      )}
    </div>
  );

  // Portal to body so the node's overflow:hidden can't clip it.
  return createPortal(menu, document.body);
}
