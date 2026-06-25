// Edit Video tab — two Kling video-to-video models behind one panel.
//
//   - Kling 3.0 Omni Edit  (`fal-ai/kling-video/o3/standard/video-to-video/reference`) — Exclusive
//   - Kling O1 Video Edit  (`fal-ai/kling-video/o1/video-to-video/reference`)         — default
//
// User uploads ONE source video (3–10 s) + up to 4 reference images +
// a text prompt. Submits via POST /api/edit-video-omni; the backend
// reads the `model` field to dispatch to the right FAL endpoint.
//
// Visual layer: same red-glass shell + atoms as VideoLeftPanel — the
// outer surface (380 px wide, blur 36 px, radius 22) lives in
// src/pages/Video.jsx; this component renders only the inner stack.
//
// Brand red is the only accent colour. No yellow anywhere.
import React, { useState, useRef } from 'react';
import { Video as VideoIcon, Plus, X, Info, BookOpen, ChevronDown } from 'lucide-react';
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

// Per-model copy for the hero card and "How it works" popover.
const MODEL_COPY = {
  'Kling 3.0 Omni Edit': {
    title: 'KLING 3.0 OMNI EDIT',
    subtitle: 'Edit videos with text prompts',
    exclusive: true,
    howItWorks: 'Upload a 3–10 second clip and describe the change in plain English. Kling 3.0 Omni Edit rewrites the footage while preserving the original motion.',
  },
  'Kling O1 Video Edit': {
    title: 'KLING O1 VIDEO EDIT',
    subtitle: 'Generate with elements and references',
    exclusive: false,
    howItWorks: 'Upload a clip plus up to 4 reference images. Kling O1 weaves the references into a new generation while keeping the source motion.',
  },
};

const EDIT_MODELS = [
  { name: 'Kling 3.0 Omni Edit', description: 'Edit videos with text prompts', exclusive: true },
  { name: 'Kling O1 Video Edit', description: 'Generate with elements and references' },
];

// HTML5 metadata duration check — resolves { ok, reason }.
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

