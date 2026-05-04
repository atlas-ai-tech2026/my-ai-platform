// Small visual atoms scoped to the Voice Canvas waveform stage. Pulled
// out so WaveformStage.jsx itself stays under the 300-line cap and reads
// as a top-down composition: header → ruler → bars/region/playhead →
// transport.
import React from 'react';

const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

const RULER_TICKS = [0, 3, 6, 9, 12, 15, 18];

// Format seconds as mm:ss[.mmm] (mono numerics).
export function fmtTime(sec, withMs = false) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  if (!withMs) {
    return `${String(m).padStart(2, '0')}:${String(Math.floor(r)).padStart(2, '0')}`;
  }
  const whole = Math.floor(r);
  const ms = Math.floor((r - whole) * 1000);
  return `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function TrackHeader({ trackTitle, voiceLabel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 14px rgba(224,30,30,0.45), inset 0 1px 0 rgba(255,255,255,0.2)',
        flexShrink: 0,
        color: '#FFF', fontSize: 18, lineHeight: 1,
      }}>♪</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>{trackTitle}</div>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10.5, color: 'rgba(255,255,255,0.55)',
          letterSpacing: '0.06em',
          marginTop: 2,
        }}>{voiceLabel}</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {['Solo', 'Mute', 'Export'].map(label => (
          <button
            key={label}
            type="button"
            style={{
              padding: '6px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: 11, fontWeight: 600,
              fontFamily: '"DM Sans", sans-serif',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          >{label}</button>
        ))}
      </div>
    </div>
  );
}

export function TimeRuler() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 9.5,
      color: 'rgba(255,255,255,0.45)',
      letterSpacing: '0.14em',
      padding: '0 4px',
    }}>
      {RULER_TICKS.map(t => (
        <span key={t}>{`00:${String(t).padStart(2, '0')}`}</span>
      ))}
    </div>
  );
}

export function LevelMeter() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 22 }}>
      {[0, 1, 2, 3, 4].map(i => {
        const lit = i < 4;
        return (
          <div key={i} style={{
            width: 4, height: 16, borderRadius: 1,
            background: lit
              ? 'linear-gradient(180deg, #E01E1E, transparent)'
              : 'rgba(255,255,255,0.10)',
          }} />
        );
      })}
    </div>
  );
}

export function TransportGhost({ icon, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.10)',
        color: 'rgba(255,255,255,0.85)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
    >{icon}</button>
  );
}
