// Top-tab nav for the Video page (Higgsfield-parity layout, brand red).
//
// Three text pills, no background fill. Active tab = white text + 2 px
// red `#E01E1E` underline. Inactive = rgba(255,255,255,0.55). The tab
// id values are the source of truth in src/pages/Video.jsx
// ('create' | 'edit' | 'motion'); the page maps each id to which left
// panel renders and which model name is sent to the backend.
import React from 'react';

const RED = '#E01E1E';

const TABS = [
  { id: 'create', label: 'Create Video' },
  { id: 'edit',   label: 'Edit Video'   },
  { id: 'motion', label: 'Motion Control' },
];

export default function VideoTopTabs({ active, onChange }) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex', gap: 28,
        padding: '14px 28px 0',
        fontFamily: '"DM Sans", sans-serif',
        position: 'relative', zIndex: 3,
      }}
    >
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
              padding: '6px 0 10px',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${isActive ? RED : 'transparent'}`,
              color: isActive ? '#FFF' : 'rgba(255,255,255,0.55)',
              fontSize: 14,
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