export default function VideoEditOmniLeftPanel({
  prompt, onPromptChange,
  videoFile, onVideoFileChange,
  refImages, onRefImagesChange,
  keepAudio, onKeepAudioChange,
  autoSettings, onAutoSettingsChange,
  quality, onQualityChange,
  model, onModelChange,
  onGenerate, isGenerating,
}) {
  const [showHowTo, setShowHowTo] = useState(false);
  const [showQualityDrop, setShowQualityDrop] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [videoPoster, setVideoPoster] = useState(null);
  const videoInputRef = useRef(null);

  const copy = MODEL_COPY[model] || MODEL_COPY['Kling O1 Video Edit'];

  const handleVideoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const result = await validateVideoDuration(file, 3, 10, '3–10 seconds');
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
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
    onVideoFileChange?.(file);
  };

  const handleImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const next = [...(refImages || []), ...files].slice(0, 4);
    onRefImagesChange?.(next);
  };

  const removeImage = (idx) => {
    onRefImagesChange?.((refImages || []).filter((_, i) => i !== idx));
  };

  const clearVideo = () => {
    setVideoPoster(null);
    onVideoFileChange?.(null);
  };

  const prereqsMissing = !videoFile || !prompt?.trim();

  const handleGenerateClick = () => {
    if (isGenerating) return;
    if (!videoFile) { toast.error('Upload a video to edit'); return; }
    if (!prompt?.trim()) { toast.error('Type a prompt to describe the change'); return; }
    onGenerate?.(creditCost);
  };

  // Credit cost — Edit models are flat per generation by resolution (quality).
  const creditCost = getVideoCredits(model, { resolution: quality });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: '12px 14px 14px',
      height: '100%', minHeight: 0, overflowY: 'auto',
      fontFamily: '"DM Sans", sans-serif',
      position: 'relative',
    }}>
      <style>{`
        .veo-textarea::placeholder { color: rgba(255,255,255,0.42); font-size: 13px; line-height: 1.5; }
        .veo-textarea:focus {
          border-color: rgba(224,30,30,0.45) !important;
          box-shadow: 0 0 0 3px rgba(224,30,30,0.12);
          outline: none;
        }
        .veo-hover:hover { filter: brightness(1.12); }
        .veo-dashed { border: 1.5px dashed rgba(255,255,255,0.18); }
        .veo-dashed:hover { border-color: rgba(224,30,30,0.55); }
      `}</style>

      {/* Hero card */}
      <div style={{
        position: 'relative',
        height: 84,
        padding: '10px 14px',
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
                <span style={{ fontFamily: 'Anton, sans-serif', fontSize: 17, color: '#FFF', letterSpacing: '0.04em', lineHeight: 1 }}>
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
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 4, lineHeight: 1.3 }}>
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

      {/* Upload Video block */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#FFF', marginBottom: 6 }}>
          {autoSettings ? 'Reference video' : 'Source video'}
        </div>
        <div className={videoFile ? '' : 'veo-dashed'} style={{
          height: 84, borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
          ...(videoFile ? { border: '1px solid rgba(255,255,255,0.08)' } : {}),
          position: 'relative', overflow: 'hidden',
          transition: 'border-color 0.15s',
        }}>
          {videoFile ? (
            <>
              {videoPoster ? (
                <img src={videoPoster} alt="video poster" style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                }} />
              ) : (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'rgba(255,255,255,0.5)', fontSize: 12,
                }}>{videoFile.name}</div>
              )}
              <div style={{
                position: 'absolute', bottom: 6, left: 8,
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(0,0,0,0.6)',
                color: '#FFF', fontSize: 10, fontWeight: 600,
              }}>{videoFile.name?.slice(0, 24) || 'video'}</div>
              <button
                type="button"
                onClick={clearVideo}
                aria-label="Remove video"
                style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#FFF', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><X style={{ width: 11, height: 11 }} /></button>
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                style={{
                  position: 'absolute', bottom: 6, right: 8,
                  padding: '3px 8px', borderRadius: 6,
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: '#FFF', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                }}
              >Replace</button>
            </>
          ) : (
            <label style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              cursor: 'pointer', color: 'rgba(255,255,255,0.7)',
            }}>
              <VideoIcon style={{ width: 22, height: 22, color: RED }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#FFF' }}>
                {autoSettings ? 'Upload a reference video' : 'Upload a video to edit'}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>3–10 secs</div>
              <input
                type="file"
                accept={ACCEPT_VIDEO}
                style={{ display: 'none' }}
                onChange={handleVideoPick}
              />
            </label>
          )}
          <input
            ref={videoInputRef}
            type="file"
            accept={ACCEPT_VIDEO}
            style={{ display: 'none' }}
            onChange={handleVideoPick}
          />
        </div>
      </div>

      {/* Upload Images & Elements */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#FFF' }}>Reference images & elements</span>
          <span style={{
            padding: '1px 6px', borderRadius: 4,
            background: 'rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: 600,
          }}>Optional</span>
        </div>
        <div className="veo-dashed" style={{
          minHeight: 70, borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
          padding: 6,
          transition: 'border-color 0.15s',
        }}>
          {(refImages || []).length === 0 ? (
            <label style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 2,
              height: 58, cursor: 'pointer', color: 'rgba(255,255,255,0.7)',
            }}>
              <Plus style={{ width: 18, height: 18, color: RED }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FFF' }}>Upload images & elements</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Up to 4</div>
              <input
                type="file"
                accept={ACCEPT_IMAGE}
                multiple
                style={{ display: 'none' }}
                onChange={handleImagePick}
              />
            </label>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(refImages || []).map((file, i) => {
                const url = typeof file === 'string' ? file : URL.createObjectURL(file);
                return (
                  <div key={i} style={{
                    position: 'relative',
                    width: 64, height: 64, borderRadius: 6,
                    overflow: 'hidden',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                    <img src={url} alt={`ref ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      aria-label={`Remove image ${i + 1}`}
                      style={{
                        position: 'absolute', top: 2, right: 2,
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.7)',
                        border: 'none', color: '#FFF',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    ><X style={{ width: 9, height: 9 }} /></button>
                  </div>
                );
              })}
              {(refImages || []).length < 4 && (
                <label style={{
                  width: 64, height: 64, borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px dashed rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'rgba(255,255,255,0.6)',
                }}>
                  <Plus style={{ width: 16, height: 16 }} />
                  <input
                    type="file"
                    accept={ACCEPT_IMAGE}
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleImagePick}
                  />
                </label>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Prompt */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#FFF', marginBottom: 6 }}>Prompt</div>
        <div style={{
          padding: 10, borderRadius: 12,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)',
          height: 68,
        }}>
          <textarea
            className="veo-textarea"
            value={prompt}
            onChange={e => onPromptChange?.(e.target.value)}
            placeholder={'Describe the change you want, like "Make it snow". Add elements using @'}
            style={{
              width: '100%', height: '100%',
              background: 'transparent', border: 'none', outline: 'none', resize: 'none',
              color: '#FFF', fontSize: 12.5, lineHeight: 1.45,
              fontFamily: '"DM Sans", sans-serif',
              caretColor: RED,
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Auto settings + Quality + Audio */}
      <div style={{ display: 'grid', gridTemplateColumns: autoSettings ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
        <OptionChip
          icon="⚙"
          label="Auto settings"
          value={autoSettings ? 'On' : 'Off'}
          toggle
          on={!!autoSettings}
          onToggle={() => onAutoSettingsChange?.(!autoSettings)}
        />
        {!autoSettings && (
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
        )}
        <OptionChip
          icon="♪"
          label="Audio"
          value={keepAudio ? 'Keep' : 'Off'}
          toggle
          on={!!keepAudio}
          onToggle={() => onKeepAudioChange?.(!keepAudio)}
        />
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
        className="veo-hover"
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
            {model || 'Kling O1 Video Edit'}
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>›</span>
      </button>

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
        models={EDIT_MODELS}
        selected={model}
        onSelect={(name) => { onModelChange?.(name); setShowPicker(false); }}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}
