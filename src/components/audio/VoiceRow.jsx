// One row in the VoicePicker popover. Avatar + name/desc/accent + mini
// preview waveform + ▶/▮▮/loading button + selected check. Lifted out of
// VoicePicker so VoicePicker.jsx stays focused on search + state.
import React, { useMemo } from 'react';
import { Play, Pause, Check, Loader2 } from 'lucide-react';

const RED = '#E01E1E';

function miniBars(seed, count = 22) {
  const out = [];
  let x = seed;
  for (let i = 0; i < count; i++) {
    x = (x * 9301 + 49297) % 233280;
    out.push(0.25 + (x / 233280) * 0.75);
  }
  return out;
}

function MiniWave({ seed, active }) {
  const bars = useMemo(() => miniBars(seed), [seed]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 20, flex: 1 }}>
      {bars.map((v, i) => (
        <div key={i} style={{
          flex: 1, height: `${v * 100}%`, borderRadius: 1,
          background: active
            ? 'linear-gradient(180deg, #FF5050, #8B0F0F)'
            : 'rgba(255,255,255,0.32)',
        }} />
      ))}
    </div>
  );
}

export default function VoiceRow({ voice, isActive, isLoading, isPlaying, onSelect, onPreview }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
        background: isActive ? 'rgba(224,30,30,0.12)' : 'transparent',
        border: `1px solid ${isActive ? 'rgba(224,30,30,0.4)' : 'transparent'}`,
        transition: 'background 0.12s',
        marginBottom: 2,
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: voice.gradient, flexShrink: 0,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
      }} />
      <div style={{ minWidth: 0, width: 110 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#FFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{voice.name}</div>
        <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{voice.desc}</div>
        <div style={{
          marginTop: 2,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 8.5, color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.05em',
        }}>{voice.accent}</div>
      </div>
      <MiniWave seed={voice.seed} active={isPlaying} />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPreview?.(); }}
        aria-label={isPlaying ? `Stop ${voice.name}` : `Preview ${voice.name}`}
        title={isPlaying ? 'Stop' : 'Preview voice'}
        style={{
          width: 28, height: 28, borderRadius: '50%',
          background: isPlaying || isActive ? RED : 'rgba(255,255,255,0.08)',
          border: 'none', color: '#FFF',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: isPlaying || isActive ? '0 0 10px rgba(224,30,30,0.6)' : 'none',
          transition: 'background 0.15s, box-shadow 0.18s',
        }}
      >
        {isLoading ? <Loader2 className="anim-spin" style={{ width: 12, height: 12 }} />
          : isPlaying ? <Pause style={{ width: 11, height: 11 }} fill="currentColor" />
          : <Play style={{ width: 11, height: 11, marginLeft: 1 }} fill="currentColor" />}
      </button>
      {isActive && <Check style={{ width: 13, height: 13, color: RED, flexShrink: 0 }} />}
    </div>
  );
}
