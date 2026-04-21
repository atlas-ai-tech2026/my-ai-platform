import React, { useState, useRef, useEffect } from 'react';
import { X, Play, Pause, Download, Heart, Share2, Copy, Volume2, VolumeX, Maximize, ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from 'lucide-react';

const font = '"DM Sans", sans-serif';

const GRADIENTS = [
  'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #0d0d0d 100%)',
  'linear-gradient(135deg, #1a0000 0%, #2a0a0a 50%, #1a1a1a 100%)',
  'linear-gradient(135deg, #0d1a0d 0%, #0a2a1a 50%, #0a0a0a 100%)',
  'linear-gradient(135deg, #1a1a0a 0%, #2a1a00 50%, #0a0a0a 100%)',
];

export default function VideoLightbox({ video, videos = [], onClose, onNavigate }) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hoverControls, setHoverControls] = useState(false);
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const hideTimer = useRef(null);
  const [showControls, setShowControls] = useState(true);

  const currentIndex = videos.findIndex(v => v.id === video.id);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(videos[currentIndex - 1]);
      if (e.key === 'ArrowRight' && currentIndex < videos.length - 1) onNavigate(videos[currentIndex + 1]);
      if (e.key === 'm') setMuted(m => !m);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentIndex, videos]);

  // Auto-hide controls
  const resetHideTimer = () => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (playing) setShowControls(false); }, 2500);
  };

  const gradient = GRADIENTS[currentIndex % GRADIENTS.length];

  const meta = [
    { label: 'Model', value: video.model || 'Kling 2.6' },
    { label: 'Duration', value: video.duration || '5s' },
    { label: 'Resolution', value: video.resolution || '1080p' },
    { label: 'FPS', value: video.fps || '24fps' },
    { label: 'Created', value: new Date(video.id).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
  ];

  const actions = [
    { icon: Heart, label: 'Save', color: '#ff4f4f' },
    { icon: Download, label: 'Download', color: '#4faaff' },
    { icon: RefreshCw, label: 'Variations', color: '#a78bfa' },
    { icon: Share2, label: 'Share', color: '#fbbf24' },
  ];

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'vlFadeIn 0.22s ease' }}
      onClick={onClose}
    >
      <style>{`
        @keyframes vlFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes vlSlideIn { from{opacity:0;transform:scale(0.97) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
        .vl-scrub::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:#fff; cursor:pointer; }
        .vl-scrub { -webkit-appearance:none; height:4px; border-radius:999px; background:transparent; outline:none; cursor:pointer; }
      `}</style>

      {/* Close */}
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 20, right: 20, width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', zIndex: 10, transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.18)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
      >
        <X style={{ width: 16, height: 16 }} />
      </button>

      {/* Prev / Next */}
      {currentIndex > 0 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(videos[currentIndex - 1]); }}
          style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', zIndex: 10 }}
        >
          <ChevronLeft style={{ width: 20, height: 20 }} />
        </button>
      )}
      {currentIndex < videos.length - 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(videos[currentIndex + 1]); }}
          style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', zIndex: 10 }}
        >
          <ChevronRight style={{ width: 20, height: 20 }} />
        </button>
      )}

      {/* Main panel */}
      <div
        style={{ display: 'flex', width: 'min(1180px, 96vw)', height: 'min(720px, 94vh)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.9)', animation: 'vlSlideIn 0.28s ease', border: '1px solid rgba(255,255,255,0.07)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Video area */}
        <div
          style={{ flex: 1, background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', minWidth: 0 }}
          onMouseMove={resetHideTimer}
          onClick={() => { setPlaying(p => !p); resetHideTimer(); }}
        >
          {/* Video / placeholder */}
          {video.url ? (
            <video
              ref={videoRef}
              src={video.url}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              loop
              muted={muted}
              onTimeUpdate={e => {
                const el = e.currentTarget;
                if (el.duration) setProgress((el.currentTime / el.duration) * 100);
              }}
            />
          ) : (
            /* Placeholder with animated gradient */
            <div style={{ width: '100%', height: '100%', background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', fontFamily: font }}>Preview not available</div>
            </div>
          )}

          {/* Center play/pause button */}
          <div
            style={{ position: 'absolute', width: 72, height: 72, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)', border: '1.5px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: showControls ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: 'none' }}
          >
            {playing
              ? <Pause style={{ width: 28, height: 28, color: '#fff' }} />
              : <Play style={{ width: 28, height: 28, color: '#fff', marginLeft: 4 }} />
            }
          </div>

          {/* Bottom controls bar */}
          <div
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 18px 14px', background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)', opacity: showControls ? 1 : 0, transition: 'opacity 0.3s', display: 'flex', flexDirection: 'column', gap: 8 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Scrubber */}
            <div style={{ position: 'relative', height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 999, cursor: 'pointer' }}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                setProgress(pct * 100);
                if (videoRef.current) videoRef.current.currentTime = videoRef.current.duration * pct;
              }}
            >
              <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#CC0000,#FF2222)', borderRadius: 999, transition: 'width 0.1s', boxShadow: '0 0 6px rgba(224,30,30,0.6)', position: 'relative' }}>
                <div style={{ position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 0 6px rgba(0,0,0,0.5)' }} />
              </div>
            </div>

            {/* Controls row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => {
                  setPlaying(p => !p);
                  if (videoRef.current) playing ? videoRef.current.pause() : videoRef.current.play();
                }}
                style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.12)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}
              >
                {playing ? <Pause style={{ width: 14, height: 14 }} /> : <Play style={{ width: 14, height: 14, marginLeft: 2 }} />}
              </button>
              <button
                onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; setProgress(0); }}
                style={{ width: 32, height: 32, borderRadius: 8, background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}
              >
                <RotateCcw style={{ width: 13, height: 13 }} />
              </button>
              <button
                onClick={() => setMuted(m => !m)}
                style={{ width: 32, height: 32, borderRadius: 8, background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}
              >
                {muted ? <VolumeX style={{ width: 14, height: 14 }} /> : <Volume2 style={{ width: 14, height: 14 }} />}
              </button>
              <div style={{ flex: 1 }} />
              {videos.length > 1 && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: font }}>{currentIndex + 1} / {videos.length}</span>
              )}
            </div>
          </div>
        </div>

        {/* Info panel */}
        <div style={{ width: 300, background: '#0A0A0A', borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
          {/* Prompt */}
          <div style={{ padding: '22px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: font, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Prompt</p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontFamily: font, lineHeight: 1.6, margin: 0 }}>
              {video.prompt || 'No prompt provided'}
            </p>
            <button
              style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: font, cursor: 'pointer' }}
              onClick={() => navigator.clipboard.writeText(video.prompt || '')}
            >
              <Copy style={{ width: 11, height: 11 }} /> Copy prompt
            </button>
          </div>

          {/* Actions */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {actions.map(({ icon: Icon, label, color }) => (
              <button
                key={label}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: font, cursor: 'pointer', transition: 'all 0.15s', flex: '1 1 auto' }}
                onMouseEnter={e => { e.currentTarget.style.background = `${color}18`; e.currentTarget.style.borderColor = `${color}44`; e.currentTarget.style.color = color; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
              >
                <Icon style={{ width: 13, height: 13 }} /> {label}
              </button>
            ))}
          </div>

          {/* Metadata */}
          <div style={{ padding: '16px 20px', flex: 1 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: font, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>Details</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {meta.map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontFamily: font }}>{label}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: font, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Thumbnail strip */}
          {videos.length > 1 && (
            <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 6, overflowX: 'auto' }} className="hide-scrollbar">
              {videos.map((v, i) => (
                <div
                  key={v.id}
                  onClick={() => onNavigate(v)}
                  style={{ width: 56, height: 38, borderRadius: 7, flexShrink: 0, cursor: 'pointer', background: GRADIENTS[i % GRADIENTS.length], border: `2px solid ${v.id === video.id ? '#E01E1E' : 'transparent'}`, transition: 'border-color 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                >
                  {v.url && <video src={v.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}