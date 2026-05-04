// Tiny segmented control above the style sliders. Two ElevenLabs TTS
// models behind the Audio page:
//
//   - eleven-v3        — latest, fast, expressive. Schema: text + voice
//                        + stability + language. Similarity / Style get
//                        ignored, so the panel dims those two sliders.
//   - multilingual-v2  — older but accepts the full Stability + Similarity
//                        + Style trio. Pick this if those two sliders
//                        matter to your take.
//
// Sending the chosen id to the backend lets /api/tts route to the right
// FAL endpoint and strip the ignored fields from the payload.
import React from 'react';

const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

export const TTS_MODEL_OPTIONS = [
  { id: 'eleven-v3',       name: 'Eleven V3',       badge: 'LATEST', desc: 'Fast · expressive · Stability only' },
  { id: 'multilingual-v2', name: 'Multilingual V2', badge: null,     desc: 'Full Stability + Similarity + Style' },
];

export default function AudioModelPicker({ value, onChange }) {
  return (
    <div>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        marginBottom: 6,
      }}>Model</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
      }}>
        {TTS_MODEL_OPTIONS.map(m => {
          const active = value === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange?.(m.id)}
              title={m.desc}
              style={{
                position: 'relative',
                padding: '9px 10px',
                borderRadius: 10,
                background: active
                  ? `linear-gradient(180deg, rgba(255,42,42,0.18), rgba(139,15,15,0.12))`
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? RED : 'rgba(255,255,255,0.08)'}`,
                color: '#FFF',
                cursor: 'pointer',
                textAlign: 'left',
                boxShadow: active ? `0 0 12px rgba(224,30,30,0.4)` : 'none',
                transition: 'background 0.15s, border-color 0.15s, box-shadow 0.18s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{m.name}</span>
                {m.badge && (
                  <span style={{
                    padding: '1px 5px', borderRadius: 4,
                    background: 'rgba(224,30,30,0.22)',
                    border: '1px solid rgba(224,30,30,0.45)',
                    color: '#FF7878',
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.06em',
                  }}>{m.badge}</span>
                )}
              </div>
              <div style={{
                fontSize: 9.5, color: 'rgba(255,255,255,0.55)',
                marginTop: 2, lineHeight: 1.3,
              }}>{m.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
