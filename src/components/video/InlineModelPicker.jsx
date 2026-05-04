// Tiny model picker overlay used by the Edit Video and Motion Control
// tabs. Slides in over the left panel — feels closer to a popover than
// the full-screen VideoModelModal. Each model row gets a stylised "K"
// glyph (red ring), name, one-line description, optional "Exclusive"
// pill, and a check on the active row.
//
// Caller passes the exact 2-row list it wants — InlineModelPicker
// doesn't know which models go where.
import React from 'react';
import { Check, Search, X } from 'lucide-react';

const RED = '#E01E1E';

export default function InlineModelPicker({ open, models, selected, onSelect, onClose }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'flex-start',
        animation: 'voxel-fade 0.18s ease',
      }}
    >
      <style>{`
        @keyframes voxel-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes voxel-slide { from { transform: translateX(-12px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          background: 'rgba(20,18,20,0.97)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', flexDirection: 'column',
          fontFamily: '"DM Sans", sans-serif',
          animation: 'voxel-slide 0.22s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 14px 10px',
          display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#FFF', flex: 1 }}>
            🎥 All models
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 26, height: 26, borderRadius: 7,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.75)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><X style={{ width: 12, height: 12 }} /></button>
        </div>

        {/* Search (display-only — picker has 2 rows so no real filter is needed) */}
        <div style={{ padding: '10px 14px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 9,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            <Search style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.4)' }} />
            <input
              type="text"
              placeholder="Search models"
              style={{
                background: 'transparent', border: 'none', outline: 'none',
                color: '#FFF', fontSize: 12, flex: 1,
                fontFamily: '"DM Sans", sans-serif',
              }}
            />
          </div>
        </div>

        {/* Model rows */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 8px 14px' }}>
          {models.map(m => {
            const active = selected === m.name;
            return (
              <button
                key={m.name}
                type="button"
                onClick={() => onSelect?.(m.name)}
                style={{
                  width: '100%', padding: '10px 10px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: active ? 'rgba(224,30,30,0.14)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(224,30,30,0.45)' : 'transparent'}`,
                  borderRadius: 10, cursor: 'pointer',
                  textAlign: 'left', marginBottom: 4,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'radial-gradient(circle at 30% 30%, #2a1414, #120808)',
                  border: `1.5px solid ${RED}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  color: '#FFF', fontWeight: 800, fontSize: 14,
                  fontFamily: 'Anton, sans-serif',
                  boxShadow: '0 0 10px rgba(224,30,30,0.35)',
                }}>K</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#FFF' }}>{m.name}</span>
                    {m.exclusive && (
                      <span style={{
                        padding: '1px 7px', borderRadius: 4,
                        background: 'rgba(224,30,30,0.18)',
                        border: '1px solid rgba(224,30,30,0.4)',
                        color: '#FF7878', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                      }}>EXCLUSIVE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{m.description}</div>
                </div>
                {active && <Check style={{ width: 14, height: 14, color: RED, flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
