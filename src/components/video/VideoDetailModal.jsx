import React, { useState, useRef, useEffect } from 'react';
import { X, Heart, Download, Share2, Copy, ChevronLeft, ChevronRight, RefreshCw, Wand2, Play, Pause, Volume2, VolumeX, Maximize, RotateCcw } from 'lucide-react';

const font = '"DM Sans", sans-serif';
const GRADS = [
  'linear-gradient(135deg,#0a0a1a 0%,#1a0a2a 50%,#2a0a0a 100%)',
  'linear-gradient(135deg,#1a0000 0%,#8B0000 50%,#1a1a1a 100%)',
  'linear-gradient(135deg,#0d0d0d 0%,#2a0000 60%,#111 100%)',
  'linear-gradient(135deg,#1a1a0a 0%,#3a1a00 50%,#0a0a0a 100%)',
];

// ── Cinematic video player ────────────────────────────────────────────────────
function VideoPlayer({ gradient, durationSec = 10 }) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const timerRef = useRef(null);
  const hideRef = useRef(null);

  useEffect(() => {
    if (playing) {
      const step = 100 / ((durationSec * 1000) / 80);
      timerRef.current = setInterval(() => {
        setProgress(p => {
          if (p >= 100) { setPlaying(false); clearInterval(timerRef.current); return 0; }
          return p + step;
        });
      }, 80);
    } else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [playing]);

  const showCtrl = () => {
    setShowControls(true);
    clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setShowControls(false), 2500);
  };

  const duration = durationSec;
  const currentSec = Math.round((progress / 100) * duration);
  const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  const scrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    setProgress(pct);
  };

  return (
    <div style={{ width:'100%', height:'100%', background:gradient||'#1a1a1a', position:'relative', overflow:'hidden', cursor:'default' }}
      onMouseMove={showCtrl}
      onClick={() => { setPlaying(v => !v); showCtrl(); }}
    >
      <style>{`
        @keyframes vdSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes vdPulse{0%,100%{opacity:0.6}50%{opacity:1}}
        @keyframes vdScanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
      `}</style>

      {/* Gradient bg */}
      <div style={{ position:'absolute', inset:0, background:gradient, opacity:0.95 }} />

      {/* Scanline effect for cinematic feel */}
      <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)', pointerEvents:'none' }} />

      {/* Letterbox bars */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:28, background:'rgba(0,0,0,0.4)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:60, background:'rgba(0,0,0,0.4)', pointerEvents:'none' }} />

      {/* Center play/pause */}
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', opacity: showControls || !playing ? 1 : 0, transition:'opacity 0.3s' }}>
        <div style={{ width:72, height:72, borderRadius:'50%', background:'rgba(0,0,0,0.55)', backdropFilter:'blur(12px)', border:'2px solid rgba(255,255,255,0.25)', display:'flex', alignItems:'center', justifyContent:'center', transition:'transform 0.15s, background 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.transform='scale(1.1)'; e.currentTarget.style.background='rgba(224,30,30,0.65)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.background='rgba(0,0,0,0.55)'; }}
        >
          {playing
            ? <Pause style={{ width:26, height:26, color:'#fff' }} />
            : <Play style={{ width:26, height:26, color:'#fff', marginLeft:4 }} />
          }
        </div>
      </div>

      {/* Bottom controls */}
      <div
        style={{ position:'absolute', bottom:0, left:0, right:0, padding:'20px 16px 14px', opacity: showControls ? 1 : 0, transition:'opacity 0.3s', pointerEvents: showControls ? 'all' : 'none' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Scrubber */}
        <div style={{ height:4, background:'rgba(255,255,255,0.2)', borderRadius:999, marginBottom:10, cursor:'pointer', position:'relative' }}
          onClick={scrub}
        >
          <div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,#CC0000,#FF3333)', borderRadius:999, transition:'width 0.08s linear', position:'relative' }}>
            <div style={{ position:'absolute', right:-6, top:'50%', transform:'translateY(-50%)', width:14, height:14, borderRadius:'50%', background:'#FF3333', boxShadow:'0 0 10px rgba(224,30,30,0.8)', border:'2px solid #fff' }} />
          </div>
        </div>

        {/* Controls row */}
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={() => setPlaying(v=>!v)} style={{ background:'none', border:'none', cursor:'pointer', color:'#fff', padding:0, display:'flex' }}>
            {playing ? <Pause style={{ width:18, height:18 }} /> : <Play style={{ width:18, height:18, marginLeft:1 }} />}
          </button>
          <button onClick={() => { setProgress(0); setPlaying(false); }} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.6)', padding:0, display:'flex' }}>
            <RotateCcw style={{ width:15, height:15 }} />
          </button>
          <button onClick={() => setMuted(v=>!v)} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.6)', padding:0, display:'flex' }}>
            {muted ? <VolumeX style={{ width:16, height:16 }} /> : <Volume2 style={{ width:16, height:16 }} />}
          </button>
          <span style={{ fontSize:12, color:'rgba(255,255,255,0.55)', fontFamily:font, flex:1 }}>
            {fmt(currentSec)} / {fmt(duration)}
          </span>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.35)', fontFamily:font, background:'rgba(255,255,255,0.08)', padding:'2px 8px', borderRadius:6 }}>HD</span>
          <button style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.6)', padding:0, display:'flex' }}>
            <Maximize style={{ width:16, height:16 }} />
          </button>
        </div>
      </div>

      
    </div>
  );
}

