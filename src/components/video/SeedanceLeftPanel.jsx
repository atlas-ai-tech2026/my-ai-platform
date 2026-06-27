import React, { useState, useEffect } from 'react';
import { Image as ImageIcon, Film, Music, AtSign, Volume2, VolumeX, ChevronDown, Sparkles, BarChart3 } from 'lucide-react';
import SeedanceMediaGrid from './SeedanceMediaGrid';
import { getVideoCredits } from '@/lib/creditPricing';

const S = { font: '"DM Sans", sans-serif' };
const DURATIONS = ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
const ASPECTS = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
// Regular Seedance 2.0 supports 480/720/1080p; Fast and Mini only 480/720p per FAL docs.
const RESOLUTIONS_REGULAR = ['480p', '720p', '1080p'];
const RESOLUTIONS_FAST = ['480p', '720p'];

export default function SeedanceLeftPanel({
  prompt, onPromptChange, onGenerate, isGenerating,
  model, onModelClick,
  duration, onDurationChange,
  aspectRatio, onAspectRatioChange,
  resolution, onResolutionChange,
  audioOn, onAudioToggle,
  media, onMediaRemove, onCheckEligibility,
  elements, onElementsClick,
  showMediaPopup, onCloseMediaPopup,
  imageRoles = {}, onImageRoleChange,
}) {
  const [showDurDrop, setShowDurDrop] = useState(false);
  const [showAspectDrop, setShowAspectDrop] = useState(false);
  const [showResDrop, setShowResDrop] = useState(false);
  const [showAtMenu, setShowAtMenu] = useState(false);

  // Resolution options depend on the model variant
  const isCapped720 = model?.id === 'seedance-2-fast' || model?.id === 'seedance-2-mini';
  const RESOLUTIONS = isCapped720 ? RESOLUTIONS_FAST : RESOLUTIONS_REGULAR;

  // If user switches to Fast/Mini while on 1080p, bump down to 720p
  // (neither supports 1080p per FAL schema)
  useEffect(() => {
    if (isCapped720 && resolution === '1080p') {
      onResolutionChange?.('720p');
    }
  }, [isCapped720, resolution, onResolutionChange]);

  const allMedia = [...(media?.images || []), ...(media?.videos || []), ...(media?.audios || [])];

  // Credit cost (Seedance is per-second by resolution). When duration is
  // "auto" we estimate against 5s and flag it with a "~".
  const isAutoDuration = duration === 'auto' || !duration;
  const creditCost = getVideoCredits(
    model?.id,
    { resolution, duration: isAutoDuration ? '5s' : duration, audio: audioOn },
  );

  const insertAtReference = (label) => {
    onPromptChange?.((prompt || '') + label + ' ');
    setShowAtMenu(false);
  };

  const allLabels = [
    ...(media?.images || []).filter(i => i.label).map(i => i.label),
    ...(media?.videos || []).filter(v => v.label).map(v => v.label),
    ...(media?.audios || []).filter(a => a.label).map(a => a.label),
    ...(elements || []).map(e => e.label),
  ];

  return (
    <div style={{
      width: 380, minWidth: 380, maxWidth: 380, flexShrink: 0,
      height: '100%', overflowY: 'auto',
      background: '#0A0A0A', borderRight: '1px solid #1A1A1A',
      display: 'flex', flexDirection: 'column', padding: '14px 16px', gap: 12,
      fontFamily: S.font, position: 'relative',
    }}>
      {/* Media Upload Area — all clicks open the popup */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1.5px dashed rgba(255,255,255,0.15)',
        borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        cursor: 'pointer',
      }} onClick={onElementsClick}>
        <div style={{ display: 'flex', gap: 12 }}>
          {[ImageIcon, Film, Music].map((Icon, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); onElementsClick?.(); }}
              style={{
                width: 40, height: 40, borderRadius: 8,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'rgba(255,255,255,0.5)', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(13,148,136,0.15)'; e.currentTarget.style.borderColor = 'rgba(13,148,136,0.4)'; e.currentTarget.style.color = '#0D9488'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
            >
              <Icon style={{ width: 18, height: 18 }} />
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Upload media</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Image, Video or Audio</div>
      </div>

      {/* Uploaded media thumbnails with role selection */}
      {allMedia.length > 0 && (
        <SeedanceMediaGrid
          items={allMedia}
          compact
          onCheckEligibility={onCheckEligibility}
          onRemove={onMediaRemove}
          imageRoles={imageRoles}
          onImageRoleChange={onImageRoleChange}
        />
      )}

      {/* Prompt */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, padding: 12,
      }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, fontWeight: 600 }}>Prompt</div>
        <textarea
          value={prompt}
          onChange={e => onPromptChange?.(e.target.value)}
          placeholder="Describe your scene. Use @ to reference assets"
          rows={3}
          style={{
            width: '100%', background: 'transparent', border: 'none', outline: 'none',
            color: '#fff', fontSize: 13, fontFamily: S.font, resize: 'none', lineHeight: 1.5,
          }}
          onKeyDown={e => {
            if (e.key === '@') setShowAtMenu(true);
          }}
        />

        {/* @ menu dropdown */}
        {showAtMenu && allLabels.length > 0 && (
          <div style={{
            background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, padding: 4, marginTop: 4,
          }}>
            {allLabels.map(label => (
              <button key={label} onClick={() => insertAtReference(label)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 10px', background: 'transparent', border: 'none',
                  color: '#0D9488', fontSize: 11, fontFamily: S.font, cursor: 'pointer',
                  borderRadius: 4,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(13,148,136,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >{label}</button>
            ))}
            <button onClick={() => setShowAtMenu(false)}
              style={{ display: 'block', width: '100%', textAlign: 'center', padding: '3px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 9, cursor: 'pointer', fontFamily: S.font }}>
              Close
            </button>
          </div>
        )}

        {/* Elements + Audio row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <button onClick={onElementsClick}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#fff', fontSize: 11, fontFamily: S.font, cursor: 'pointer',
            }}>
            <AtSign style={{ width: 12, height: 12 }} /> Elements
          </button>
          <button onClick={onAudioToggle}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6,
              background: audioOn ? 'rgba(13,148,136,0.15)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${audioOn ? 'rgba(13,148,136,0.3)' : 'rgba(255,255,255,0.12)'}`,
              color: audioOn ? '#0D9488' : 'rgba(255,255,255,0.5)',
              fontSize: 11, fontFamily: S.font, cursor: 'pointer',
            }}>
            {audioOn ? <Volume2 style={{ width: 12, height: 12 }} /> : <VolumeX style={{ width: 12, height: 12 }} />}
            {audioOn ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Model display */}
      <button onClick={onModelClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, cursor: 'pointer', width: '100%',
        }}>
        <div style={{ width: 32, height: 32, borderRadius: 7, background: '#0D9488', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BarChart3 style={{ width: 16, height: 16, color: '#fff' }} />
        </div>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: S.font }}>Model</div>
          <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, fontFamily: S.font, display: 'flex', alignItems: 'center', gap: 5 }}>
            {model?.name || 'Seedance 2.0'} <BarChart3 style={{ width: 12, height: 12, color: '#0D9488' }} />
          </div>
        </div>
        <ChevronDown style={{ width: 14, height: 14, color: 'rgba(255,255,255,0.3)' }} />
      </button>

      {/* Settings row */}
      <div style={{ display: 'flex', gap: 6 }}>
        {/* Duration */}
        <div style={{ flex: 1, position: 'relative' }}>
          <button onClick={() => { setShowDurDrop(v => !v); setShowAspectDrop(false); setShowResDrop(false); }}
            style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', fontSize: 12, fontFamily: S.font, cursor: 'pointer' }}>
            <span>{duration === 'auto' ? 'Auto' : (duration || 'auto') + 's'}</span>
            <ChevronDown style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.3)' }} />
          </button>
          {showDurDrop && (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 4, zIndex: 20, maxHeight: 200, overflowY: 'auto' }}>
              {DURATIONS.map(d => (
                <button key={d} onClick={() => { onDurationChange?.(d); setShowDurDrop(false); }}
                  style={{ display: 'block', width: '100%', padding: '5px 8px', background: 'transparent', border: 'none', color: '#fff', fontSize: 11, fontFamily: S.font, cursor: 'pointer', borderRadius: 4, textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{d === 'auto' ? 'Auto' : d + 's'}</button>
              ))}
            </div>
          )}
        </div>
        {/* Aspect */}
        <div style={{ flex: 1, position: 'relative' }}>
          <button onClick={() => { setShowAspectDrop(v => !v); setShowDurDrop(false); setShowResDrop(false); }}
            style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', fontSize: 12, fontFamily: S.font, cursor: 'pointer' }}>
            <span>{aspectRatio || 'auto'}</span>
            <ChevronDown style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.3)' }} />
          </button>
          {showAspectDrop && (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 4, zIndex: 20 }}>
              {ASPECTS.map(a => (
                <button key={a} onClick={() => { onAspectRatioChange?.(a); setShowAspectDrop(false); }}
                  style={{ display: 'block', width: '100%', padding: '5px 8px', background: 'transparent', border: 'none', color: '#fff', fontSize: 11, fontFamily: S.font, cursor: 'pointer', borderRadius: 4, textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{a}</button>
              ))}
            </div>
          )}
        </div>
        {/* Resolution */}
        <div style={{ flex: 1, position: 'relative' }}>
          <button onClick={() => { setShowResDrop(v => !v); setShowDurDrop(false); setShowAspectDrop(false); }}
            style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', fontSize: 12, fontFamily: S.font, cursor: 'pointer' }}>
            <span>{resolution || '720p'}</span>
            <ChevronDown style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.3)' }} />
          </button>
          {showResDrop && (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 4, zIndex: 20 }}>
              {RESOLUTIONS.map(r => (
                <button key={r} onClick={() => { onResolutionChange?.(r); setShowResDrop(false); }}
                  style={{ display: 'block', width: '100%', padding: '5px 8px', background: 'transparent', border: 'none', color: '#fff', fontSize: 11, fontFamily: S.font, cursor: 'pointer', borderRadius: 4, textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{r}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Generate button — RED Voxel brand color */}
      <button onClick={() => onGenerate?.(creditCost)} disabled={isGenerating}
        style={{
          width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
          background: isGenerating ? 'rgba(224,30,30,0.4)' : 'linear-gradient(90deg, #C41818, #E01E1E)',
          color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: S.font,
          cursor: isGenerating ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'all 0.15s',
          boxShadow: isGenerating ? 'none' : '0 2px 12px rgba(224,30,30,0.3)',
        }}>
        {isGenerating ? (
          <>Generating...</>
        ) : (
          <>
            Generate <Sparkles style={{ width: 15, height: 15 }} />
            {creditCost != null && (
              <span title={isAutoDuration ? 'Estimated cost (auto duration ≈ 5s)' : 'Credit cost'}>
                ✦ {isAutoDuration ? '~' : ''}{creditCost}
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}
