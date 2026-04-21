import React, { useState } from 'react';
import { ArrowLeft, ChevronRight, ChevronDown, Minus, Plus, Sparkles, Zap, Video, ArrowLeftRight, Music, Monitor, Clock, RatioIcon } from 'lucide-react';

const CAMERA_MOTIONS = [
  { id: 'zoom-in',   icon: '🔍+', label: 'Zoom In'   },
  { id: 'zoom-out',  icon: '🔍-', label: 'Zoom Out'  },
  { id: 'pan-left',  icon: '←',   label: 'Pan Left'  },
  { id: 'pan-right', icon: '→',   label: 'Pan Right' },
  { id: 'tilt-up',   icon: '↑',   label: 'Tilt Up'   },
  { id: 'tilt-down', icon: '↓',   label: 'Tilt Down' },
  { id: 'orbit',     icon: '🔄',  label: 'Orbit'     },
  { id: 'handheld',  icon: '📷',  label: 'Handheld'  },
  { id: 'static',    icon: '⊙',   label: 'Static'    },
];

const DURATION_OPTIONS = ['5s', '10s', '15s'];
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4K'];
const ASPECT_RATIO_OPTIONS = ['Auto', '16:9', '9:16', '1:1', '4:3', '21:9'];
const S = { font: '"DM Sans", sans-serif' };

