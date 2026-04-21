import React, { useEffect } from 'react';
import { X, Download, Heart, RefreshCw, Maximize2, Share2, Copy, ChevronLeft, ChevronRight } from 'lucide-react';

const font = '"DM Sans", sans-serif';

export default function ImageLightbox({ image, images = [], onClose, onNavigate }) {
  const currentIndex = images.findIndex(img => img.id === image.id);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(images[currentIndex - 1]);
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onNavigate(images[currentIndex + 1]);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentIndex, images]);

  const actions = [
    { icon: Heart, label: 'Save', color: '#ff4f4f' },
    { icon: Download, label: 'Download', color: '#4faaff' },
    { icon: RefreshCw, label: 'Variations', color: '#a78bfa' },
    { icon: Maximize2, label: 'Upscale', color: '#34d399' },
    { icon: Share2, label: 'Share', color: '#fbbf24' },
  ];

  const meta = [
    { label: 'Model', value: image.model?.name || 'Nano Banana Pro' },
    { label: 'Aspect', value: image.aspectRatio || '16:9' },
    { label: 'Quality', value: image.quality || '2K' },
    { label: 'Style', value: image.style || 'Default' },
    { label: 'Created', value: new Date(image.id).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
  ];

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'lbFadeIn 0.2s ease' }}
      onClick={onClose}
    >
      <style>{`
        @keyframes lbFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes lbSlideIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
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
          onClick={e => { e.stopPropagation(); onNavigate(images[currentIndex - 1]); }}
          style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', zIndex: 10 }}
        >
          <ChevronLeft style={{ width: 20, height: 20 }} />
        </button>
      )}
      {currentIndex < images.length - 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(images[currentIndex + 1]); }}
          style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', zIndex: 10 }}
        >
          <ChevronRight style={{ width: 20, height: 20 }} />
        </button>
      )}

      {/* Main panel */}
      <div
        style={{ display: 'flex', gap: 0, width: 'min(1100px, 95vw)', height: 'min(700px, 92vh)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.8)', animation: 'lbSlideIn 0.25s ease', border: '1px solid rgba(255,255,255,0.07)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Image */}
        <div style={{ flex: 1, background: image.gradient || '#161616', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minWidth: 0 }}>
          {image.url ? (
            <img src={image.url} alt="Generated" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: image.gradient }} />
          )}
        </div>

        {/* Info panel */}
        <div style={{ width: 300, background: '#0A0A0A', borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
          {/* Header */}
          <div style={{ padding: '22px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: font, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Prompt</p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontFamily: font, lineHeight: 1.6, margin: 0 }}>
              {image.prompt || 'No prompt provided'}
            </p>
            <button
              style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: font, cursor: 'pointer', transition: 'all 0.15s' }}
              onClick={() => navigator.clipboard.writeText(image.prompt || '')}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            >
              <Copy style={{ width: 11, height: 11 }} /> Copy prompt
            </button>
          </div>

          {/* Actions */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {meta.map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', fontFamily: font }}>{label}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: font, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Counter */}
          {images.length > 1 && (
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontFamily: font }}>{currentIndex + 1} / {images.length}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}