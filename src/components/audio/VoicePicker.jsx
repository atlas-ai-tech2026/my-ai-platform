// Voice picker — the row at the top of the Script panel that opens an
// inline popover listing voices. Each row has a 32 px round avatar (the
// brand red ring is reused later for model rows), name + description,
// and a 28-bar mini-waveform preview with a ▶ button.
//
// No popover primitive in src/components/ui/, so this owns its own
// click-outside dismissal via a backdrop layer (z-index above the panel).
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, ChevronRight, Check } from 'lucide-react';

const RED = '#E01E1E';

// Official ElevenLabs library voices (the publicly published roster).
// `name` is what FAL accepts as the `voice` field — the API takes the
// human name OR the voice_id; sticking with names keeps the JSON in
// history readable. The `voice_id` is here for posterity / for switching
// to ID-based addressing if a name collides with a custom-cloned voice.
//
// The `gradient` is just decorative — gives each avatar a distinct hue.
const VOICES = [
  { name: 'Rachel',    voice_id: '21m00Tcm4TlvDq8ikWAM', desc: 'Warm, conversational',   accent: 'American',   gradient: 'linear-gradient(135deg, #d96b3a, #6e2a14)', seed: 33 },
  { name: 'Adam',      voice_id: 'pNInz6obpgDQGcFmaJgB', desc: 'Deep, calm',             accent: 'American',   gradient: 'linear-gradient(135deg, #5a3a8e, #2a1a4e)', seed: 7  },
  { name: 'Bella',     voice_id: 'EXAVITQu4vr4xnSDxMaL', desc: 'Bright, expressive',     accent: 'American',   gradient: 'linear-gradient(135deg, #c54a8a, #5a1a3e)', seed: 13 },
  { name: 'Antoni',    voice_id: 'ErXwobaYiN019PkySvjV', desc: 'Smooth, mid-range',      accent: 'American',   gradient: 'linear-gradient(135deg, #4a7ad9, #1a2e6b)', seed: 41 },
  { name: 'Domi',      voice_id: 'AZnzlk1XvdvUeBnXmlld', desc: 'Confident, narrative',   accent: 'American',   gradient: 'linear-gradient(135deg, #3aa8b0, #1a4a4e)', seed: 21 },
  { name: 'Elli',      voice_id: 'MF3mGyEYCl7XYWbV9V6O', desc: 'Young, emotional',       accent: 'American',   gradient: 'linear-gradient(135deg, #b0c54a, #4e5a1a)', seed: 53 },
  { name: 'Josh',      voice_id: 'TxGEqnHWrfWFTfGW9XjX', desc: 'Deep, authoritative',    accent: 'American',   gradient: 'linear-gradient(135deg, #3a5edc, #1a2e8e)', seed: 65 },
  { name: 'Arnold',    voice_id: 'VR6AewLTigWG4xSOukaG', desc: 'Crisp, narrator',        accent: 'American',   gradient: 'linear-gradient(135deg, #6b3a8e, #2a1a4e)', seed: 77 },
  { name: 'Nicole',    voice_id: 'piTKgcLEGmPE4e6mEKli', desc: 'Whispery, ASMR',         accent: 'American',   gradient: 'linear-gradient(135deg, #b0498a, #4e1a3e)', seed: 89 },
  { name: 'Charlotte', voice_id: 'XB0fDUnXU5powFXDhCwa', desc: 'Sultry, mature',         accent: 'British',    gradient: 'linear-gradient(135deg, #a83a3a, #4e1414)', seed: 101 },
  { name: 'Bill',      voice_id: 'pqHfZKP75CvOlQylNhV4', desc: 'Friendly, mature',       accent: 'American',   gradient: 'linear-gradient(135deg, #3a8e6b, #1a4e3e)', seed: 113 },
  { name: 'Charlie',   voice_id: 'IKne3meq5aSn9XLyUdCD', desc: 'Casual, conversational', accent: 'Australian', gradient: 'linear-gradient(135deg, #d99c3a, #6e5014)', seed: 125 },
];

// Deterministic pseudo-random amplitudes so each voice's mini preview is
// stable across renders without needing a real audio buffer.
function miniBars(seed, count = 28) {
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 22, flex: 1 }}>
      {bars.map((v, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${v * 100}%`,
          borderRadius: 1,
          background: active
            ? 'linear-gradient(180deg, #FF5050, #8B0F0F)'
            : 'rgba(255,255,255,0.32)',
        }} />
      ))}
    </div>
  );
}

export default function VoicePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // `value` is a voice name string (e.g. "Rachel"). Voice names are also
  // what we send to the FAL `voice` field, so the parent stays in
  // human-readable territory.
  const current = VOICES.find(v => v.name === value) || VOICES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Trigger pill */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px',
          borderRadius: 12,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'filter 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: current.gradient,
          flexShrink: 0,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10, color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>Voice</div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#FFF',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{current.name} · {current.desc}</div>
        </div>
        <span style={{
          padding: '1px 6px', borderRadius: 4,
          background: 'rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.6)',
          fontSize: 9, fontWeight: 600,
          letterSpacing: '0.05em',
          flexShrink: 0,
        }}>{current.accent}</span>
        <ChevronRight style={{ width: 16, height: 16, color: 'rgba(255,255,255,0.5)' }} />
      </button>

      {/* Popover */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: 'rgba(20,18,20,0.97)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 14,
          boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
          zIndex: 30,
          maxHeight: 320, overflowY: 'auto',
          padding: 6,
        }}>
          {VOICES.map(v => {
            const isActive = v.name === current.name;
            return (
              <div
                key={v.name}
                onClick={() => { onChange?.(v.name); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 10,
                  cursor: 'pointer',
                  background: isActive ? 'rgba(224,30,30,0.12)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(224,30,30,0.4)' : 'transparent'}`,
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: v.gradient, flexShrink: 0,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
                }} />
                <div style={{ minWidth: 0, width: 110 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#FFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.desc}</span>
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 8.5, color: 'rgba(255,255,255,0.45)',
                    letterSpacing: '0.05em',
                  }}>{v.accent}</div>
                </div>
                <MiniWave seed={v.seed} active={isActive} />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); }}
                  aria-label={`Preview ${v.name}`}
                  style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: isActive ? RED : 'rgba(255,255,255,0.08)',
                    border: 'none',
                    color: '#FFF',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: isActive ? '0 0 10px rgba(224,30,30,0.6)' : 'none',
                  }}
                ><Play style={{ width: 11, height: 11, marginLeft: 1 }} fill="currentColor" /></button>
                {isActive && <Check style={{ width: 13, height: 13, color: RED, flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
