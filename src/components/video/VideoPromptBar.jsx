import React, { useState, useRef, useEffect } from 'react';
import {
  ImagePlus, ArrowLeftRight, ArrowUp, X, ChevronDown,
  Clock, Volume2, Crosshair, Pencil, Type, Check
} from 'lucide-react';
import PageSwitcher from '@/components/common/PageSwitcher';

const VIDEO_MODELS = [
  { id: 'veo31', name: 'Veo 3.1', brand: 'Google', credits: 1200, tags: ['Start/End Frame', 'Audio', '4K', '8 sec'] },
  { id: 'veo31fast', name: 'Veo 3.1 Fast', brand: 'Google', credits: 700, tags: ['Start/End Frame', 'Audio', '4K', '8 sec'] },
  { id: 'kling30', name: 'Kling 3.0', brand: 'Kling', credits: 1050, tags: ['Start/End Frame', 'Audio', '1080p', '15 sec'] },
  { id: 'klingo3', name: 'Kling O3', brand: 'Kling', credits: 1050, tags: ['Start/End Frame', 'Audio', '1080p', '15 sec'] },
  { id: 'grok', name: 'Grok Imagine', brand: 'xAI', credits: 175, tags: ['Start Frame', 'Audio', '720p', '15 sec'] },
  { id: 'sora2pro', name: 'Sora 2 Pro', brand: 'OpenAI', credits: 2600, tags: ['Audio', '1080p', '12 sec'] },
  { id: 'sora2', name: 'Sora 2', brand: 'OpenAI', credits: 800, tags: ['Audio', '720p', '12 sec'] },
  { id: 'seedance15', name: 'Seedance 1.5 Pro', brand: 'Seedance', credits: 160, tags: ['Start/End Frame', 'Audio', '720p', '12 sec'] },
  { id: 'seedance10', name: 'Seedance 1.0 Pro Fast', brand: 'Seedance', credits: 80, tags: ['Audio', '720p', '8 sec'] },
  { id: 'kling16', name: 'Kling 1.6', brand: 'Kling', credits: 300, tags: ['Start/End Frame', 'Audio', '1080p', '10 sec'] },
  { id: 'wan21', name: 'Wan 2.1', brand: 'Wan', credits: 120, tags: ['Start/End Frame', '720p', '10 sec'] },
  { id: 'nanobananavid', name: 'Nano Banana Pro Video', brand: 'NB', credits: 200, tags: ['Audio', '1080p', '8 sec'] },
];

const ASPECT_RATIOS = ['Auto', '16:9', '9:16', '1:1', '4:3', '21:9'];
const DURATIONS = ['5 sec', '8 sec', '10 sec', '15 sec'];

const brandColors = {
  Google: '#4285F4',
  Kling: '#8B5CF6',
  xAI: '#E5E7EB',
  OpenAI: '#10A37F',
  Seedance: '#F59E0B',
  Wan: '#EC4899',
  NB: '#E01E1E',
};

const BrandDot = ({ brand }) => (
  <span
    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
    style={{ background: brandColors[brand] || '#666', color: '#fff' }}
  >
    {brand.charAt(0)}
  </span>
);

