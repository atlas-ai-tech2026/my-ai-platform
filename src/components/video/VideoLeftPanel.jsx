// Right-side prompt panel for the Video page.
//
// Visual layer per design_handoff_voxel + VIDEO_PROMPT_PANEL_FINAL.md.
// The OUTER glass surface (380 px wide, rgba(20,18,20,0.38) + blur 36 px,
// radius 22, the multi-layer red-halo shadow) lives in src/pages/Video.jsx
// — this component renders ONLY the inner stack and stays transparent so
// the gallery on the left bleeds through.
//
// All behavior — mode toggle, camera-motion injection at the API
// boundary, frame upload / swap, the audio/res/duration/ratio popovers,
// count stepper, generate handler — is identical to the previous
// version; we only rewrote the rendering.
import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, Minus, Plus, ArrowLeftRight, Zap, Music, Monitor, Clock, RatioIcon, Video } from 'lucide-react';
import { toast } from 'sonner';
import { OptionChip, PopoverChip } from './videoChipAtoms';
import { getVideoCredits } from '@/lib/creditPricing';

const CAMERA_MOTIONS = [
  { id: 'zoom-in',   icon: '🔍+', label: 'Zoom In'   },
  { id: 'zoom-out',  icon: '🔍-', label: 'Zoom Out'  },
  { id: 'pan-left',  icon: '←',   label: 'Pan Left'  },
  { id: 'pan-right', icon: '→',   label: 'Pan Right' },
  { id: 'tilt-up',   icon: '↑',   label: 'Tilt Up'   },
  { id: 'tilt-down', icon: '↓',   label: 'Tilt Down' },
  { id: 'orbit',     icon: '🔄',  label: 'Orbit'     },
  { id: 'handheld',  icon: '📷',  label: 'Handheld'  },
  { id: 'static',    icon: '⊙',   label: 'Static'    },
];

// Per-model duration options derived from FAL's verified schemas
// (2026-05). Sent to FAL as a string enum (without the 's' suffix —
// the frontend strips it via parseInt before posting).
const DEFAULT_DURATIONS = ['5s', '10s'];
const DURATION_OPTIONS_BY_MODEL = {
  // Kling 3.0 family: 3-15 seconds (every integer)
  'kling-3-omni':    ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
  'kling-3':         ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
  // Kling 2.x: 5 or 10 seconds only
  'kling-2-6':       ['5s', '10s'],
  'kling-2-5':       ['5s', '10s'],
  'kling-2-1':       ['5s', '10s'],
  'kling-o1':        ['5s', '10s'],
  // Wan family: 5-15s
  'wan-2-6':         ['5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s'],
  'wan-2-2':         ['5s', '10s'],
  // Veo: short clips
  'veo-3-1':         ['4s', '5s', '6s', '7s', '8s'],
  // kie.ai Veo endpoint prices per generation (duration doesn't change cost)
  'veo-3':           ['4s', '6s', '8s'],
  'veo-3-fast':      ['4s', '6s', '8s'],
  // Sora 2: 4-12s
  'sora-2':          ['4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s'],
  // LTX 2: 6-10s
  'ltx-2':           ['6s', '7s', '8s', '9s', '10s'],
  // Hailuo: 6-10s
  'hailuo-2-3':      ['6s', '7s', '8s', '9s', '10s'],
  // Vidu: 4-8s
  'vidu-q3':         ['4s', '5s', '6s', '7s', '8s'],
  'vidu-q2':         ['5s', '6s', '7s', '8s'],
  // PixVerse: 5-10s
  'pixverse-5':      ['5s', '6s', '7s', '8s', '9s', '10s'],
  // Grok
  'grok-imagine':    ['5s', '10s', '15s'],
};
const getDurationOptions = (modelId) =>
  DURATION_OPTIONS_BY_MODEL[modelId] || DEFAULT_DURATIONS;
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4K'];
const ASPECT_RATIO_OPTIONS = ['Auto', '16:9', '9:16', '1:1', '4:3', '21:9'];

// Brand red palette pulled into local consts so the spec values appear
// inline (and `grep`-ably) at every spec callout below.
const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

