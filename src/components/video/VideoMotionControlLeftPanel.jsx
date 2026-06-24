// Motion Control tab — motion transfer.
//
//   - Kling Motion Control      (`fal-ai/kling-video/v2.6/standard/motion-control`)
//   - Kling 3.0 Motion Control  (`fal-ai/kling-video/v3/pro/motion-control`)         — default
//
// User uploads a short motion-reference video (3–30 s) AND a character
// image (face + body visible). Submits via POST /api/motion-control.
// The result is the character animated with the reference motion.
//
// scene_control toggle is persisted to history but NOT sent to FAL
// today — Kling hasn't exposed the flag publicly. Once they do, the
// backend route can start forwarding it without a frontend change.
import React, { useState, useRef } from 'react';
import { Video as VideoIcon, Plus, X, BookOpen, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { OptionChip, PopoverChip } from './videoChipAtoms';
import InlineModelPicker from './InlineModelPicker';
import { getVideoCredits } from '@/lib/creditPricing';

const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

const QUALITY_OPTIONS = ['720p', '1080p'];

const ACCEPT_VIDEO = 'video/mp4,video/quicktime,video/webm';
const ACCEPT_IMAGE = 'image/png,image/jpeg,image/webp';

const MODEL_COPY = {
  'Kling 3.0 Motion Control': {
    title: 'KLING 3.0 MOTION CONTROL',
    subtitle: 'Transfer motion from video to image',
    exclusive: true,
    howItWorks: 'Upload one short video that shows the motion you want, and one image of the character (face and body must be visible). Kling will animate the character with the exact motion from the reference clip — facial identity preserved, real-world physics applied (Kling 3.0).',
  },
  'Kling Motion Control': {
    title: 'KLING MOTION CONTROL',
    subtitle: 'Control motion with video references',
    exclusive: false,
    howItWorks: 'Upload one short video that shows the motion you want, and one image of the character. Kling will animate the character with the exact motion from the reference clip.',
  },
};

const MOTION_MODELS = [
  { name: 'Kling 3.0 Motion Control', description: 'Transfer motion from video to image', exclusive: true },
  { name: 'Kling Motion Control', description: 'Control motion with video references' },
];

function validateVideoDuration(file, min, max, label) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const d = video.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(d)) resolve({ ok: false, reason: 'Could not read video duration' });
      else if (d < min || d > max) resolve({ ok: false, reason: `Video must be ${label}` });
      else resolve({ ok: true, duration: d });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: false, reason: 'Could not load video file' });
    };
    video.src = url;
  });
}