export default function VideoLeftPanel({ prompt, onPromptChange, onGenerate, isGenerating, count, onCountChange, model, onModelClick, duration, onDurationChange, resolution, onResolutionChange, aspectRatio, onAspectRatioChange, startFrame: startFrameProp, endFrame: endFrameProp, onStartFrameChange, onEndFrameChange, onCameraMotionChange }) {
  const [mode, setMode] = useState('frame');
  const [cameraMotion, setCameraMotion] = useState(null);
  const [showCameraDrop, setShowCameraDrop] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [showDurationDrop, setShowDurationDrop] = useState(false);
  const [showResDrop, setShowResDrop] = useState(false);
  const [showRatioDrop, setShowRatioDrop] = useState(false);
  const [localStartFrame, setLocalStartFrame] = useState(null);
  const [localEndFrame, setLocalEndFrame] = useState(null);

  const startFrame = startFrameProp !== undefined ? startFrameProp : localStartFrame;
  const endFrame = endFrameProp !== undefined ? endFrameProp : localEndFrame;
  const setStartFrame = (v) => { setLocalStartFrame(v); onStartFrameChange?.(v); };
  const setEndFrame = (v) => { setLocalEndFrame(v); onEndFrameChange?.(v); };

  const handleFrameUpload = (type, e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (type === 'start') setStartFrame(url);
    else setEndFrame(url);
  };

  const handleSwapFrames = () => {
    const s = startFrame, en = endFrame;
    setStartFrame(en);
    setEndFrame(s);
  };

  const handleCameraSelect = (m) => {
    const next = cameraMotion === m.id ? null : m.id;
    setShowResDrop(false); setShowDurationDrop(false); setShowRatioDrop(false);
    setCameraMotion(next);
    // Backend-only injection: do NOT mutate the prompt text. Emit up so parent can inject at API call.
    const nextMotion = next ? { id: m.id, label: m.label } : null;
    onCameraMotionChange && onCameraMotionChange(nextMotion);
    setShowCameraDrop(false);
  };

  const clearCameraMotion = (e) => {
    if (e) e.stopPropagation();
    setCameraMotion(null);
    onCameraMotionChange && onCameraMotionChange(null);
  };

  const selectedMotion = CAMERA_MOTIONS.find(m => m.id === cameraMotion);
  const canSwap = !!(startFrame || endFrame);

  return (
    <div style={{
      width: 380, minWidth: 380, maxWidth: 380, flexShrink: 0,
      height: '100%',
      background: '#0A0A0A',
      borderRight: '1px solid #1A1A1A',
      overflowY: 'auto',
      left: 0, top: 60,
      display: 'flex', flexDirection: 'column',
      paddingBottom: 12,
      scrollbarWidth: 'none',
    }}>
      <style>{`
        .vl-ta::placeholder { color: rgba(255,255,255,0.2); font-size: 12px; font-family: "DM Sans",sans-serif; }
        .vl-ta:focus { border-color: rgba(224,30,30,0.4) !important; outline: none; }
        .vl-cam-opt:hover { background: #222 !important; border-color: rgba(224,30,30,0.3) !important; color: #fff !important; }
        .vl-drop-opt:hover { background: rgba(255,255,255,0.06) !important; }
        .vl-small-box:hover { background: #2E2E2E !important; border-color: rgba(224,30,30,0.4) !important; }
      `}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 14px 10px' }}>
        <button style={{ width:26, height:26, background:'transparent', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.5)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span style={{ color:'#fff', fontSize:14, fontWeight:600, fontFamily:S.font }}>Frame to Video</span>
      </div>

      {/* ═══ MAIN BOX — wraps everything including generate ═══ */}
      <div style={{ margin:'0 10px 10px 10px', background:'#181818', border:'1px solid #2A2A2A', borderRadius:16, padding:'12px 10px', display:'flex', flexDirection:'column', gap:10 }}>

        {/* Mode tabs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[{ id:'frame', icon:'🎞', label:'Start/End Frame' }, { id:'text', icon:'📝', label:'Text' }].map(tab => (
            <button key={tab.id} onClick={() => setMode(tab.id)} style={{
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              gap:5, padding:'10px 8px', borderRadius:10, cursor:'pointer',
              background: mode===tab.id ? 'linear-gradient(135deg, #7A0000 0%, #C01010 40%, #E01E1E 100%)' : '#161616',
              border:`1px solid ${mode===tab.id ? 'rgba(224,30,30,0.6)' : '#262626'}`,
              color: mode===tab.id ? '#fff' : 'rgba(255,255,255,0.5)',
              fontFamily:S.font, fontSize:12, transition:'all 0.2s',
              boxShadow: mode===tab.id ? 'inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 12px rgba(224,30,30,0.3)' : 'none',
            }}>
              <span style={{ fontSize:16 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Model row */}
        <button onClick={onModelClick} style={{
          width:'100%', display:'flex', alignItems:'center', gap:10,
          padding:'10px 12px', background:'#252525', border:'1px solid #383838',
          borderRadius:10, cursor:'pointer', transition:'all 0.18s', textAlign:'left',
        }}
          onMouseEnter={e => { e.currentTarget.style.background='#2E2E2E'; e.currentTarget.style.borderColor='rgba(224,30,30,0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.background='#252525'; e.currentTarget.style.borderColor='#383838'; }}
        >
          <div style={{ width:34, height:34, borderRadius:'50%', background: model?.color || '#1B7FE4', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:'#fff', flexShrink:0 }}>
            {(model?.brand || 'K').charAt(0)}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.45)', fontFamily:S.font }}>Model</div>
            <div style={{ fontSize:14, fontWeight:600, color:'#fff', fontFamily:S.font }}>{model?.name || 'Kling 2.6'}</div>
          </div>
          <ChevronRight className="w-4 h-4" style={{ color:'rgba(255,255,255,0.3)' }} />
        </button>

        {/* Start & End Frame */}
        {mode === 'frame' && (
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'#fff', fontFamily:S.font, marginBottom:8 }}>Set start &amp; end frame</div>
            <div style={{ background:'#141414', border:'1px solid #252525', borderRadius:10, padding:8, display:'flex', alignItems:'center', gap:8 }}>
              {['start', 'end'].map((type, i) => {
                const frameUrl = i === 0 ? startFrame : endFrame;
                return (
                  <React.Fragment key={type}>
                    {i === 1 && (
                      <button
                        onClick={handleSwapFrames}
                        title="Swap start & end frames"
                        style={{
                          width:34, height:34, flexShrink:0,
                          background: canSwap ? 'rgba(224,30,30,0.12)' : '#0D0D0D',
                          border: `1px solid ${canSwap ? 'rgba(224,30,30,0.5)' : '#2A2A2A'}`,
                          borderRadius:8, cursor: canSwap ? 'pointer' : 'default',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          color: canSwap ? '#FF5555' : 'rgba(255,255,255,0.3)',
                          transition:'all 0.15s',
                        }}
                        onMouseEnter={e => { if (canSwap) { e.currentTarget.style.background='rgba(224,30,30,0.25)'; e.currentTarget.style.color='#fff'; }}}
                        onMouseLeave={e => { if (canSwap) { e.currentTarget.style.background='rgba(224,30,30,0.12)'; e.currentTarget.style.color='#FF5555'; }}}
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <div
                      style={{ flex:1, minHeight:100, position:'relative' }}
                      onMouseEnter={e => { const btn = e.currentTarget.querySelector('.frame-x-btn'); if (btn) btn.style.opacity='1'; }}
                      onMouseLeave={e => { const btn = e.currentTarget.querySelector('.frame-x-btn'); if (btn) btn.style.opacity='0'; }}
                    >
                      <label style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, cursor:'pointer', padding:'12px 8px', transition:'all 0.2s', opacity: i===1 && !frameUrl ? 0.55 : 1, position:'relative', overflow:'hidden', height:'100%', minHeight:100, background:'#0D0D0D', border:'1.5px solid #303030', borderRadius:10 }}
                        onMouseEnter={e => { if (!frameUrl) { e.currentTarget.style.borderColor='rgba(224,30,30,0.5)'; e.currentTarget.style.background='rgba(224,30,30,0.05)'; e.currentTarget.style.opacity='1'; }}}
                        onMouseLeave={e => { if (!frameUrl) { e.currentTarget.style.borderColor='#303030'; e.currentTarget.style.background='#0D0D0D'; e.currentTarget.style.opacity= i===1 ? '0.55' : '1'; }}}
                      >
                        <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => handleFrameUpload(type, e)} />
                        {frameUrl ? (
                          <img src={frameUrl} alt={`${type} frame`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', borderRadius:10 }} />
                        ) : (
                          <>
                            <div style={{ width:32, height:32, borderRadius:'50%', background:'#E01E1E', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:18, fontWeight:700 }}>+</div>
                            <span style={{ fontSize:12, color:'rgba(255,255,255,0.4)', fontFamily:S.font, textAlign:'center', lineHeight:1.4 }}>Add a {type}<br/>frame</span>
                          </>
                        )}
                      </label>
                      {frameUrl && (
                        <button
                          className="frame-x-btn"
                          onClick={e => { e.stopPropagation(); if (type === 'start') setStartFrame(null); else setEndFrame(null); }}
                          style={{ position:'absolute', top:6, right:6, width:24, height:24, borderRadius:'50%', background:'rgba(30,30,30,0.85)', border:'1.5px solid rgba(255,255,255,0.25)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff', fontSize:12, zIndex:10, opacity:0, transition:'opacity 0.18s, background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background='rgba(180,0,0,0.9)'}
                          onMouseLeave={e => e.currentTarget.style.background='rgba(30,30,30,0.85)'}
                        >✕</button>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Describe textarea */}
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
            <span style={{ fontSize:12, fontWeight:600, color:'#fff', fontFamily:S.font }}>Describe your video</span>
            <button style={{ width:24, height:24, background:'#0D0D0D', border:'1px solid #2A2A2A', borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.5)', transition:'all 0.18s' }}
              onMouseEnter={e => { e.currentTarget.style.background='#2A2A2A'; e.currentTarget.style.color='#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background='#0D0D0D'; e.currentTarget.style.color='rgba(255,255,255,0.5)'; }}
            ><Zap className="w-3.5 h-3.5" /></button>
          </div>
          <div style={{ position:'relative' }}>
            <textarea
              value={prompt}
              onChange={e => onPromptChange && onPromptChange(e.target.value)}
              placeholder="Describe scene transitions, camera movement trajectories, or character actions with text to precisely control the entire video from beginning to end."
              rows={4}
              className="vl-ta"
              style={{ width:'100%', background:'#0D0D0D', border:'1px solid #2A2A2A', borderRadius:8, padding: selectedMotion ? '34px 12px 32px 12px' : '10px 12px 32px 12px', color:'rgba(255,255,255,0.8)', fontSize:12, lineHeight:1.5, fontFamily:S.font, resize:'none', boxSizing:'border-box', transition:'border-color 0.2s' }}
            />
            {/* Camera motion chip — floats inside top-left of textarea. Click to change; × to clear. */}
            {selectedMotion && (
              <div
                onClick={() => setShowCameraDrop(v => !v)}
                title="Click to change camera motion"
                style={{ position:'absolute', top:8, left:8, display:'inline-flex', alignItems:'center', gap:6, padding:'3px 8px 3px 10px', background:'rgba(224,30,30,0.15)', border:'1px solid rgba(224,30,30,0.55)', borderRadius:999, cursor:'pointer', color:'#FF5555', fontSize:11, fontWeight:600, fontFamily:S.font, zIndex:3, transition:'all 0.18s' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(224,30,30,0.28)'; e.currentTarget.style.color='#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background='rgba(224,30,30,0.15)'; e.currentTarget.style.color='#FF5555'; }}
              >
                <span>{selectedMotion.label}</span>
                <span
                  onClick={clearCameraMotion}
                  style={{ width:14, height:14, borderRadius:'50%', background:'rgba(0,0,0,0.35)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:10, lineHeight:1, color:'#fff' }}
                >✕</span>
              </div>
            )}
            {/* Prompt enhancer inside textarea — bottom left */}
            <button
              title="Enhance prompt with AI"
              style={{ position:'absolute', bottom:10, left:10, width:26, height:26, background:'rgba(224,30,30,0.12)', border:'1px solid rgba(224,30,30,0.35)', borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'rgba(255,80,80,0.9)', transition:'all 0.18s', zIndex:2 }}
              onMouseEnter={e => { e.currentTarget.style.background='rgba(224,30,30,0.28)'; e.currentTarget.style.color='#fff'; e.currentTarget.style.borderColor='rgba(224,30,30,0.7)'; }}
              onMouseLeave={e => { e.currentTarget.style.background='rgba(224,30,30,0.12)'; e.currentTarget.style.color='rgba(255,80,80,0.9)'; e.currentTarget.style.borderColor='rgba(224,30,30,0.35)'; }}
            >
              <Zap className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Camera Motion */}
        <div style={{ position:'relative' }}>
          <button
            onClick={() => setShowCameraDrop(v => !v)}
            style={{
              width:'100%', padding:'9px 12px', background:'#161616', border:'1px solid #2A2A2A',
              borderRadius:8, display:'flex', alignItems:'center', justifyContent:'space-between',
              cursor:'pointer', color: selectedMotion ? '#FF4444' : 'rgba(255,255,255,0.7)',
              fontSize:12, fontFamily:S.font, transition:'all 0.18s',
            }}
            onMouseEnter={e => e.currentTarget.style.background='#0D0D0D'}
            onMouseLeave={e => e.currentTarget.style.background='#161616'}
          >
            <span style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Video className="w-4 h-4" />
              {selectedMotion ? `Camera Motion: ${selectedMotion.label}` : 'Camera Motion'}
            </span>
            <ChevronDown className="w-4 h-4" style={{ transform: showCameraDrop ? 'rotate(180deg)' : 'none', transition:'transform 0.2s', color:'rgba(255,255,255,0.4)' }} />
          </button>
          {showCameraDrop && (
            <div style={{ marginTop:4, background:'#161616', border:'1px solid #2A2A2A', borderRadius:8, padding:6, display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:5 }}>
              {CAMERA_MOTIONS.map(m => {
                const isActive = cameraMotion === m.id;
                return (
                  <button key={m.id} onClick={() => handleCameraSelect(m)} className="vl-cam-opt"
                    style={{ padding:'7px 6px', background: isActive ? 'rgba(224,30,30,0.1)' : '#1A1A1A', border:`1px solid ${isActive ? '#E01E1E' : '#2A2A2A'}`, borderRadius:6, display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer', fontSize:10, color: isActive ? '#FF4444' : 'rgba(255,255,255,0.6)', fontFamily:S.font, transition:'all 0.15s' }}>
                    <span style={{ fontSize:18 }}>{m.icon}</span>
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Audio + Resolution + Duration + Ratio — compact, model-box color */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:4 }}>

          {/* Audio */}
          <div className="vl-small-box" style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 6px', background:'#252525', border:'1px solid #383838', borderRadius:8, cursor:'pointer', transition:'all 0.18s', minWidth:0 }}
            onMouseEnter={e => { e.currentTarget.style.background='#2E2E2E'; e.currentTarget.style.borderColor='rgba(224,30,30,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.background='#252525'; e.currentTarget.style.borderColor='#383838'; }}
          >
            <Music style={{ width:11, height:11, color:'rgba(255,255,255,0.4)', flexShrink:0 }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', fontFamily:S.font, lineHeight:1.1 }}>Audio</div>
              <div style={{ fontSize:11, fontWeight:600, color:'#fff', fontFamily:S.font }}>{audioOn ? 'On' : 'Off'}</div>
            </div>
            <div onClick={e => { e.stopPropagation(); setAudioOn(v => !v); }}
              style={{ width:20, height:11, background: audioOn ? '#E01E1E' : '#444', borderRadius:999, cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
              <div style={{ position:'absolute', width:7, height:7, background:'#fff', borderRadius:'50%', top:2, left: audioOn ? 11 : 2, transition:'left 0.2s' }} />
            </div>
          </div>

          {/* Resolution */}
          <div style={{ position:'relative', minWidth:0 }}>
            <div className="vl-small-box" style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 6px', background:'#252525', border:'1px solid #383838', borderRadius:8, cursor:'pointer', transition:'all 0.18s', minWidth:0 }}
              onClick={() => { setShowResDrop(v => !v); setShowDurationDrop(false); }}
              onMouseEnter={e => { e.currentTarget.style.background='#2E2E2E'; e.currentTarget.style.borderColor='rgba(224,30,30,0.4)'; }}
              onMouseLeave={e => { e.currentTarget.style.background='#252525'; e.currentTarget.style.borderColor='#383838'; }}
            >
              <Monitor style={{ width:11, height:11, color:'rgba(255,255,255,0.4)', flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', fontFamily:S.font, lineHeight:1.1 }}>Res</div>
                <div style={{ fontSize:11, fontWeight:600, color:'#fff', fontFamily:S.font, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{resolution}</div>
              </div>
            </div>
            {showResDrop && (
              <div style={{ position:'absolute', bottom:'calc(100% + 4px)', left:0, right:0, background:'#252525', border:'1px solid #383838', borderRadius:10, overflow:'hidden', zIndex:20 }}>
                {RESOLUTION_OPTIONS.map(opt => (
                  <div key={opt} className="vl-drop-opt" onClick={() => { onResolutionChange && onResolutionChange(opt); setShowResDrop(false); }}
                    style={{ padding:'9px 12px', fontSize:12, fontFamily:S.font, color: resolution===opt ? '#fff':'rgba(255,255,255,0.6)', background: resolution===opt ? 'rgba(224,30,30,0.1)':'transparent', cursor:'pointer', transition:'background 0.15s' }}>
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Duration */}
          <div style={{ position:'relative', minWidth:0 }}>
            <div className="vl-small-box" style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 6px', background:'#252525', border:'1px solid #383838', borderRadius:8, cursor:'pointer', transition:'all 0.18s', minWidth:0 }}
              onClick={() => { setShowDurationDrop(v => !v); setShowResDrop(false); setShowRatioDrop(false); }}
              onMouseEnter={e => { e.currentTarget.style.background='#2E2E2E'; e.currentTarget.style.borderColor='rgba(224,30,30,0.4)'; }}
              onMouseLeave={e => { e.currentTarget.style.background='#252525'; e.currentTarget.style.borderColor='#383838'; }}
            >
              <Clock style={{ width:11, height:11, color:'rgba(255,255,255,0.4)', flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', fontFamily:S.font, lineHeight:1.1 }}>Duration</div>
                <div style={{ fontSize:11, fontWeight:600, color:'#fff', fontFamily:S.font, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{duration}</div>
              </div>
            </div>
            {showDurationDrop && (
              <div style={{ position:'absolute', bottom:'calc(100% + 4px)', left:0, right:0, background:'#252525', border:'1px solid #383838', borderRadius:10, overflow:'hidden', zIndex:20 }}>
                {DURATION_OPTIONS.map(opt => (
                  <div key={opt} className="vl-drop-opt" onClick={() => { onDurationChange && onDurationChange(opt); setShowDurationDrop(false); }}
                    style={{ padding:'9px 12px', fontSize:12, fontFamily:S.font, color: duration===opt ? '#fff':'rgba(255,255,255,0.6)', background: duration===opt ? 'rgba(224,30,30,0.1)':'transparent', cursor:'pointer', transition:'background 0.15s' }}>
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Aspect Ratio */}
          <div style={{ position:'relative', minWidth:0 }}>
            <div className="vl-small-box" style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 6px', background:'#252525', border:'1px solid #383838', borderRadius:8, cursor:'pointer', transition:'all 0.18s', minWidth:0 }}
              onClick={() => { setShowRatioDrop(v => !v); setShowResDrop(false); setShowDurationDrop(false); }}
              onMouseEnter={e => { e.currentTarget.style.background='#2E2E2E'; e.currentTarget.style.borderColor='rgba(224,30,30,0.4)'; }}
              onMouseLeave={e => { e.currentTarget.style.background='#252525'; e.currentTarget.style.borderColor='#383838'; }}
            >
              <RatioIcon style={{ width:11, height:11, color:'rgba(255,255,255,0.4)', flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', fontFamily:S.font, lineHeight:1.1 }}>Ratio</div>
                <div style={{ fontSize:11, fontWeight:600, color:'#fff', fontFamily:S.font, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{aspectRatio || 'Auto'}</div>
              </div>
            </div>
            {showRatioDrop && (
              <div style={{ position:'absolute', bottom:'calc(100% + 4px)', left:0, right:0, background:'#252525', border:'1px solid #383838', borderRadius:10, overflow:'hidden', zIndex:20 }}>
                {ASPECT_RATIO_OPTIONS.map(opt => (
                  <div key={opt} className="vl-drop-opt" onClick={() => { onAspectRatioChange && onAspectRatioChange(opt); setShowRatioDrop(false); }}
                    style={{ padding:'9px 12px', fontSize:12, fontFamily:S.font, color: (aspectRatio||'Auto')===opt ? '#fff':'rgba(255,255,255,0.6)', background: (aspectRatio||'Auto')===opt ? 'rgba(224,30,30,0.1)':'transparent', cursor:'pointer', transition:'background 0.15s' }}>
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Divider before generate */}
        <div style={{ height:1, background:'rgba(255,255,255,0.06)', margin:'0 -12px' }} />

        {/* Count + Generate — inside the main box */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <button onClick={() => onCountChange && onCountChange(Math.max(1, count - 1))}
              style={{ width:28, height:28, background:'#1A1A1A', border:'1px solid #2A2A2A', borderRadius:7, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', transition:'all 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background='#2A2A2A'}
              onMouseLeave={e => e.currentTarget.style.background='#1A1A1A'}
            ><Minus className="w-3 h-3" /></button>
            <span style={{ fontSize:14, fontWeight:600, color:'#fff', fontFamily:S.font, minWidth:36, textAlign:'center' }}>
              {count}<span style={{ color:'rgba(255,255,255,0.35)' }}>/4</span>
            </span>
            <button onClick={() => onCountChange && onCountChange(Math.min(4, count + 1))}
              style={{ width:28, height:28, background:'#1A1A1A', border:'1px solid #2A2A2A', borderRadius:7, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', transition:'all 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background='#2A2A2A'}
              onMouseLeave={e => e.currentTarget.style.background='#1A1A1A'}
            ><Plus className="w-3 h-3" /></button>
          </div>
          <button onClick={() => onGenerate && onGenerate()} disabled={isGenerating}
            style={{
              flex:1, height:42,
              background: isGenerating ? 'rgba(139,0,0,0.5)' : 'linear-gradient(90deg, #CC0000 0%, #FF2222 50%, #E01E1E 100%)',
              border:'none', borderRadius:14, color:'#fff', fontSize:15, fontWeight:700, fontFamily:S.font,
              cursor: isGenerating ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'all 0.2s',
              boxShadow: isGenerating ? 'none' : '0 2px 20px rgba(224,30,30,0.35)',
            }}
            onMouseEnter={e => { if (!isGenerating) { e.currentTarget.style.background='linear-gradient(90deg, #DD0000 0%, #FF3333 50%, #FF2020 100%)'; e.currentTarget.style.boxShadow='0 4px 28px rgba(224,30,30,0.55)'; e.currentTarget.style.transform='translateY(-1px)'; }}}
            onMouseLeave={e => { if (!isGenerating) { e.currentTarget.style.background='linear-gradient(90deg, #CC0000 0%, #FF2222 50%, #E01E1E 100%)'; e.currentTarget.style.boxShadow='0 2px 20px rgba(224,30,30,0.35)'; e.currentTarget.style.transform='none'; }}}
          >
            {isGenerating ? 'Generating...' : <><span>Generate</span><Sparkles className="w-4 h-4" style={{ opacity:0.9 }} /><span style={{ fontSize:14, fontWeight:700, opacity:0.9 }}>100</span></>}
          </button>
        </div>

      </div>{/* end main box */}
    </div>
  );
}