import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Star, Filter, Grid, Search, SlidersHorizontal, MessageSquare, Video, Music, Sparkles, Download } from 'lucide-react';
import { toast } from 'sonner';

const font = '"DM Sans", sans-serif';

const STAGES = [
  { pct: 5,  msg: 'Preparing assets...' },
  { pct: 18, msg: 'Analyzing prompt...' },
  { pct: 32, msg: 'Building composition...' },
  { pct: 48, msg: 'Rendering frame 1 of 24...' },
  { pct: 56, msg: 'Rendering frame 6 of 24...' },
  { pct: 64, msg: 'Rendering frame 12 of 24...' },
  { pct: 74, msg: 'Rendering frame 18 of 24...' },
  { pct: 83, msg: 'Rendering frame 24 of 24...' },
  { pct: 91, msg: 'Applying motion smoothing...' },
  { pct: 97, msg: 'Finalizing video...' },
];

function LoadingVideoCard({ durationMs = 3000, ratio = '16/9' }) {
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
    <div style={{
      aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', position: 'relative',
      background: 'linear-gradient(135deg,#2a0a0a,#6B1515)',
      border: '1px solid #E01E1E',
      boxShadow: '0 0 30px rgba(224,30,30,0.35), 0 12px 36px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <div style={{ fontSize: 24, color: '#FFF' }}>✦</div>
        <div style={{
          fontSize: 10, color: '#E01E1E', fontWeight: 700,
          fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: '0.14em', textTransform: 'uppercase',
        }}>Generating · {pct}%</div>
        <div style={{ width: '70%', height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 999 }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: '#E01E1E', boxShadow: '0 0 10px #E01E1E',
            borderRadius: 999, transition: 'width 0.12s ease',
          }} />
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{msg}</div>
      </div>
    </div>
  );
}

const RATIO_MAP = {
  'Auto': '16/9',
  '16:9': '16/9',
  '9:16': '9/16',
  '1:1':  '1/1',
  '4:3':  '4/3',
  '21:9': '21/9',
};

