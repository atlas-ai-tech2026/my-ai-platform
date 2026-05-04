// Header strip at the top of the VoicePicker popover. Counter pill +
// search input + accent filter chips + multilingual hint banner.
// Lifted out of VoicePicker so the file stays under the 300-line cap.
import React from 'react';
import { Search } from 'lucide-react';

export default function VoicePopoverHeader({
  total, shown,
  query, onQueryChange,
  accent, onAccentChange,
  accents,
}) {
  return (
    <div style={{
      padding: 10, flexShrink: 0,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10, color: 'rgba(255,255,255,0.55)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>All voices</span>
        <span style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10, color: '#FFF', fontWeight: 700,
          padding: '2px 7px', borderRadius: 999,
          background: 'rgba(224,30,30,0.18)',
          border: '1px solid rgba(224,30,30,0.4)',
        }}>{shown} / {total}</span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 9,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}>
        <Search style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.4)' }} />
        <input
          type="text"
          value={query}
          onChange={e => onQueryChange?.(e.target.value)}
          placeholder={`Search ${total} voices…`}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: '#FFF', fontSize: 12, flex: 1,
            fontFamily: '"DM Sans", sans-serif',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {accents.map(a => {
          const isActive = a === accent;
          return (
            <button
              key={a}
              type="button"
              onClick={() => onAccentChange?.(a)}
              style={{
                padding: '3px 9px', borderRadius: 999,
                fontSize: 10, fontWeight: 600,
                background: isActive ? 'rgba(224,30,30,0.18)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isActive ? 'rgba(224,30,30,0.5)' : 'rgba(255,255,255,0.08)'}`,
                color: isActive ? '#FFF' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >{a}</button>
          );
        })}
      </div>

      <div style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        padding: '4px 2px', lineHeight: 1.45,
      }}>
        💡 All voices speak <b style={{ color: '#FFF' }}>30+ languages</b> including Arabic, Spanish, French, Japanese — pick the language in the <b style={{ color: '#FFF' }}>Language</b> picker below.
      </div>
    </div>
  );
}
