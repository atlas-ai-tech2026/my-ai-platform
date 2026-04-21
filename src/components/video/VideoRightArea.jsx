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
    <div style={{ background: '#161616', borderRadius: 14, border: '1px solid rgba(224,30,30,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Preview shimmer */}
      <div style={{ aspectRatio: '16/9', background: 'linear-gradient(135deg, #1a0000 0%, #2a0a0a 50%, #1a1a1a 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* Animated shimmer overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(224,30,30,0.07) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.6s linear infinite' }} />
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {/* Spinning icon */}
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(224,30,30,0.12)', border: '1px solid rgba(224,30,30,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.8s linear infinite' }}>
          <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          <Sparkles className="w-5 h-5" style={{ color: '#FF4444' }} />
        </div>
      </div>
      {/* Progress */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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

const RATIO_MAP = {
  'Auto': '16/9',
  '16:9': '16/9',
  '9:16': '9/16',
  '1:1':  '1/1',
  '4:3':  '4/3',
  '21:9': '21/9',
};

export default function VideoRightArea({ videos = [], isGenerating = false, durationMs = 3000, aspectRatio = 'Auto', onVideoClick, leftPanelWidth = 450 }) {
  const ratio = RATIO_MAP[aspectRatio] || '16/9';
  const [activeTab, setActiveTab] = useState('creations');

  return (
    <div style={{ flex: 1, height:'100%', overflowY:'auto', background:'#0D0D0D', borderLeft:'1px solid #0D0D0D', display:'flex', flexDirection:'column' }}>
      {/* Tabs row */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 20px', borderBottom:'1px solid #0D0D0D', position:'sticky', top:0, background:'#0D0D0D', zIndex:5 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:1 }}>
          {[{ id:'creations', label:'Creations', icon:'🎬', arrow:true }, { id:'collections', label:'Collections', icon:'📁' }].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:999,
              fontSize:13, fontFamily:font, cursor:'pointer', transition:'all 0.18s',
              background: activeTab===tab.id ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: activeTab===tab.id ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
              color: activeTab===tab.id ? '#fff' : 'rgba(255,255,255,0.4)',
              fontWeight: activeTab===tab.id ? 600 : 400,
            }}>
              <span>{tab.icon}</span>{tab.label}
              {tab.arrow && <ChevronDown className="w-3 h-3" />}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          {[SlidersHorizontal, MessageSquare, Video, Music].map((Icon, i) => (
            <button key={i} style={{ width:30, height:30, background:'transparent', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.3)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6 }}
              onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}
              onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.3)'}
            ><Icon className="w-4 h-4" /></button>
          ))}
          <button style={{ padding:'5px 12px', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:999, fontSize:12, color:'#fff', fontWeight:600, fontFamily:font, cursor:'pointer' }}>All</button>
          {[Star, Filter, Grid, Search].map((Icon, i) => (
            <button key={i} style={{ width:30, height:30, background:'transparent', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.3)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6 }}
              onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}
              onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.3)'}
            ><Icon className="w-4 h-4" /></button>
          ))}
        </div>
      </div>

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
        <div style={{ padding:20, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:14 }}>
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