import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Star, Filter, Grid, Search, SlidersHorizontal, Heart, Download, Sparkles } from 'lucide-react';

const font = '"DM Sans", sans-serif';

const STAGES = [
  { pct: 5,  msg: 'Preparing canvas...' },
  { pct: 18, msg: 'Analyzing prompt...' },
  { pct: 35, msg: 'Building composition...' },
  { pct: 55, msg: 'Rendering pixels...' },
  { pct: 73, msg: 'Applying style & details...' },
  { pct: 88, msg: 'Enhancing quality...' },
  { pct: 95, msg: 'Finalizing image...' },
];

function LoadingImageCard({ durationMs = 3000 }) {
  const [pct, setPct] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const intervalRef = useRef(null);
  const stageRef = useRef(0);

  useEffect(() => {
    const totalTicks = durationMs / 80;
    let tick = 0;
    stageRef.current = 0;
    setPct(0);
    setStageIndex(0);

    intervalRef.current = setInterval(() => {
      tick++;
      const capped = Math.min((tick / totalTicks) * 100, 97);
      setPct(Math.round(capped));
      const nextStage = STAGES.findIndex((s, i) => i > stageRef.current && s.pct <= capped);
      if (nextStage !== -1) { stageRef.current = nextStage; setStageIndex(nextStage); }
    }, 80);

    return () => clearInterval(intervalRef.current);
  }, [durationMs]);

  const msg = STAGES[stageIndex]?.msg || 'Processing...';

  return (
    <div style={{ background: '#161616', borderRadius: 14, border: '1px solid rgba(224,30,30,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Shimmer preview — portrait */}
      <div style={{ aspectRatio: '4/5', background: 'linear-gradient(135deg, #1a0000 0%, #2a0a0a 50%, #1a1a1a 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(224,30,30,0.07) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmerImg 1.6s linear infinite' }} />
        <style>{`@keyframes shimmerImg{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(224,30,30,0.12)', border: '1px solid rgba(224,30,30,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spinImg 1.8s linear infinite' }}>
          <style>{`@keyframes spinImg{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          <Sparkles className="w-5 h-5" style={{ color: '#FF4444' }} />
        </div>
      </div>
      {/* Progress */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: font }}>Generating...</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#FF4444', fontFamily: font }}>{pct}%</span>
        </div>
        <div style={{ height: 4, background: '#2A2A2A', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #CC0000, #FF2222)', borderRadius: 999, transition: 'width 0.12s ease', boxShadow: '0 0 6px rgba(224,30,30,0.5)' }} />
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: font }}>{msg}</span>
      </div>
    </div>
  );
}

export default function ImageRightArea({ images = [], isGenerating = false, durationMs = 3000 }) {
  const [activeTab, setActiveTab] = useState('creations');

  return (
    <div style={{
      width: 440, minWidth: 440,
      height: 'calc(100vh - 110px)',
      background: '#0D0D0D',
      borderLeft: '1px solid #0D0D0D',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
    }}>
      {/* Tabs row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: '1px solid #0D0D0D', position: 'sticky', top: 0, background: '#0D0D0D', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          {[{ id: 'creations', label: 'Creations', icon: '🖼', arrow: true }, { id: 'collections', label: 'Collections', icon: '📁' }].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 999,
              fontSize: 13, fontFamily: font, cursor: 'pointer', transition: 'all 0.18s',
              background: activeTab === tab.id ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: activeTab === tab.id ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
              color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.4)',
              fontWeight: activeTab === tab.id ? 600 : 400,
            }}>
              <span>{tab.icon}</span>{tab.label}
              {tab.arrow && <ChevronDown className="w-3 h-3" />}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[SlidersHorizontal, Grid, Search].map((Icon, i) => (
            <button key={i} style={{ width: 30, height: 30, background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
            ><Icon className="w-4 h-4" /></button>
          ))}
          <button style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 999, fontSize: 12, color: '#fff', fontWeight: 600, fontFamily: font, cursor: 'pointer' }}>All</button>
          {[Star, Filter].map((Icon, i) => (
            <button key={i} style={{ width: 30, height: 30, background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
            ><Icon className="w-4 h-4" /></button>
          ))}
        </div>
      </div>

      {/* Content area */}
      {images.length === 0 && !isGenerating ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 400 }}>
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
            <rect x="8" y="14" width="56" height="44" rx="5" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5"/>
            <circle cx="24" cy="30" r="6" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5"/>
            <path d="M8 46 L22 32 L34 44 L46 30 L64 46 Z" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
          </svg>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.25)', fontFamily: font }}>No items to display</p>
        </div>
      ) : (
        <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {/* Loading card shown while generating */}
          {isGenerating && <LoadingImageCard durationMs={durationMs} />}
          {/* Completed images */}
          {images.map((img, i) => (
            <div
              key={img.id ?? i}
              style={{ background: img.gradient || '#161616', borderRadius: 14, border: '1px solid #0D0D0D', overflow: 'hidden', aspectRatio: '4/5', position: 'relative', cursor: 'pointer', transition: 'border-color 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; e.currentTarget.querySelector('.img-hover-actions').style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#0D0D0D'; e.currentTarget.querySelector('.img-hover-actions').style.opacity = '0'; }}
            >
              <div
                className="img-hover-actions"
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 8px 8px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', opacity: 0, transition: 'opacity 0.2s', display: 'flex', gap: 6, justifyContent: 'flex-end' }}
              >
                <button
                  style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(6px)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', transition: 'background 0.15s' }}
                  onClick={e => e.stopPropagation()}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(224,30,30,0.6)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                >
                  <Heart className="w-3.5 h-3.5" />
                </button>
                <button
                  style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(6px)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', transition: 'background 0.15s' }}
                  onClick={e => e.stopPropagation()}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}