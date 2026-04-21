import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Plus, RotateCcw, ChevronLeft, Film, Repeat } from 'lucide-react';

const CAMERA_MOTIONS = ['Static', 'Slow Zoom In', 'Slow Zoom Out', 'Pan Left', 'Pan Right', 'Dolly Forward', 'Dolly Back', 'Handheld', 'Orbit Left', 'Orbit Right', 'Tilt Up', 'Tilt Down'];
const INTENSITIES = ['Subtle', 'Moderate', 'Strong'];
const DURATIONS = ['3s', '5s', '8s', '10s'];
const VIDEO_MODELS = [
  { id: 'nano-pro', name: 'Nano Banana Pro', credits: 400, badge: 'BEST' },
  { id: 'seedream', name: 'Seedream 4.5', credits: 250 },
  { id: 'wan', name: 'Wan 2.2 Video', credits: 200 },
  { id: 'nova', name: 'Nova V2', credits: 180 },
];
const STATUS_CYCLE = ['Analyzing image...', 'Applying motion...', 'Rendering frames...', 'Finalizing...'];

const Pill = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{
    padding: '5px 13px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
    background: active ? '#E53935' : 'rgba(255,255,255,0.05)',
    border: `1px solid ${active ? '#E53935' : 'rgba(255,255,255,0.1)'}`,
    color: active ? '#fff' : 'rgba(255,255,255,0.55)',
    transition: 'all 0.15s', fontFamily: '"DM Sans", sans-serif', whiteSpace: 'nowrap',
    fontWeight: active ? 600 : 400,
  }}>{label}</button>
);

const SectionLabel = ({ children }) => (
  <div style={{
    color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
  }}>{children}</div>
);

const inputStyle = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 8, color: '#fff', fontSize: 13, padding: '10px 12px',
  outline: 'none', width: '100%', fontFamily: '"DM Sans", sans-serif', resize: 'none',
  lineHeight: 1.5, boxSizing: 'border-box', transition: 'border-color 0.2s',
};