export default function VideoRightArea({ videos = [], isGenerating = false, durationMs = 3000, aspectRatio = 'Auto', onVideoClick, modelName = 'Kling 3.0' }) {
  const ratio = RATIO_MAP[aspectRatio] || '16/9';
  const [activeTab, setActiveTab] = useState('creations');

  return (
    <div style={{ flex: 1, height:'100%', overflowY:'auto', background:'transparent', display:'flex', flexDirection:'column', padding: '24px 28px' }}>
      {/* Hero block — eyebrow + Anton 44 + Creations/Collections pills.
          Replaces the previous tabs+toolbar row per V_Video_V1. */}
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{
            display:'inline-flex', alignItems:'center', gap: 8,
            fontSize: 10.5, color: '#E01E1E',
            fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: '0.14em', textTransform: 'uppercase',
            marginBottom: 8, fontWeight: 600,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#E01E1E',
              boxShadow: '0 0 10px #E01E1E',
              animation: 'glowPulse2 2s ease-in-out infinite',
            }} />
            {modelName} · Frame to Video
          </div>
          <div style={{
            fontFamily: 'Anton, sans-serif',
            fontSize: 44, letterSpacing: '0.01em', lineHeight: 0.95,
            color: '#FFF', textTransform: 'uppercase',
          }}>
            BRING IT TO LIFE
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap: 6 }}>
          {[
            { id: 'creations', label: 'Creations', icon: '✦' },
            { id: 'collections', label: 'Collections', icon: null },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display:'inline-flex', alignItems:'center', gap: 7,
              padding: '7px 14px', borderRadius: 999, fontSize: 12, fontWeight: 500,
              background: activeTab === tab.id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${activeTab === tab.id ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
              color: activeTab === tab.id ? '#FFF' : 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(14px)',
              cursor: 'pointer', fontFamily: font,
              transition: 'all 0.15s',
            }}>
              {tab.icon && <span style={{ color: '#E01E1E' }}>{tab.icon}</span>}
              {tab.label}
              {tab.id === 'creations' && <ChevronDown className="w-3 h-3" />}
            </button>
          ))}
        </div>
      </div>
      <style>{`@keyframes glowPulse2{0%,100%{opacity:0.5}50%{opacity:1}}`}</style>

      {/* Creations area */}
      {videos.length === 0 && !isGenerating ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, minHeight:500, background:'transparent' }}>
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
            <rect x="6" y="18" width="60" height="42" rx="5" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5"/>
            <rect x="6" y="18" width="60" height="10" rx="3" fill="rgba(255,255,255,0.08)"/>
            <line x1="14" y1="18" x2="10" y2="10" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeLinecap="round"/>
            <line x1="26" y1="18" x2="22" y2="10" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeLinecap="round"/>
            <line x1="38" y1="18" x2="34" y2="10" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeLinecap="round"/>
            <line x1="50" y1="18" x2="46" y2="10" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeLinecap="round"/>
            <line x1="62" y1="18" x2="58" y2="10" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="36" cy="43" r="10" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5"/>
            <polygon points="33,38 33,48 43,43" fill="rgba(255,255,255,0.15)"/>
          </svg>
          <p style={{ fontSize:14, color:'rgba(255,255,255,0.25)', fontFamily:font }}>No items to display</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:12 }}>
          {/* Loading card — shown first while generating */}
          {isGenerating && <LoadingVideoCard durationMs={durationMs} ratio={ratio} />}
          {/* Completed videos */}
          {videos.map((v, i) => {
            const grads = [
              'linear-gradient(135deg,#0a0a1a 0%,#1a0a2a 50%,#2a0a0a 100%)',
              'linear-gradient(135deg,#1a0000 0%,#8B0000 50%,#1a1a1a 100%)',
              'linear-gradient(135deg,#0d0d0d 0%,#2a0000 60%,#111 100%)',
              'linear-gradient(135deg,#1a1a0a 0%,#3a1a00 50%,#0a0a0a 100%)',
            ];
            const grad = v.gradient || grads[i % grads.length];
            const isPending = v.status === 'pending';
            const isFailed = v.status === 'failed';
            const isReady = v.status === 'completed' && v.result_url;

            const handleDownload = (e) => {
              e.stopPropagation();
              if (!v.result_url) return;
              const a = document.createElement('a');
              a.href = `/api/download?url=${encodeURIComponent(v.result_url)}&filename=voxel-video-${v.id || Date.now()}.mp4`;
              a.download = `voxel-video.mp4`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              toast.success('Video downloading — check your Downloads folder');
            };

            return (
              <div key={v.id || i}
                onClick={() => !isPending && onVideoClick && onVideoClick({ ...v, gradient: grad })}
                style={{ background:'#161616', borderRadius:14, border:`1px solid ${isPending ? 'rgba(224,30,30,0.3)' : '#0D0D0D'}`, overflow:'hidden', display:'flex', flexDirection:'column', cursor: isPending ? 'default' : 'pointer', transition:'all 0.18s' }}
                onMouseEnter={e => { if (!isPending) { e.currentTarget.style.border='1px solid rgba(224,30,30,0.4)'; e.currentTarget.style.transform='translateY(-2px)'; const p = e.currentTarget.querySelector('.vplay'); if (p) p.style.opacity='1'; }}}
                onMouseLeave={e => { e.currentTarget.style.border=`1px solid ${isPending ? 'rgba(224,30,30,0.3)' : '#0D0D0D'}`; e.currentTarget.style.transform='none'; const p = e.currentTarget.querySelector('.vplay'); if (p) p.style.opacity='0'; }}
              >
                <div style={{ aspectRatio: '16/9', background:grad, display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
                  {/* Pending: loading animation */}
                  {isPending && (
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                      <div style={{ width:40, height:40, borderRadius:'50%', background:'rgba(224,30,30,0.12)', border:'1px solid rgba(224,30,30,0.3)', display:'flex', alignItems:'center', justifyContent:'center', animation:'spin 1.8s linear infinite' }}>
                        <Sparkles style={{ width:16, height:16, color:'#FF4444' }} />
                      </div>
                      <span style={{ fontSize:11, color:'rgba(255,255,255,0.5)', fontFamily:font }}>Generating...</span>
                    </div>
                  )}

                  {/* Failed */}
                  {isFailed && (
                    <span style={{ fontSize:12, color:'#FF4444', fontFamily:font }}>Failed</span>
                  )}

                  {/* Completed: show video preview */}
                  {isReady && (
                    <video
                      src={v.result_url + '#t=0.1'}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedData={e => { e.target.currentTime = 0.1; }}
                      onMouseEnter={e => { try { e.target.src = v.result_url; e.target.play(); } catch {} }}
                      onMouseLeave={e => { try { e.target.pause(); e.target.src = v.result_url + '#t=0.1'; } catch {} }}
                      style={{ width:'100%', height:'100%', objectFit:'cover', position:'absolute', inset:0 }}
                    />
                  )}

                  {/* Play overlay (only on completed) */}
                  {isReady && (
                    <div className="vplay" style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center', opacity:0, transition:'opacity 0.18s' }}>
                      <div style={{ width:44, height:44, borderRadius:'50%', background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)', border:'2px solid rgba(255,255,255,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <span style={{ color:'#fff', fontSize:18, marginLeft:3 }}>▶</span>
                      </div>
                    </div>
                  )}

                  {/* Duration badge */}
                  <span style={{ position:'absolute', bottom:8, right:8, fontSize:10, color:'rgba(255,255,255,0.7)', background:'rgba(0,0,0,0.55)', padding:'2px 7px', borderRadius:6, fontFamily:font, zIndex:2 }}>0:{String(parseInt(v.duration)||5).padStart(2,'0')}</span>
                </div>
                <div style={{ padding:'10px 12px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <p style={{ fontSize:12, color:'rgba(255,255,255,0.5)', fontFamily:font, margin:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:1, marginRight:8 }}>{v.prompt}</p>
                  {isReady && (
                    <button onClick={handleDownload} title="Download HD video"
                      style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'rgba(255,255,255,0.5)', flexShrink:0, transition:'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background='rgba(224,30,30,0.15)'; e.currentTarget.style.color='#FF4444'; }}
                      onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.06)'; e.currentTarget.style.color='rgba(255,255,255,0.5)'; }}
                    >
                      <Download style={{ width:13, height:13 }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}