function ModelModal({ selectedId, onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        bottom: 110,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(860px, 92vw)',
        maxHeight: '70vh',
        overflowY: 'auto',
        background: 'rgba(16, 16, 20, 0.82)',
        backdropFilter: 'blur(40px) saturate(1.8)',
        WebkitBackdropFilter: 'blur(40px) saturate(1.8)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 20,
        padding: 20,
        boxShadow: '0 -8px 60px rgba(0,0,0,0.7)',
        zIndex: 200,
        animation: 'slideUpModal 0.28s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <style>{`
        @keyframes slideUpModal {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span className="text-white text-[18px] font-bold">Models</span>
        <div className="flex items-center gap-3">
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>✦ 40,000 credits remaining</span>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {VIDEO_MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => { onSelect(m); onClose(); }}
            className="text-left transition-all duration-200"
            style={{
              background: selectedId === m.id ? 'rgba(224,30,30,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${selectedId === m.id ? 'rgba(224,30,30,0.55)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 14,
              padding: 16,
              cursor: 'pointer',
            }}
            onMouseEnter={e => { if (selectedId !== m.id) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'; }}}
            onMouseLeave={e => { if (selectedId !== m.id) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BrandDot brand={m.brand} />
                <span className="text-white text-[14px] font-semibold">{m.name}</span>
              </div>
              <span style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '2px 8px', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                ✦ {m.credits}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {m.tags.map(tag => (
                <span key={tag} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                  {tag}
                </span>
              ))}
            </div>
            {selectedId === m.id && (
              <div className="flex justify-end mt-2">
                <Check className="w-3.5 h-3.5" style={{ color: '#E01E1E' }} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function AspectDropdown({ value, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, background: 'rgba(18,18,22,0.88)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 -8px 30px rgba(0,0,0,0.7)', overflow: 'hidden', minWidth: 120, zIndex: 300 }}>
      {ASPECT_RATIOS.map(opt => (
        <button key={opt} onClick={() => { onChange(opt); onClose(); }}
          className="w-full text-left px-4 py-2.5 text-sm transition-colors"
          style={{ background: value === opt ? 'rgba(255,255,255,0.1)' : 'transparent', color: value === opt ? '#fff' : 'rgba(255,255,255,0.6)' }}
          onMouseEnter={e => { if (value !== opt) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
          onMouseLeave={e => { if (value !== opt) e.currentTarget.style.background = 'transparent'; }}
        >
          {opt === 'Auto' ? 'Auto Ratio' : opt}
        </button>
      ))}
    </div>
  );
}

function DurationDropdown({ value, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, background: 'rgba(18,18,22,0.88)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 -8px 30px rgba(0,0,0,0.7)', overflow: 'hidden', minWidth: 110, zIndex: 300 }}>
      {DURATIONS.map(opt => (
        <button key={opt} onClick={() => { onChange(opt); onClose(); }}
          className="w-full text-left px-4 py-2.5 text-sm transition-colors"
          style={{ background: value === opt ? 'rgba(255,255,255,0.1)' : 'transparent', color: value === opt ? '#fff' : 'rgba(255,255,255,0.6)' }}
          onMouseEnter={e => { if (value !== opt) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
          onMouseLeave={e => { if (value !== opt) e.currentTarget.style.background = 'transparent'; }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

const chipBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 13px',
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 999,
  fontSize: 13,
  fontFamily: '"DM Sans", sans-serif',
  color: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 0.2s, border-color 0.2s',
};

const iconBtnBase = {
  width: 36,
  height: 36,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 0.2s',
  color: 'rgba(255,255,255,0.7)',
};

export default function VideoPromptBar({ prompt, onPromptChange, onGenerate, isGenerating, selectedModel, onModelChange }) {
  const [model, setModel] = useState(VIDEO_MODELS[0]);
  const [aspectRatio, setAspectRatio] = useState('Auto');
  const [duration, setDuration] = useState('5 sec');
  const [audioOn, setAudioOn] = useState(false);
  const [negativeMode, setNegativeMode] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [showModelModal, setShowModelModal] = useState(false);
  const [showAspectDrop, setShowAspectDrop] = useState(false);
  const [showDurationDrop, setShowDurationDrop] = useState(false);
  const [sendPulse, setSendPulse] = useState(false);
  const inputRef = useRef(null);

  const handleSelectModel = (m) => {
    setModel(m);
    if (onModelChange) onModelChange(m);
  };

  const handleSend = () => {
    if (sendPulse) return;
    setSendPulse(true);
    setTimeout(() => setSendPulse(false), 600);
    if (onGenerate) onGenerate();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <>
      {/* Model Modal */}
      {showModelModal && (
        <ModelModal
          selectedId={model.id}
          onSelect={handleSelectModel}
          onClose={() => setShowModelModal(false)}
        />
      )}

      <style>{`
        @keyframes sendPulse {
          0%   { transform: scale(1); }
          40%  { transform: scale(0.88); }
          70%  { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        .send-pulse { animation: sendPulse 0.5s ease; }
      `}</style>

      <div style={{ position: 'relative' }}>
        <PageSwitcher />

        {/* Main Bar */}
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(860px, 92vw)',
            background: 'rgba(14,14,18,0.55)',
            backdropFilter: 'blur(48px) saturate(2.2)',
            WebkitBackdropFilter: 'blur(48px) saturate(2.2)',
            border: '1px solid rgba(255,255,255,0.13)',
            borderRadius: 22,
            overflow: 'hidden',
            boxShadow: '0 8px 64px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.09) inset, 0 -1px 0 rgba(0,0,0,0.4) inset',
            zIndex: 100,
            transition: 'all 0.32s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          {/* Content area */}
          <div style={{ padding: '14px 16px 0 14px', position: 'relative' }}>

            {/* Top-right corner buttons */}
            <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                style={{ width: 34, height: 34, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', transition: 'background 0.18s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                title="Add text overlay"
              >
                <Type className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Main prompt row */}
            <div className="flex items-center gap-2 mb-3" style={{ paddingRight: 48 }}>
              {/* Start frame */}
              <button
                style={iconBtnBase}
                title="Upload start frame"
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              >
                <ImagePlus className="w-4 h-4" />
              </button>
              {/* Swap */}
              <button
                style={iconBtnBase}
                title="Swap frames"
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
              {/* End frame */}
              <button
                style={iconBtnBase}
                title="Upload end frame"
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              >
                <ImagePlus className="w-4 h-4" />
              </button>

              {/* Prompt input */}
              <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={e => onPromptChange && onPromptChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Describe the video you want to create"
                className="video-prompt-input"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: '"DM Sans", sans-serif' }}
              />
              <Pencil className="w-3 h-3 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.28)' }} />
            </div>

            {/* Negative Prompt inline zone */}
            {negativeMode && (
              <>
                <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', marginBottom: 12 }} />
                <div style={{ paddingBottom: 6 }}>
                  <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: 600, fontFamily: '"DM Sans", sans-serif', marginBottom: 4 }}>Negative Prompt</p>
                  <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 13, fontFamily: '"DM Sans", sans-serif', marginBottom: 10 }}>
                    List what to exclude from your video (e.g. if you don't want trees, type "trees")
                  </p>
                  <div style={{ position: 'relative', paddingRight: 20 }}>
                    <textarea
                      autoFocus
                      value={negativePrompt}
                      onChange={e => setNegativePrompt(e.target.value)}
                      placeholder="trees, blurry, low quality, distorted faces, watermark..."
                      rows={2}
                      style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: '"DM Sans", sans-serif', resize: 'none', lineHeight: 1.6, caretColor: 'white' }}
                      className="video-prompt-input"
                    />
                    <Pencil className="w-3 h-3" style={{ position: 'absolute', bottom: 4, right: 2, color: 'rgba(255,255,255,0.28)' }} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* BOTTOM ROW */}
          <div className="flex items-center gap-2 flex-wrap hide-scrollbar" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 14px 14px 14px', overflowX: 'auto' }}>
            {/* Model chip */}
            <button
              onClick={() => { setShowModelModal(v => !v); setShowAspectDrop(false); setShowDurationDrop(false); }}
              style={{ ...chipBase, border: `1px solid ${showModelModal ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.2)'}`, background: showModelModal ? 'rgba(255,255,255,0.12)' : chipBase.background }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.13)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = showModelModal ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
            >
              <BrandDot brand={model.brand} />
              <span>{model.name}</span>
              <ChevronDown className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.4)' }} />
            </button>

            {/* Aspect ratio */}
            <div className="relative">
              <button
                onClick={() => { setShowAspectDrop(v => !v); setShowModelModal(false); setShowDurationDrop(false); }}
                style={{ ...chipBase, background: showAspectDrop ? 'rgba(255,255,255,0.12)' : chipBase.background }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
                onMouseLeave={e => e.currentTarget.style.background = showAspectDrop ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}
              >
                <Crosshair className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.55)' }} />
                <span>{aspectRatio === 'Auto' ? 'Auto Ratio' : aspectRatio}</span>
              </button>
              {showAspectDrop && <AspectDropdown value={aspectRatio} onChange={setAspectRatio} onClose={() => setShowAspectDrop(false)} />}
            </div>

            {/* Duration */}
            <div className="relative">
              <button
                onClick={() => { setShowDurationDrop(v => !v); setShowModelModal(false); setShowAspectDrop(false); }}
                style={{ ...chipBase, background: showDurationDrop ? 'rgba(255,255,255,0.12)' : chipBase.background }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
                onMouseLeave={e => e.currentTarget.style.background = showDurationDrop ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}
              >
                <Clock className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.55)' }} />
                <span>{duration}</span>
              </button>
              {showDurationDrop && <DurationDropdown value={duration} onChange={setDuration} onClose={() => setShowDurationDrop(false)} />}
            </div>

            {/* Audio toggle */}
            <button
              onClick={() => setAudioOn(v => !v)}
              style={{
                ...chipBase,
                border: audioOn ? '1px solid rgba(100,200,100,0.4)' : chipBase.border,
                background: audioOn ? 'rgba(100,200,100,0.08)' : chipBase.background,
                color: audioOn ? 'rgba(150,240,150,0.9)' : 'rgba(255,255,255,0.85)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = audioOn ? 'rgba(100,200,100,0.13)' : 'rgba(255,255,255,0.13)'}
              onMouseLeave={e => e.currentTarget.style.background = audioOn ? 'rgba(100,200,100,0.08)' : 'rgba(255,255,255,0.07)'}
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Audio</span>
            </button>

            {/* Negative Prompt chip */}
            <button
              onClick={() => setNegativeMode(v => !v)}
              style={{
                ...chipBase,
                border: negativeMode ? '1px solid rgba(255,255,255,0.3)' : chipBase.border,
                background: negativeMode ? 'rgba(255,255,255,0.13)' : chipBase.background,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
              onMouseLeave={e => e.currentTarget.style.background = negativeMode ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.07)'}
            >
              <span>Negative Prompt{negativeMode ? ' ●' : ''}</span>
            </button>

            {/* Prompt Accuracy */}
            <button
              style={chipBase}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
            >
              <Crosshair className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.55)' }} />
              <span>Prompt Accuracy</span>
            </button>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={isGenerating}
              className={sendPulse ? 'send-pulse' : ''}
              style={{
                width: 46, height: 46,
                borderRadius: '50%',
                background: isGenerating ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.92)',
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s, transform 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={e => { if (!isGenerating) e.currentTarget.style.background = '#fff'; }}
              onMouseLeave={e => { if (!isGenerating) e.currentTarget.style.background = 'rgba(255,255,255,0.92)'; }}
            >
              <ArrowUp className="w-5 h-5" style={{ color: '#111' }} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}