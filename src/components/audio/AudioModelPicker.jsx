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
        fontSize: 9, color: 'rgba(255,255,255,0.55)',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        marginBottom: 4,
      }}>Model</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 5,
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
                padding: '6px 8px',
                borderRadius: 8,
                background: active
                  ? `linear-gradient(180deg, rgba(255,42,42,0.18), rgba(139,15,15,0.12))`
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? RED : 'rgba(255,255,255,0.08)'}`,
                color: '#FFF',
                cursor: 'pointer',
                textAlign: 'left',
                boxShadow: active ? `0 0 10px rgba(224,30,30,0.35)` : 'none',
                transition: 'background 0.15s, border-color 0.15s, box-shadow 0.18s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{m.name}</span>
                {m.badge && (
                  <span style={{
                    padding: '1px 4px', borderRadius: 3,
                    background: 'rgba(224,30,30,0.22)',
                    border: '1px solid rgba(224,30,30,0.45)',
                    color: '#FF7878',
                    fontSize: 7.5, fontWeight: 800, letterSpacing: '0.05em',
                  }}>{m.badge}</span>
                )}
              </div>
              {/* Compact one-liner — full description still in the title
                  attribute as a hover tooltip. */}
              <div style={{
                fontSize: 8.5, color: 'rgba(255,255,255,0.5)',
                marginTop: 1, lineHeight: 1.2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{m.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