export default function VideoLeftPanel({
  prompt, onPromptChange, onGenerate, isGenerating,
  count, onCountChange,
  model, onModelClick,
  duration, onDurationChange,
  resolution, onResolutionChange,
  aspectRatio, onAspectRatioChange,
  startFrame: startFrameProp, endFrame: endFrameProp,
  onStartFrameChange, onEndFrameChange,
  onCameraMotionChange,
}) {
  const [mode, setMode] = useState('frame');
  const [cameraMotion, setCameraMotion] = useState(null);
  const [showCameraDrop, setShowCameraDrop] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [showDurationDrop, setShowDurationDrop] = useState(false);
  const [showResDrop, setShowResDrop] = useState(false);
  const [showRatioDrop, setShowRatioDrop] = useState(false);
  const [localStartFrame, setLocalStartFrame] = useState(null);
  const [localEndFrame, setLocalEndFrame] = useState(null);

  const startFrame = startFrameProp !== undefined ? startFrameProp : localStartFrame;
  const endFrame = endFrameProp !== undefined ? endFrameProp : localEndFrame;
  const setStartFrame = (v) => { setLocalStartFrame(v); onStartFrameChange?.(v); };
  const setEndFrame = (v) => { setLocalEndFrame(v); onEndFrameChange?.(v); };

  const handleFrameUpload = (type, e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (type === 'start') setStartFrame(url);
    else setEndFrame(url);
  };

  const handleSwapFrames = () => {
    const s = startFrame, en = endFrame;
    setStartFrame(en);
    setEndFrame(s);
  };

  const handleCameraSelect = (m) => {
    const next = cameraMotion === m.id ? null : m.id;
    setCameraMotion(next);
    onCameraMotionChange?.(next ? { id: m.id, label: m.label } : null);
    setShowCameraDrop(false);
  };

  const selectedMotion = CAMERA_MOTIONS.find(m => m.id === cameraMotion);
  const canSwap = !!(startFrame || endFrame);

  // Credit cost — driven by the master-plan pricing (model + resolution +
  // duration + audio). null = model not in the plan yet (shows "—").
  const creditCost = getVideoCredits(model?.id, { resolution, duration, audio: audioOn });
  // Visual "incomplete" cue (50% opacity) when prereqs aren't met, but the
  // button is still clickable — onClick now runs the validation and shows
  // a clear toast for whichever piece is missing instead of silently
  // doing nothing. `disabled` is only set while a generation is in flight.
  const prereqsMissing = (mode === 'frame' && !startFrame) || !prompt?.trim();

  const handleGenerateClick = () => {
    if (isGenerating) return;
    if (mode === 'frame' && !startFrame) {
      toast.error('Add a start frame to generate');
      return;
    }
    if (!prompt?.trim()) {
      toast.error('Type a prompt to generate');
      return;
    }
    // Pass the audio toggle up with the cost — the backend needs it so kie
    // generates (and bills) exactly what the user was charged for.
    onGenerate?.(creditCost, { audio: audioOn });
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: '14px 14px 16px',
      // minHeight:100% (not height:100%) so the panel fills a tall viewport
      // but can grow taller than a short one — the parent then scrolls and
      // the GENERATE footer stays reachable.
      minHeight: '100%',
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <style>{`
        .vlf-textarea::placeholder { color: rgba(255,255,255,0.42); font-size: 13px; line-height: 1.5; }
        .vlf-textarea:focus {
          border-color: rgba(224,30,30,0.45) !important;
          box-shadow: 0 0 0 3px rgba(224,30,30,0.12);
          outline: none;
        }
        .vlf-hover:hover { filter: brightness(1.12); }
      `}</style>

      {/* §3.1 — Header: back button + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          aria-label="Back"
          style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
          className="vlf-hover"
        >
          <ArrowLeft style={{ width: 13, height: 13 }} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#FFF' }}>Frame to Video</span>
      </div>

      {/* §3.2 — Mode tiles (Start/End Frame active red, Text dim) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { id: 'frame', icon: '🎞️', label: 'Start/End Frame' },
          { id: 'text',  icon: '📝',  label: 'Text' },
        ].map(tab => {
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              style={{
                padding: '8px 6px', borderRadius: 10,
                background: active
                  ? `linear-gradient(180deg, ${RED}, ${RED_DEEP})`
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? RED_HOT : 'rgba(255,255,255,0.08)'}`,
                color: active ? '#FFF' : 'rgba(255,255,255,0.85)',
                textAlign: 'center', cursor: 'pointer',
                fontSize: 11.5, fontWeight: active ? 700 : 600,
                boxShadow: active
                  ? `0 0 18px rgba(224,30,30,0.45), 0 1px 0 rgba(255,255,255,0.20) inset`
                  : 'none',
                transition: 'filter 0.15s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}
              className="vlf-hover"
            >
              <span style={{
                fontSize: 16, lineHeight: 1,
                filter: active ? 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' : 'none',
              }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* §3.3 — Model row */}
      <button
        onClick={onModelClick}
        style={{
          padding: '8px 10px', borderRadius: 11,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 9,
          cursor: 'pointer', textAlign: 'left',
          transition: 'filter 0.15s',
        }}
        className="vlf-hover"
      >
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'linear-gradient(135deg, #3a5edc, #1a2e8e)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: '#FFF',
          flexShrink: 0,
        }}>
          {(model?.brand || model?.name || 'K').charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)' }}>Model</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#FFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {model?.name || 'Kling 3.0'}
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>›</span>
      </button>

      {/* §3.4 — Set start & end frame (only when in frame mode) */}
      {mode === 'frame' && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#FFF', marginBottom: 6 }}>
            Set start &amp; end frame
          </div>
          <div style={{
            padding: 6, borderRadius: 10,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', gap: 5, alignItems: 'center',
          }}>
            {/* Start uploader */}
            <FrameUploader
              type="start"
              frameUrl={startFrame}
              onUpload={handleFrameUpload}
              onClear={() => setStartFrame(null)}
              dim={false}
              caption="Add a start"
            />

            {/* Swap button */}
            <button
              type="button"
              onClick={handleSwapFrames}
              disabled={!canSwap}
              title="Swap start & end frames"
              aria-label="Swap frames"
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: canSwap ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: canSwap ? 'pointer' : 'not-allowed',
                flexShrink: 0,
                transition: 'filter 0.15s',
              }}
              className={canSwap ? 'vlf-hover' : ''}
            >
              <ArrowLeftRight style={{ width: 13, height: 13 }} />
            </button>

            {/* End uploader (dim until populated) */}
            <FrameUploader
              type="end"
              frameUrl={endFrame}
              onUpload={handleFrameUpload}
              onClear={() => setEndFrame(null)}
              dim={!endFrame}
              caption="Add a end"
            />
          </div>
        </div>
      )}

      {/* §3.5 — Prompt textarea. Fixed 110 px tall (per user request).
          The footer's `marginTop: auto` keeps GENERATE pinned to the
          bottom of the panel; the leftover space sits between the
          options grid and the footer when the panel is taller than
          its content. */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#FFF' }}>Describe your video</span>
          <button
            type="button"
            title="Enhance prompt with AI"
            aria-label="Enhance prompt"
            style={{
              width: 26, height: 26, borderRadius: 7,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(255,255,255,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
            className="vlf-hover"
          >
            <Zap style={{ width: 12, height: 12 }} />
          </button>
        </div>
        <div style={{
          padding: 10, borderRadius: 12,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)',
          height: 110, position: 'relative',
          display: 'flex', flexDirection: 'column',
        }}>
          <textarea
            className="vlf-textarea"
            value={prompt}
            onChange={e => onPromptChange?.(e.target.value)}
            placeholder="Describe the scene transition and camera movement, character action"
            style={{
              width: '100%',
              height: '100%',
              minHeight: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: '#FFF',
              fontSize: 12.5,
              lineHeight: 1.45,
              fontFamily: '"DM Sans", sans-serif',
              caretColor: RED,
              paddingBottom: 32, // make room for the ⚡ pill anchored bottom-left
              boxSizing: 'border-box',
            }}
          />
          {/* Bottom-left enhance affordance pill (red) */}
          <div style={{
            position: 'absolute', bottom: 12, left: 12,
            width: 28, height: 28, borderRadius: 7,
            background: 'rgba(224,30,30,0.18)',
            border: `1px solid rgba(224,30,30,0.55)`,
            color: RED,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
          className="vlf-hover"
          title="Apply prompt enhancer"
          >
            <Zap style={{ width: 13, height: 13 }} />
          </div>
        </div>
      </div>

      {/* §3.6 — Camera Motion row (chevron toggles the existing dropdown) */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setShowCameraDrop(v => !v)}
          style={{
            width: '100%',
            padding: '8px 10px', borderRadius: 10,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, fontWeight: 500,
            color: selectedMotion ? '#FFF' : 'rgba(255,255,255,0.85)',
            cursor: 'pointer', textAlign: 'left',
            transition: 'filter 0.15s',
          }}
          className="vlf-hover"
        >
          <Video style={{ width: 13, height: 13, color: selectedMotion ? RED : 'rgba(255,255,255,0.7)' }} />
          <span>{selectedMotion ? `Camera Motion · ${selectedMotion.label}` : 'Camera Motion'}</span>
          <ChevronDown
            style={{
              marginLeft: 'auto', width: 14, height: 14,
              color: 'rgba(255,255,255,0.5)',
              transform: showCameraDrop ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.18s',
            }}
          />
        </button>
        {showCameraDrop && (
          <div style={{
            marginTop: 6, padding: 8,
            borderRadius: 12,
            background: 'rgba(20,18,20,0.6)',
            border: '1px solid rgba(255,255,255,0.10)',
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
          }}>
            {CAMERA_MOTIONS.map(m => {
              const active = cameraMotion === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleCameraSelect(m)}
                  style={{
                    padding: '8px 6px', borderRadius: 8,
                    background: active ? 'rgba(224,30,30,0.18)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${active ? RED : 'rgba(255,255,255,0.08)'}`,
                    color: active ? '#FFF' : 'rgba(255,255,255,0.65)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    cursor: 'pointer', fontSize: 10,
                  }}
                  className="vlf-hover"
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{m.icon}</span>
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* §3.7 — Options chip grid (Audio / Res / Duration / Ratio) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
        <OptionChip
          icon="♪"
          label="Audio"
          value={audioOn ? 'On' : 'Off'}
          toggle
          on={audioOn}
          onToggle={() => setAudioOn(v => !v)}
        />
        <PopoverChip
          icon="🖥"
          label="Res"
          value={resolution || '1080p'}
          options={RESOLUTION_OPTIONS}
          open={showResDrop}
          onToggle={() => { setShowResDrop(v => !v); setShowDurationDrop(false); setShowRatioDrop(false); }}
          onSelect={v => { onResolutionChange?.(v); setShowResDrop(false); }}
          selected={resolution}
        />
        <PopoverChip
          icon="⏱"
          label="Duration"
          value={duration || '5s'}
          options={getDurationOptions(model?.id)}
          open={showDurationDrop}
          onToggle={() => { setShowDurationDrop(v => !v); setShowResDrop(false); setShowRatioDrop(false); }}
          onSelect={v => { onDurationChange?.(v); setShowDurationDrop(false); }}
          selected={duration}
        />
        <PopoverChip
          icon="▭"
          label="Ratio"
          value={aspectRatio || '16:9'}
          options={ASPECT_RATIO_OPTIONS}
          open={showRatioDrop}
          onToggle={() => { setShowRatioDrop(v => !v); setShowResDrop(false); setShowDurationDrop(false); }}
          onSelect={v => { onAspectRatioChange?.(v); setShowRatioDrop(false); }}
          selected={aspectRatio || 'Auto'}
        />
      </div>

      {/* §3.8 — Count stepper + GENERATE capsule. Both 32 px tall.
          Generate's `disabled` is intentionally NOT set when prereqs
          (prompt / start frame) are missing — only when `isGenerating`.
          The click handler runs the validation and shows a clear toast
          for whichever prerequisite is missing, so the user gets
          actionable feedback instead of a silent dim button. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {/* Count stepper — single bordered row */}
        <div style={{
          display: 'flex', alignItems: 'center',
          border: '1px solid rgba(255,255,255,0.10)', borderRadius: 9,
          overflow: 'hidden',
        }}>
          <button
            type="button"
            onClick={() => onCountChange?.(Math.max(1, (count || 1) - 1))}
            style={{
              padding: '0 8px', height: 28,
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          ><Minus style={{ width: 10, height: 10 }} /></button>
          <div style={{
            padding: '0 8px', height: 28,
            display: 'flex', alignItems: 'center',
            fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: '#FFF',
            borderLeft: '1px solid rgba(255,255,255,0.10)',
            borderRight: '1px solid rgba(255,255,255,0.10)',
          }}>{count || 1} / 4</div>
          <button
            type="button"
            onClick={() => onCountChange?.(Math.min(4, (count || 1) + 1))}
            style={{
              padding: '0 8px', height: 28,
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          ><Plus style={{ width: 10, height: 10 }} /></button>
        </div>

        {/* GENERATE capsule — clickable always (handler shows toast on missing prereqs) */}
        <button
          type="button"
          onClick={handleGenerateClick}
          disabled={isGenerating}
          style={{
            flex: 1, height: 28, borderRadius: 8, border: 'none',
            background: isGenerating
              ? 'rgba(139,15,15,0.6)'
              : `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`,
            color: '#FFF',
            fontFamily: 'Anton, sans-serif',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            cursor: isGenerating ? 'not-allowed' : 'pointer',
            opacity: prereqsMissing && !isGenerating ? 0.7 : 1,
            boxShadow: isGenerating ? 'none' : `
              0 0 22px rgba(224,30,30,0.53),
              0 4px 10px rgba(139,15,15,0.5),
              0 1px 0 rgba(255,255,255,0.25) inset
            `,
            transition: 'box-shadow 0.18s, transform 0.15s, opacity 0.18s',
          }}
          onMouseEnter={e => { if (!isGenerating) { e.currentTarget.style.boxShadow = '0 0 28px rgba(224,30,30,0.7), 0 6px 14px rgba(139,15,15,0.6), 0 1px 0 rgba(255,255,255,0.3) inset'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
          onMouseLeave={e => { if (!isGenerating) { e.currentTarget.style.boxShadow = '0 0 22px rgba(224,30,30,0.53), 0 4px 10px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset'; e.currentTarget.style.transform = 'none'; }}}
        >
          <span>{isGenerating ? 'Generating' : 'Generate'}</span>
          {!isGenerating && (
            <span style={{ fontSize: 12 }} title="Estimated credit cost">
              ✦ {creditCost ?? '—'}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Atom: frame uploader (start / end) ────────────────────────────────
// Pulled out so the JSX above stays readable.
function FrameUploader({ type, frameUrl, onUpload, onClear, dim, caption }) {
  return (
    <div
      style={{
        // Explicit short height (78 px) instead of an aspect ratio —
        // 4/3 made the boxes ~150 px tall in a 380-wide panel which
        // chewed up the prompt textarea space.
        flex: 1, height: 78, borderRadius: 10,
        background: dim ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${dim ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.06)'}`,
        position: 'relative', overflow: 'hidden',
      }}
    >
      {frameUrl ? (
        <>
          <img
            src={frameUrl}
            alt={`${type} frame`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear frame"
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 22, height: 22, borderRadius: '50%',
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#FFF', fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </>
      ) : (
        <label style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, cursor: 'pointer',
          color: dim ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.7)',
          fontSize: 10.5, fontWeight: 500, lineHeight: 1.25,
          padding: '0 8px',
        }}>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => onUpload(type, e)}
          />
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: dim ? 'rgba(139,15,15,0.45)' : RED,
            color: dim ? 'rgba(255,255,255,0.65)' : '#FFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 300, flexShrink: 0,
            boxShadow: dim ? 'none' : `0 0 10px rgba(224,30,30,0.4)`,
          }}>+</div>
          <div style={{ fontSize: 10 }}>{caption}<br/>frame</div>
        </label>
      )}
    </div>
  );
}