// ── Video with loading state + error fallback ────────────────────────────────
function VideoWithFallback({ src, gradient, durationSec }) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const videoRef = useRef(null);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      {/* Show loading/error overlay */}
      {status === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: gradient || '#1a1a1a', zIndex: 2, pointerEvents: 'none' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid rgba(224,30,30,0.3)', borderTopColor: '#E01E1E', animation: 'vdSpin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontFamily: font }}>Loading video...</span>
          <style>{`@keyframes vdSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      {status === 'error' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: gradient || '#1a1a1a', zIndex: 2 }}>
          <X style={{ width: 32, height: 32, color: '#FF4444' }} />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontFamily: font }}>Video failed to load</span>
          <button onClick={() => { setStatus('loading'); videoRef.current?.load(); }}
            style={{ padding: '6px 16px', borderRadius: 8, background: 'rgba(224,30,30,0.2)', border: '1px solid rgba(224,30,30,0.4)', color: '#FF4444', fontSize: 12, fontFamily: font, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        controls
        autoPlay
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        onCanPlay={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
    </div>
  );
}

const PLAYER_BOX_STYLES = {
  'Auto':  { width: '100%', maxWidth: 900, aspectRatio: '16/9' },
  '16:9':  { width: '100%', maxWidth: 900, aspectRatio: '16/9' },
  '9:16':  { height: 'min(65vh, 580px)', aspectRatio: '9/16', width: 'auto' },
  '1:1':   { width: 'min(55vh, 500px)', aspectRatio: '1/1' },
  '4:3':   { width: '100%', maxWidth: 720, aspectRatio: '4/3' },
  '21:9':  { width: '100%', maxWidth: 1000, aspectRatio: '21/9' },
};

// ── Main modal ────────────────────────────────────────────────────────────────
export default function VideoDetailModal({ video, videos = [], onClose, onNavigate }) {
  const [liked, setLiked] = useState(false);
  const [copied, setCopied] = useState(false);
  const idx = videos.findIndex(v => v.id === video.id);
  const grad = video.gradient || GRADS[idx % GRADS.length];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && idx > 0) onNavigate(videos[idx-1]);
      if (e.key === 'ArrowRight' && idx < videos.length-1) onNavigate(videos[idx+1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx]);

  const copyPrompt = () => {
    navigator.clipboard.writeText(video.prompt || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.94)', backdropFilter:'blur(14px)', display:'flex', alignItems:'center', justifyContent:'center', animation:'vdBgIn 0.2s ease' }}
      onClick={onClose}>
      <style>{`@keyframes vdBgIn{from{opacity:0}to{opacity:1}} @keyframes vdPanelIn{from{opacity:0;transform:scale(0.95) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>

      {/* Nav arrows */}
      {idx > 0 && (
        <button onClick={e=>{e.stopPropagation();onNavigate(videos[idx-1]);}}
          style={{ position:'absolute', left:16, top:'50%', transform:'translateY(-50%)', zIndex:10, width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.13)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff' }}>
          <ChevronLeft style={{ width:20, height:20 }} />
        </button>
      )}
      {idx < videos.length-1 && (
        <button onClick={e=>{e.stopPropagation();onNavigate(videos[idx+1]);}}
          style={{ position:'absolute', right:16, top:'50%', transform:'translateY(-50%)', zIndex:10, width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.13)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff' }}>
          <ChevronRight style={{ width:20, height:20 }} />
        </button>
      )}

      <div onClick={e=>e.stopPropagation()}
        style={{ display:'flex', flexDirection:'column', width:'min(1300px,98vw)', maxHeight:'96vh', background:'rgba(10,10,10,0.55)', backdropFilter:'blur(48px) saturate(1.8)', WebkitBackdropFilter:'blur(48px) saturate(1.8)', borderRadius:28, overflow:'hidden', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 0 100px rgba(224,30,30,0.1), 0 40px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.07)', animation:'vdPanelIn 0.25s ease' }}>

        {/* Top bar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:28, height:28, borderRadius:'50%', background:'linear-gradient(135deg,#E01E1E,#8B0000)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', fontFamily:font }}>V</div>
            <div>
              <p style={{ margin:0, fontSize:13, color:'#fff', fontWeight:600, fontFamily:font }}>You</p>
              <p style={{ margin:0, fontSize:11, color:'#555', fontFamily:font }}>Generated just now</p>
            </div>
          </div>
          <button onClick={onClose}
            style={{ width:30, height:30, borderRadius:8, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'rgba(255,255,255,0.5)' }}>
            <X style={{ width:15, height:15 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>
          {/* Video player */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#000', minWidth:0, overflow:'hidden' }}>
            <div style={{ flex:1, minHeight:0, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
              <div style={{ width:'100%', maxWidth:'100%', aspectRatio: (PLAYER_BOX_STYLES[video.aspectRatio || 'Auto']?.aspectRatio) || '16/9', borderRadius:12, overflow:'hidden', transition:'all 0.3s ease', background: grad }}>
                {video.result_url ? (
                  <VideoWithFallback
                    key={video.id}
                    src={video.result_url}
                    gradient={grad}
                    durationSec={parseInt(video.duration) || 5}
                  />
                ) : (
                  <VideoPlayer key={video.id} gradient={grad} durationSec={parseInt(video.duration) || 5} />
                )}
              </div>
            </div>

            {/* Thumbnail strip removed — clean player only */}
          </div>

          {/* Info panel */}
          <div style={{ width:300, flexShrink:0, background:'rgba(8,8,8,0.6)', backdropFilter:'blur(32px)', WebkitBackdropFilter:'blur(32px)', borderLeft:'1px solid rgba(255,255,255,0.08)', overflowY:'auto' }}
            className="hide-scrollbar">
            <div style={{ padding:16, display:'flex', flexDirection:'column', gap:14 }}>

              {/* Actions */}
              <div style={{ display:'flex', gap:6 }}>
                {[
                  { icon:Heart, label:'Like', active:liked, onClick:()=>setLiked(v=>!v) },
                  { icon:Download, label:'Export', active:false, onClick:() => {
                    if (video.result_url) {
                      const a = document.createElement('a');
                      a.href = `/api/download?url=${encodeURIComponent(video.result_url)}&filename=voxel-video-${video.id || Date.now()}.mp4`;
                      a.download = `voxel-video.mp4`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }
                  }},
                  { icon:Share2, label:'Share', active:false, onClick:()=>{} },
                ].map(({ icon:Icon, label, active, onClick }) => (
                  <button key={label} onClick={onClick}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:5, padding:'9px 4px', borderRadius:10, background:active?'rgba(224,30,30,0.1)':'rgba(255,255,255,0.04)', border:`1px solid ${active?'rgba(224,30,30,0.3)':'rgba(255,255,255,0.07)'}`, cursor:'pointer', transition:'all 0.15s' }}
                    onMouseEnter={e=>{if(!active)e.currentTarget.style.background='rgba(255,255,255,0.08)';}}
                    onMouseLeave={e=>{if(!active)e.currentTarget.style.background='rgba(255,255,255,0.04)';}}
                  >
                    <Icon style={{ width:14, height:14, color:active?'#FF4444':'rgba(255,255,255,0.5)', fill:active&&label==='Like'?'#FF4444':'none' }} />
                    <span style={{ fontSize:9, color:active?'#FF4444':'rgba(255,255,255,0.35)', fontFamily:font }}>{label}</span>
                  </button>
                ))}
              </div>

              {/* Prompt */}
              <div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.3)', fontFamily:font, textTransform:'uppercase', letterSpacing:'0.08em' }}>Prompt</span>
                  <button onClick={copyPrompt} style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:copied?'#4CAF50':'rgba(255,255,255,0.35)', fontFamily:font, background:'none', border:'none', cursor:'pointer' }}>
                    <Copy style={{ width:11, height:11 }} />{copied?'Copied!':'Copy'}
                  </button>
                </div>
                <p style={{ margin:0, fontSize:12, color:'rgba(255,255,255,0.7)', fontFamily:font, lineHeight:1.6, background:'rgba(255,255,255,0.03)', borderRadius:10, padding:'10px 12px', border:'1px solid rgba(255,255,255,0.06)' }}>
                  {video.prompt || 'No prompt provided'}
                </p>
              </div>

              {/* Meta */}
              <div>
                <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.3)', fontFamily:font, textTransform:'uppercase', letterSpacing:'0.08em', display:'block', marginBottom:8 }}>Details</span>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  {[
                    {label:'Duration',value: video.duration ? (String(video.duration).endsWith('s') ? video.duration : video.duration+'s') : '5s'},
                    {label:'Model',value:video.model||'Kling 2.6'},
                    {label:'Resolution',value: video.quality || video.resolution || '1080p'},
                    {label:'FPS',value:'24'},
                    // Edit-Video / Motion-Control extras: only render when present.
                    ...(typeof video.keep_audio === 'boolean' ? [{label:'Audio',value: video.keep_audio ? 'Keep' : 'Off'}] : []),
                    ...(typeof video.scene_control === 'boolean' ? [{label:'Scene control',value: video.scene_control ? 'On' : 'Off'}] : []),
                  ].map(({label,value})=>(
                    <div key={label} style={{ background:'rgba(255,255,255,0.03)', borderRadius:10, padding:'8px 10px', border:'1px solid rgba(255,255,255,0.06)' }}>
                      <p style={{ margin:0, fontSize:9, color:'rgba(255,255,255,0.28)', fontFamily:font, textTransform:'uppercase', letterSpacing:'0.06em' }}>{label}</p>
                      <p style={{ margin:'3px 0 0', fontSize:13, color:'#fff', fontFamily:font, fontWeight:600 }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sources strip — Edit Video (source clip + ref images) and
                  Motion Control (motion ref video + character image). */}
              {(video.source_video_url || video.motion_video_url || video.character_image_url || (video.reference_image_urls?.length || 0) > 0) && (
                <div>
                  <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.3)', fontFamily:font, textTransform:'uppercase', letterSpacing:'0.08em', display:'block', marginBottom:8 }}>Sources</span>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {video.source_video_url && (
                      <video src={video.source_video_url} muted loop playsInline style={{ width:80, height:60, borderRadius:6, objectFit:'cover', border:'1px solid rgba(224,30,30,0.4)' }} title="Source video" />
                    )}
                    {video.motion_video_url && (
                      <video src={video.motion_video_url} muted loop playsInline style={{ width:80, height:60, borderRadius:6, objectFit:'cover', border:'1px solid rgba(224,30,30,0.4)' }} title="Motion reference video" />
                    )}
                    {video.character_image_url && (
                      <img src={video.character_image_url} alt="character" title="Character image" style={{ width:60, height:60, borderRadius:6, objectFit:'cover', border:'1px solid rgba(224,30,30,0.4)' }} />
                    )}
                    {(video.reference_image_urls || []).map((url, i) => (
                      <img key={i} src={url} alt={`reference ${i + 1}`} style={{ width:60, height:60, borderRadius:6, objectFit:'cover', border:'1px solid rgba(255,255,255,0.1)' }} />
                    ))}
                  </div>
                </div>
              )}

              <div style={{ height:1, background:'rgba(255,255,255,0.05)' }} />

              {/* Actions */}
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.3)', fontFamily:font, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:2 }}>Actions</span>
                {[
                  { icon:Wand2, label:'Extend Video', desc:'Add more seconds' },
                  { icon:RefreshCw, label:'Regenerate', desc:'New result, same prompt' },
                ].map(({ icon:Icon, label, desc }) => (
                  <button key={label}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:12, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', cursor:'pointer', textAlign:'left', width:'100%', transition:'all 0.15s' }}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.07)';e.currentTarget.style.borderColor='rgba(255,255,255,0.12)';}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.03)';e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';}}
                  >
                    <div style={{ width:28, height:28, borderRadius:8, background:'rgba(224,30,30,0.12)', border:'1px solid rgba(224,30,30,0.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Icon style={{ width:12, height:12, color:'#FF4444' }} />
                    </div>
                    <div>
                      <p style={{ margin:0, fontSize:12, color:'#fff', fontFamily:font, fontWeight:500 }}>{label}</p>
                      <p style={{ margin:0, fontSize:10, color:'rgba(255,255,255,0.3)', fontFamily:font }}>{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}