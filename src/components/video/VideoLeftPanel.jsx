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

const DURATION_OPTIONS = ['5s', '10s', '15s'];
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4K'];
const ASPECT_RATIO_OPTIONS = ['Auto', '16:9', '9:16', '1:1', '4:3', '21:9'];

// Brand red palette pulled into local consts so the spec values appear
// inline (and `grep`-ably) at every spec callout below.
const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

// ─── Atom: faint glass row with caption + value, optional toggle ────────
// Used for the 4-up options chip grid (§3.7).
function OptionChip({ icon, label, value, toggle = false, on = false, onToggle, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '7px 9px', borderRadius: 10,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        cursor: onClick || toggle ? 'pointer' : 'default',
        transition: 'filter 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
        <span style={{ fontSize: 11 }}>{icon}</span>{label}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: '#FFF',
        display: 'flex', alignItems: 'center', marginTop: 2,
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
  const generateDisabled = isGenerating || (mode === 'frame' && !startFrame) || !prompt?.trim();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '16px 16px 20px',
      height: '100%', minHeight: 0,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          aria-label="Back"
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
          className="vlf-hover"
        >
          <ArrowLeft style={{ width: 14, height: 14 }} />
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#FFF' }}>Frame to Video</span>
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
                padding: '14px 10px', borderRadius: 12,
                background: active
                  ? `linear-gradient(180deg, ${RED}, ${RED_DEEP})`
                  : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? RED_HOT : 'rgba(255,255,255,0.08)'}`,
                color: active ? '#FFF' : 'rgba(255,255,255,0.85)',
                textAlign: 'center', cursor: 'pointer',
                fontSize: 12.5, fontWeight: active ? 700 : 600,
                boxShadow: active
                  ? `0 0 24px rgba(224,30,30,0.45), 0 1px 0 rgba(255,255,255,0.20) inset`
                  : 'none',
                transition: 'filter 0.15s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
              className="vlf-hover"
            >
              <span style={{
                fontSize: 22, lineHeight: 1,
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
          padding: '10px 12px', borderRadius: 12,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer', textAlign: 'left',
          transition: 'filter 0.15s',
        }}
        className="vlf-hover"
      >
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: 'linear-gradient(135deg, #3a5edc, #1a2e8e)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 800, color: '#FFF',
          flexShrink: 0,
        }}>
          {(model?.brand || model?.name || 'K').charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Model</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#FFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {model?.name || 'Kling 3.0'}
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16 }}>›</span>
      </button>

      {/* §3.4 — Set start & end frame (only when in frame mode) */}
      {mode === 'frame' && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#FFF', marginBottom: 8 }}>
            Set start &amp; end frame
          </div>
          <div style={{
            padding: 10, borderRadius: 12,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', gap: 8, alignItems: 'center',
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

      {/* §3.5 — Prompt textarea. flex: 1 + min-height: 0 lets the textarea
          consume whatever vertical space is left after the rest of the
          panel; if space is tight it shrinks to ~80 px so the GENERATE
          footer below stays visible without scrolling. */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
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
          padding: 12, borderRadius: 12,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)',
          flex: 1, minHeight: 80, position: 'relative',
          display: 'flex', flexDirection: 'column',
        }}>
          <textarea
            className="vlf-textarea"
            value={prompt}
            onChange={e => onPromptChange?.(e.target.value)}
            placeholder="Describe scene transitions, camera movement trajectories, or character actions with text to precisely control the entire video from beginning to end."
            style={{
              width: '100%',
              flex: 1,
              minHeight: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: '#FFF',
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: '"DM Sans", sans-serif',
              caretColor: RED,
              paddingBottom: 36, // make room for the ⚡ pill anchored bottom-left
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
            padding: '10px 12px', borderRadius: 10,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 12.5, fontWeight: 500,
            color: selectedMotion ? '#FFF' : 'rgba(255,255,255,0.85)',
            cursor: 'pointer', textAlign: 'left',
            transition: 'filter 0.15s',
          }}
          className="vlf-hover"
        >
          <Video style={{ width: 14, height: 14, color: selectedMotion ? RED : 'rgba(255,255,255,0.7)' }} />
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
          options={DURATION_OPTIONS}
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

      {/* §3.8 — Count stepper + GENERATE capsule */}
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        {/* Count stepper — single bordered row */}
        <div style={{
          display: 'flex', alignItems: 'center',
          border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10,
          overflow: 'hidden',
        }}>
          <button
            type="button"
            onClick={() => onCountChange?.(Math.max(1, (count || 1) - 1))}
            style={{
              padding: '0 10px', height: 36,
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          ><Minus style={{ width: 12, height: 12 }} /></button>
          <div style={{
            padding: '0 10px', height: 36,
            display: 'flex', alignItems: 'center',
            fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: '#FFF',
            borderLeft: '1px solid rgba(255,255,255,0.10)',
            borderRight: '1px solid rgba(255,255,255,0.10)',
          }}>{count || 1} / 4</div>
          <button
            type="button"
            onClick={() => onCountChange?.(Math.min(4, (count || 1) + 1))}
            style={{
              padding: '0 10px', height: 36,
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          ><Plus style={{ width: 12, height: 12 }} /></button>
        </div>

        {/* GENERATE capsule */}
        <button
          type="button"
          onClick={() => !generateDisabled && onGenerate?.()}
          disabled={generateDisabled}
          style={{
            flex: 1, height: 36, borderRadius: 10, border: 'none',
            background: isGenerating
              ? 'rgba(139,15,15,0.6)'
              : `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`,
            color: '#FFF',
            fontFamily: 'Anton, sans-serif',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: generateDisabled ? 'not-allowed' : 'pointer',
            opacity: generateDisabled && !isGenerating ? 0.5 : 1,
            boxShadow: isGenerating ? 'none' : `
              0 0 28px rgba(224,30,30,0.53),
              0 4px 14px rgba(139,15,15,0.5),
              0 1px 0 rgba(255,255,255,0.25) inset
            `,
            transition: 'box-shadow 0.18s, transform 0.15s',
          }}
          onMouseEnter={e => { if (!generateDisabled) { e.currentTarget.style.boxShadow = '0 0 36px rgba(224,30,30,0.7), 0 6px 18px rgba(139,15,15,0.6), 0 1px 0 rgba(255,255,255,0.3) inset'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
          onMouseLeave={e => { if (!generateDisabled) { e.currentTarget.style.boxShadow = '0 0 28px rgba(224,30,30,0.53), 0 4px 14px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset'; e.currentTarget.style.transform = 'none'; }}}
        >
          <span>{isGenerating ? 'Generating' : 'Generate'}</span>
          <span style={{ fontSize: 14 }}>→</span>
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
        flex: 1, aspectRatio: '4/3', borderRadius: 10,
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
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, cursor: 'pointer',
          color: dim ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.7)',
          fontSize: 11, fontWeight: 500, textAlign: 'center', lineHeight: 1.3,
        }}>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => onUpload(type, e)}
          />
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: dim ? 'rgba(139,15,15,0.45)' : RED,
            color: dim ? 'rgba(255,255,255,0.65)' : '#FFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 300,
            boxShadow: dim ? 'none' : `0 0 14px rgba(224,30,30,0.45)`,
          }}>+</div>
          <div>{caption}<br/>frame</div>
        </label>
      )}
    </div>
  );
}

// ─── Atom: option chip with popover (Res / Duration / Ratio) ───────────
function PopoverChip({ icon, label, value, options, open, onToggle, onSelect, selected }) {
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
