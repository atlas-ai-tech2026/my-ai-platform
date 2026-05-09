// Glass-shell right column on the Audio page when mode === 'music'.
// Wired to /api/generate-music → fal-ai/lyria2.
import React from 'react';
import { Music, Sparkles } from 'lucide-react';

const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

const PROMPT_PRESETS = [
  'Lush ambient soundscape with a flowing river, distant birds, and a slow melancholic piano melody',
  'Driving electronic beat with deep synth bass, shimmering pads, 120 BPM, cinematic build-up',
  'Warm jazz trio — upright bass, brushed drums, soft Rhodes piano, late-night lounge feel',
  'Epic orchestral cue — strings, brass swells, taiko drums, heroic and triumphant',
];

export default function MusicPromptPanel({
  prompt, onPromptChange,
  negativePrompt, onNegativePromptChange,
  onGenerate, isGenerating,
}) {
  const trimmed = (prompt || '').trim();
  const canGenerate = trimmed.length > 0 && !isGenerating;

  return (
    <div className="voxel-script-scroll" style={{
      background: 'rgba(20,18,20,0.38)',
      backdropFilter: 'blur(36px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
      border: '1px solid rgba(255,255,255,0.10)',
      boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.10) inset, 0 0 60px rgba(224,30,30,0.08)',
      borderRadius: 18,
      padding: 14,
      display: 'flex', flexDirection: 'column', gap: 12,
      minHeight: 0,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    }}>
      <style>{`
        .voxel-script-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(224,30,30,0.6) rgba(255,255,255,0.05);
        }
        .voxel-script-scroll::-webkit-scrollbar { width: 8px; }
        .voxel-script-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); }
        .voxel-script-scroll::-webkit-scrollbar-thumb {
          background: rgba(224,30,30,0.6); border-radius: 4px;
        }
      `}</style>

      {/* Model badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(224,30,30,0.15)',
          border: '1px solid rgba(224,30,30,0.35)',
        }}>
          <Music style={{ width: 16, height: 16, color: '#fff' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 13, fontWeight: 600, color: '#FFF',
            letterSpacing: '-0.01em',
          }}>
            Google Lyria 2
          </div>
          <div style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 11, color: 'rgba(255,255,255,0.55)',
            marginTop: 1,
          }}>
            48kHz WAV · 30 seconds
          </div>
        </div>
      </div>

      {/* Prompt label */}
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        letterSpacing: '0.18em', textTransform: 'uppercase',
      }}>
        Prompt
      </div>

      {/* Prompt textarea */}
      <textarea
        value={prompt}
        onChange={e => onPromptChange(e.target.value)}
        placeholder="Describe the music — genre, mood, instruments, tempo, soundscape…"
        rows={6}
        style={{
          width: '100%',
          minHeight: 120,
          background: 'rgba(0,0,0,0.32)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 12,
          padding: '12px 14px',
          color: '#FFF',
          fontFamily: 'Inter, sans-serif',
          fontSize: 14, lineHeight: 1.5,
          resize: 'vertical',
          outline: 'none',
        }}
      />

      {/* Presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PROMPT_PRESETS.map((p, i) => (
          <button
            key={i}
            onClick={() => onPromptChange(p)}
            type="button"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 11, fontWeight: 500,
              color: 'rgba(255,255,255,0.75)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 9999,
              padding: '5px 10px',
              cursor: 'pointer',
              maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            title={p}
          >
            {p.split(' ').slice(0, 4).join(' ')}…
          </button>
        ))}
      </div>

      {/* Negative prompt label */}
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        letterSpacing: '0.18em', textTransform: 'uppercase',
        marginTop: 4,
      }}>
        Negative prompt — exclude
      </div>

      <input
        type="text"
        value={negativePrompt}
        onChange={e => onNegativePromptChange(e.target.value)}
        placeholder="vocals, slow tempo, low quality"
        style={{
          width: '100%',
          background: 'rgba(0,0,0,0.32)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 12,
          padding: '10px 14px',
          color: '#FFF',
          fontFamily: 'Inter, sans-serif',
          fontSize: 13,
          outline: 'none',
        }}
      />

      <div style={{ flex: 1 }} />

      {/* Generate CTA */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          width: '100%',
          height: 50,
          borderRadius: 12,
          border: 'none',
          background: canGenerate
            ? `linear-gradient(135deg, ${RED_HOT} 0%, ${RED_DEEP} 100%)`
            : 'rgba(255,255,255,0.06)',
          color: '#FFF',
          fontFamily: 'Inter, sans-serif',
          fontSize: 14, fontWeight: 700,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: canGenerate
            ? '0 10px 30px rgba(224,30,30,0.35), inset 0 1px 0 rgba(255,255,255,0.18)'
            : 'none',
          transition: 'transform 0.12s ease',
        }}
      >
        {isGenerating ? (
          <>
            <span className="voxel-music-spinner" style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.3)',
              borderTopColor: '#FFF',
              animation: 'voxel-music-spin 0.8s linear infinite',
            }} />
            Generating
          </>
        ) : (
          <>
            <Sparkles style={{ width: 16, height: 16 }} />
            Generate Music
          </>
        )}
      </button>

      <style>{`
        @keyframes voxel-music-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
