// Top-right pill row on the Audio page (Voice / Music / SFX / Lipsync).
// Voice is the only fully-wired mode in v1; the others swap a placeholder
// label in the stage but otherwise share the same chrome.
import React from 'react';

const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

const TABS = [
  { id: 'voice',   label: 'Voice'   },
  { id: 'music',   label: 'Music'   },
  { id: 'sfx',     label: 'SFX'     },
  { id: 'lipsync', label: 'Lipsync' },
];

export default function AudioModeTabs({ active, onChange }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 8 }}>
      {TABS.map(tab => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange?.(tab.id)}
            style={{
              padding: '7px 16px', borderRadius: 999,
              fontFamily: '"DM Sans", sans-serif',
              fontSize: 12.5, fontWeight: 600,
              border: isActive
                ? `1px solid ${RED_HOT}`
                : '1px solid rgba(255,255,255,0.10)',
              background: isActive
                ? `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`
                : 'rgba(255,255,255,0.05)',
              color: isActive ? '#FFF' : 'rgba(255,255,255,0.7)',
              boxShadow: isActive
                ? `0 0 14px rgba(224,30,30,0.45), 0 4px 10px rgba(139,15,15,0.4), inset 0 1px 0 rgba(255,255,255,0.18)`
                : 'none',
              cursor: 'pointer',
              transition: 'transform 0.15s, filter 0.15s, box-shadow 0.18s',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.filter = 'brightness(1.15)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.filter = 'none'; }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
