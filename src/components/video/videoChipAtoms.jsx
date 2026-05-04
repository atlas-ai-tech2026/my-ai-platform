// Shared chip atoms for the Video page panels (Create / Edit / Motion).
//
// Lifted verbatim from VideoLeftPanel.jsx so all three left panels render
// identical chip styling. Both panels used to keep their own copies —
// VideoLeftPanel had OptionChip + PopoverChip, KlingMotionLeftPanel had
// a slightly different inline PopoverChip; this file is the single
// source of truth so visual drift can't happen again.
//
// Brand red is inlined in the dropdown's "active" highlight so callers
// don't have to thread a colour prop just to keep the look consistent.
import React from 'react';

const RED = '#E01E1E';

// Faint glass row with caption + value, optional toggle. Used both
// standalone (Audio toggle, etc.) and as the visible head of PopoverChip.
export function OptionChip({ icon, label, value, toggle = false, on = false, onToggle, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '5px 7px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        cursor: onClick || toggle ? 'pointer' : 'default',
        transition: 'filter 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>
        <span style={{ fontSize: 9.5 }}>{icon}</span>{label}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: '#FFF',
        display: 'flex', alignItems: 'center', marginTop: 1,
      }}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
        {toggle && (
          <span
            onClick={e => { e.stopPropagation(); onToggle?.(); }}
            style={{
              marginLeft: 'auto', width: 22, height: 12, borderRadius: 10,
              background: on ? RED : 'rgba(255,255,255,0.18)',
              position: 'relative', flexShrink: 0,
              transition: 'background 0.18s',
            }}
          >
            <span style={{
              position: 'absolute', left: on ? 11 : 1, top: 1,
              width: 10, height: 10, borderRadius: '50%', background: '#FFF',
              transition: 'left 0.18s',
            }} />
          </span>
        )}
      </div>
    </div>
  );
}

// OptionChip + dropdown popover. Used for Res / Duration / Ratio.
export function PopoverChip({ icon, label, value, options, open, onToggle, onSelect, selected }) {
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <OptionChip icon={icon} label={label} value={value} onClick={onToggle} />
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'rgba(20,18,20,0.96)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 10, overflow: 'hidden',
          zIndex: 30,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}>
          {options.map(opt => {
            const active = (selected || '') === opt;
            return (
              <div
                key={opt}
                onClick={() => onSelect(opt)}
                style={{
                  padding: '9px 12px', fontSize: 12,
                  color: active ? '#FFF' : 'rgba(255,255,255,0.65)',
                  background: active ? 'rgba(224,30,30,0.15)' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: '"DM Sans", sans-serif',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >{opt}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