export default function VideoMotionControlLeftPanel({
  charImage, onCharImageChange,
  motionVideo, onMotionVideoChange,
  quality, onQualityChange,
  sceneControl, onSceneControlChange,
  model, onModelChange,
  onGenerate, isGenerating,
}) {
  const [showHowTo, setShowHowTo] = useState(false);
  const [showQualityDrop, setShowQualityDrop] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [videoPoster, setVideoPoster] = useState(null);

  const copy = MODEL_COPY[model] || MODEL_COPY['Kling 3.0 Motion Control'];

  const handleVideoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const result = await validateVideoDuration(file, 3, 30, '3–30 seconds');
    if (!result.ok) { toast.error(result.reason); return; }
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(v, 0, 0);
      try { setVideoPoster(canvas.toDataURL('image/jpeg', 0.6)); } catch { /* ignore */ }
      URL.revokeObjectURL(url);
    };
    onMotionVideoChange?.(file);
  };

  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onCharImageChange?.(file);
  };

  const charPreview = charImage
    ? (typeof charImage === 'string' ? charImage : URL.createObjectURL(charImage))
    : null;

  const prereqsMissing = !charImage || !motionVideo;

  const handleGenerateClick = () => {
    if (isGenerating) return;
    if (!motionVideo) { toast.error('Add a motion reference video'); return; }
    if (!charImage) { toast.error('Add a character image'); return; }
    onGenerate?.();
  };

  // Credit cost — Motion Control is flat per generation by resolution (quality).
  const creditCost = getVideoCredits(model, { resolution: quality });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '14px 14px 16px',
      height: '100%', minHeight: 0, overflowY: 'auto',
      fontFamily: '"DM Sans", sans-serif',
      position: 'relative',
    }}>
      <style>{`
        .vmc-hover:hover { filter: brightness(1.12); }
        .vmc-dashed { border: 1.5px dashed rgba(255,255,255,0.18); }
        .vmc-dashed:hover { border-color: rgba(224,30,30,0.55); }
      `}</style>

      {/* Hero card */}
      <div style={{
        position: 'relative',
        height: 120,
        padding: '14px 16px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(40,18,18,0.6), rgba(20,12,12,0.6))',
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 220, height: 220,
          background: 'radial-gradient(circle, rgba(224,30,30,0.22), transparent 65%)',
          filter: 'blur(20px)', pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'Anton, sans-serif', fontSize: 20, color: '#FFF', letterSpacing: '0.04em', lineHeight: 1 }}>
                  {copy.title}
                </span>
                {copy.exclusive && (
                  <span style={{
                    padding: '2px 7px', borderRadius: 4,
                    background: 'rgba(224,30,30,0.18)',
                    border: '1px solid rgba(224,30,30,0.4)',
                    color: '#FF7878', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                  }}>EXCLUSIVE</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>
                {copy.subtitle}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowHowTo(v => !v)}
              style={{
                padding: '4px 8px', borderRadius: 6,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.85)',
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                flexShrink: 0,
              }}
            >
              <BookOpen style={{ width: 11, height: 11 }} />
              How it works
              <ChevronDown style={{ width: 10, height: 10 }} />
            </button>
          </div>
          {showHowTo && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              width: 280, padding: 10,
              background: 'rgba(20,18,20,0.96)', backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10,
              fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4,
              zIndex: 40, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}>
              {copy.howItWorks}
            </div>
          )}
        </div>
      </div>

      {/* Two upload tiles side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* Motion ref video */}
        <div className={motionVideo ? '' : 'vmc-dashed'} style={{
          height: 150, borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
          ...(motionVideo ? { border: '1px solid rgba(255,255,255,0.08)' } : {}),
          position: 'relative', overflow: 'hidden',
          transition: 'border-color 0.15s',
        }}>
          {motionVideo ? (
            <>
              {videoPoster ? (
                <img src={videoPoster} alt="motion poster" style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                }} />
              ) : (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'rgba(255,255,255,0.5)', fontSize: 11,
                }}>{motionVideo.name?.slice(0, 18)}</div>
              )}
              <button
                type="button"
                onClick={() => { setVideoPoster(null); onMotionVideoChange?.(null); }}
                aria-label="Remove motion video"
                style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#FFF', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><X style={{ width: 11, height: 11 }} /></button>
              <div style={{
                position: 'absolute', bottom: 6, left: 8,
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(224,30,30,0.85)',
                color: '#FFF', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              }}>MOTION</div>
            </>
          ) : (
            <label style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              cursor: 'pointer', color: 'rgba(255,255,255,0.7)',
              padding: 8, textAlign: 'center',
            }}>
              <VideoIcon style={{ width: 24, height: 24, color: RED }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#FFF', lineHeight: 1.2 }}>Add motion to copy</div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)' }}>Video duration: 3–30 seconds</div>
              <input
                type="file"
                accept={ACCEPT_VIDEO}
                style={{ display: 'none' }}
                onChange={handleVideoPick}
              />
            </label>
          )}
        </div>

        {/* Character image */}
        <div className={charImage ? '' : 'vmc-dashed'} style={{
          height: 150, borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
          ...(charImage ? { border: '1px solid rgba(255,255,255,0.08)' } : {}),
          position: 'relative', overflow: 'hidden',
          transition: 'border-color 0.15s',
        }}>
          {charImage ? (
            <>
              <img src={charPreview} alt="character" style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
              }} />
              <button
                type="button"
                onClick={() => onCharImageChange?.(null)}
                aria-label="Remove character image"
                style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#FFF', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><X style={{ width: 11, height: 11 }} /></button>
              <div style={{
                position: 'absolute', bottom: 6, left: 8,
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(0,0,0,0.6)',
                color: '#FFF', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              }}>CHARACTER</div>
            </>
          ) : (
            <label style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              cursor: 'pointer', color: 'rgba(255,255,255,0.7)',
              padding: 8, textAlign: 'center',
            }}>
              <Plus style={{ width: 24, height: 24, color: RED }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#FFF', lineHeight: 1.2 }}>Add your character</div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)' }}>Image with visible face and body</div>
              <input
                type="file"
                accept={ACCEPT_IMAGE}
                style={{ display: 'none' }}
                onChange={handleImagePick}
              />
            </label>
          )}
        </div>
      </div>

      {/* Model row */}
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        style={{
          padding: '8px 10px', borderRadius: 11,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 9,
          cursor: 'pointer', textAlign: 'left',
          transition: 'filter 0.15s',
        }}
        className="vmc-hover"
      >
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, #2a1414, #120808)',
          border: `1.5px solid ${RED}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: '#FFF',
          flexShrink: 0,
          fontFamily: 'Anton, sans-serif',
        }}>K</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)' }}>Model</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#FFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {model || 'Kling 3.0 Motion Control'}
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>›</span>
      </button>

      {/* Quality + Scene control row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <PopoverChip
          icon="🖥"
          label="Quality"
          value={quality || '720p'}
          options={QUALITY_OPTIONS}
          open={showQualityDrop}
          onToggle={() => setShowQualityDrop(v => !v)}
          onSelect={v => { onQualityChange?.(v); setShowQualityDrop(false); }}
          selected={quality}
        />
        <OptionChip
          icon="◎"
          label="Scene control"
          value={sceneControl ? 'On' : 'Off'}
          toggle
          on={!!sceneControl}
          onToggle={() => onSceneControlChange?.(!sceneControl)}
        />
      </div>

      {/* Generate */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={handleGenerateClick}
          disabled={isGenerating}
          style={{
            flex: 1, height: 32, borderRadius: 8, border: 'none',
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
        >
          <span>{isGenerating ? 'Generating' : 'Generate'}</span>
          {!isGenerating && (
            <span style={{ fontSize: 12 }} title="Estimated credit cost">
              ✦ {creditCost ?? '—'}
            </span>
          )}
        </button>
      </div>

      <InlineModelPicker
        open={showPicker}
        models={MOTION_MODELS}
        selected={model}
        onSelect={(name) => { onModelChange?.(name); setShowPicker(false); }}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}