export default function AnimateTab({ storyboardFrames, initialFrameId, onFrameAnimated, onBackToStoryboard, videoClips }) {
  const [selectedFrameId, setSelectedFrameId] = useState(initialFrameId || storyboardFrames[0]?.id || null);
  const [cameraMotion, setCameraMotion] = useState('Slow Zoom In');
  const [intensity, setIntensity] = useState('Moderate');
  const [duration, setDuration] = useState('5s');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState(VIDEO_MODELS[0]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [outputUrl, setOutputUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [hoveredClip, setHoveredClip] = useState(null);
  const progressRef = useRef(null);
  const statusRef = useRef(null);

  const selectedFrame = storyboardFrames.find(f => f.id === selectedFrameId);
  const sceneIndex = storyboardFrames.findIndex(f => f.id === selectedFrameId);

  useEffect(() => {
    if (initialFrameId) setSelectedFrameId(initialFrameId);
  }, [initialFrameId]);

  useEffect(() => {
    if (selectedFrame?.video_url) {
      setOutputUrl(selectedFrame.video_url);
    } else {
      setOutputUrl(null);
    }
    setIsPlaying(false);
  }, [selectedFrameId]);

  const startSim = () => {
    let p = 0, si = 0;
    setStatusText(STATUS_CYCLE[0]);
    progressRef.current = setInterval(() => {
      p = Math.min(p + Math.random() * 3 + 0.8, 96);
      setProgress(p);
    }, 280);
    statusRef.current = setInterval(() => {
      si = (si + 1) % STATUS_CYCLE.length;
      setStatusText(STATUS_CYCLE[si]);
    }, 1800);
  };

  const stopSim = () => {
    clearInterval(progressRef.current);
    clearInterval(statusRef.current);
  };

  useEffect(() => () => stopSim(), []);

  const handleAnimate = async () => {
    if (!selectedFrame) return;
    setIsAnimating(true);
    setOutputUrl(null);
    setProgress(0);
    startSim();
    await new Promise(r => setTimeout(r, 7000));
    stopSim();
    setProgress(100);
    setStatusText('Done!');
    setOutputUrl(selectedFrame.image_url); // placeholder — real impl would return video URL
    setIsAnimating(false);
    setIsPlaying(true);
  };

  const handleAddToTimeline = () => {
    if (!outputUrl || !selectedFrame) return;
    onFrameAnimated(selectedFrame.id, outputUrl, parseInt(duration));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT PANEL — Storyboard frames ── */}
        <div style={{ width: 186, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: '#0A0A0A' }}>
          {/* Back link */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <button
              onClick={onBackToStoryboard}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0, fontFamily: '"DM Sans", sans-serif', transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}
            >
              <ChevronLeft size={12} /> Back to Storyboard
            </button>
          </div>
          <div style={{ padding: '10px 12px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <SectionLabel>Storyboard Frames</SectionLabel>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }} className="hide-scrollbar">
            {storyboardFrames.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.18)', fontSize: 12, textAlign: 'center', padding: '20px 8px', lineHeight: 1.5 }}>No storyboard frames yet</div>
            ) : (
              storyboardFrames.map((frame, i) => (
                <button key={frame.id} onClick={() => setSelectedFrameId(frame.id)} style={{
                  width: '100%', marginBottom: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                }}>
                  <div style={{
                    borderRadius: 8, overflow: 'hidden',
                    border: `2px solid ${selectedFrameId === frame.id ? '#E53935' : 'rgba(255,255,255,0.07)'}`,
                    transition: 'border-color 0.15s',
                  }}>
                    <img src={frame.image_url} alt={`Scene ${i + 1}`} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
                    <div style={{ padding: '5px 8px', background: '#111', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: selectedFrameId === frame.id ? '#fff' : 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>Scene {i + 1}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, flexShrink: 0,
                        background: frame.animated ? 'rgba(76,175,80,0.12)' : 'rgba(255,255,255,0.05)',
                        color: frame.animated ? '#4CAF50' : 'rgba(255,255,255,0.25)',
                        border: `1px solid ${frame.animated ? 'rgba(76,175,80,0.25)' : 'rgba(255,255,255,0.07)'}`,
                      }}>
                        {frame.animated ? 'Animated ✓' : 'Not Animated'}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── CENTER COLUMN — Animation controls ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }} className="hide-scrollbar">
            {selectedFrame ? (
              <>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
                  Scene {sceneIndex + 1} — Source Frame
                </div>

                {/* Image preview */}
                <div style={{ aspectRatio: '16/9', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, display: 'block' }}>
                  <img src={selectedFrame.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>

                {/* Camera Motion */}
                <div>
                  <SectionLabel>Camera Motion</SectionLabel>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {CAMERA_MOTIONS.map(m => <Pill key={m} label={m} active={cameraMotion === m} onClick={() => setCameraMotion(m)} />)}
                  </div>
                </div>

                {/* Intensity + Duration row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <SectionLabel>Motion Intensity</SectionLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {INTENSITIES.map(x => <Pill key={x} label={x} active={intensity === x} onClick={() => setIntensity(x)} />)}
                    </div>
                  </div>
                  <div>
                    <SectionLabel>Duration</SectionLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {DURATIONS.map(d => <Pill key={d} label={d} active={duration === d} onClick={() => setDuration(d)} />)}
                    </div>
                  </div>
                </div>

                {/* Negative Prompt */}
                <div>
                  <SectionLabel>Negative Prompt</SectionLabel>
                  <textarea
                    value={negativePrompt}
                    onChange={e => setNegativePrompt(e.target.value)}
                    placeholder="What to avoid in the video... (e.g. blur, distortion, bad quality, flickering, watermark)"
                    rows={2}
                    style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.09)'}
                  />
                </div>

                {/* Model selector */}
                <div>
                  <SectionLabel>Model</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {VIDEO_MODELS.map(m => (
                      <button key={m.id} onClick={() => setSelectedModel(m)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                        background: selectedModel.id === m.id ? 'rgba(229,57,53,0.12)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${selectedModel.id === m.id ? '#E53935' : 'rgba(255,255,255,0.07)'}`,
                        transition: 'all 0.15s',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: selectedModel.id === m.id ? '#E53935' : 'rgba(255,255,255,0.18)' }} />
                          <span style={{ color: selectedModel.id === m.id ? '#fff' : 'rgba(255,255,255,0.55)', fontSize: 12, fontFamily: '"DM Sans", sans-serif', fontWeight: selectedModel.id === m.id ? 600 : 400 }}>{m.name}</span>
                          {m.badge && <span style={{ background: 'rgba(229,57,53,0.18)', border: '1px solid rgba(229,57,53,0.35)', borderRadius: 4, padding: '1px 5px', fontSize: 9, color: '#E53935', fontWeight: 700 }}>{m.badge}</span>}
                        </div>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>✦ {m.credits}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, marginTop: 8 }}>
                    This generation will cost ✦ ~{selectedModel.credits} credits
                  </div>
                </div>

                {/* Animate button */}
                <button
                  onClick={handleAnimate}
                  disabled={isAnimating}
                  style={{
                    width: '100%', padding: '14px',
                    background: isAnimating ? 'rgba(229,57,53,0.4)' : '#E53935',
                    border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700,
                    cursor: isAnimating ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    fontFamily: '"DM Sans", sans-serif',
                    boxShadow: isAnimating ? 'none' : '0 0 24px rgba(229,57,53,0.25)',
                    transition: 'all 0.18s', flexShrink: 0, position: 'relative', overflow: 'hidden',
                  }}
                  onMouseEnter={e => { if (!isAnimating) e.currentTarget.style.background = '#ff2222'; }}
                  onMouseLeave={e => { if (!isAnimating) e.currentTarget.style.background = '#E53935'; }}
                >
                  {isAnimating && (
                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${progress}%`, background: 'rgba(255,255,255,0.12)', transition: 'width 0.3s ease', pointerEvents: 'none' }} />
                  )}
                  <Film size={15} style={{ position: 'relative', zIndex: 1 }} />
                  <span style={{ position: 'relative', zIndex: 1 }}>
                    {isAnimating ? `${statusText} ${Math.floor(progress)}%` : '🎬 Animate Scene →'}
                  </span>
                </button>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center', padding: 40 }}>
                <Film size={40} style={{ color: 'rgba(255,255,255,0.08)' }} />
                <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, lineHeight: 1.6 }}>
                  ← Select a scene from your storyboard to animate
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL — Output ── */}
        <div style={{ width: 230, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Output</div>
          </div>
          {outputUrl ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12, gap: 10, overflowY: 'auto' }} className="hide-scrollbar">
              {/* Video player area */}
              <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                <img src={outputUrl} alt="Output" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {/* Controls overlay */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', padding: '10px 8px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => setIsPlaying(p => !p)}
                    style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                  >
                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.15)', borderRadius: 2 }}>
                    <div style={{ width: '40%', height: '100%', background: '#E53935', borderRadius: 2 }} />
                  </div>
                  <button
                    onClick={() => setIsLooping(l => !l)}
                    style={{ width: 22, height: 22, borderRadius: 5, background: isLooping ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${isLooping ? 'rgba(229,57,53,0.4)' : 'rgba(255,255,255,0.1)'}`, color: isLooping ? '#E53935' : 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                    title="Loop"
                  >
                    <Repeat size={10} />
                  </button>
                </div>
              </div>

              <button onClick={handleAnimate} disabled={isAnimating} style={ghostBtn}>
                <RotateCcw size={13} /> 🔄 Reanimate
              </button>
              <button
                onClick={() => { const a = document.createElement('a'); a.href = outputUrl; a.download = `scene-${sceneIndex + 1}.mp4`; a.click(); }}
                style={ghostBtn}
              >
                <Download size={13} /> ⬇️ Download Clip
              </button>
              <button
                onClick={handleAddToTimeline}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  background: '#E53935', border: 'none', borderRadius: 8, color: '#fff',
                  fontSize: 13, fontWeight: 700, padding: '10px', cursor: 'pointer',
                  fontFamily: '"DM Sans", sans-serif', transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#ff2222'}
                onMouseLeave={e => e.currentTarget.style.background = '#E53935'}
              >
                <Plus size={13} /> ➕ Add to Timeline
              </button>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, textAlign: 'center' }}>
              <Film size={28} style={{ color: 'rgba(255,255,255,0.08)' }} />
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, lineHeight: 1.5 }}>Animation output will appear here</div>
            </div>
          )}
        </div>
      </div>

      {/* ── TIMELINE STRIP (video clips) ── */}
      <div style={{
        height: 132, background: '#1A1A1A', borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ height: 30, display: 'flex', alignItems: 'center', padding: '0 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, gap: 10 }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Timeline — {videoClips.length} clip{videoClips.length !== 1 ? 's' : ''}
          </span>
          <div style={{ flex: 1 }} />
          <button style={{
            display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(229,57,53,0.1)', border: '1px solid rgba(229,57,53,0.22)', borderRadius: 6,
            padding: '3px 10px', color: '#E53935', fontSize: 11, cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', fontWeight: 600,
          }}>
            <Play size={10} /> ▷ Preview All
          </button>
        </div>
        <div style={{ flex: 1, overflowX: 'auto', display: 'flex', alignItems: 'center', padding: '8px 14px', gap: 6 }} className="hide-scrollbar">
          {videoClips.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.18)', fontSize: 12, fontStyle: 'italic' }}>
              Animated clips will appear here after you animate your scenes →
            </div>
          ) : (
            videoClips.map((clip, i) => (
              <div
                key={clip.id || i}
                onMouseEnter={() => setHoveredClip(clip.id)}
                onMouseLeave={() => setHoveredClip(null)}
                style={{ flexShrink: 0, width: 112, height: 84, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#111', position: 'relative' }}
              >
                {clip.url && <img src={clip.url} alt="" style={{ width: '100%', height: 58, objectFit: 'cover', display: 'block' }} />}
                <div style={{ padding: '3px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 600 }}>Scene {i + 1}</span>
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>{clip.duration || 5}s</span>
                </div>
                {/* Storyboard origin badge */}
                <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.65)', borderRadius: 4, padding: '1px 4px', display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Film size={8} style={{ color: '#E53935' }} />
                </div>
                {hoveredClip === clip.id && (
                  <button style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, background: 'rgba(229,57,53,0.15)', border: '1px solid rgba(229,57,53,0.3)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#E53935' }}>
                    ✕
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const ghostBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8, color: 'rgba(255,255,255,0.65)', fontSize: 13,
  padding: '9px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
  transition: 'all 0.15s',
};