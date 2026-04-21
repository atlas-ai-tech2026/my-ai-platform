import React, { useState, useEffect, useRef } from 'react';
import { Download, RefreshCw, ChevronRight, Play, Pause } from 'lucide-react';
import { Pill, SectionLabel, StyledTextarea, RedButton, GhostButton, ErrorBanner, LockedAssets, stepStyles } from './DirectorShared';

const CAMERA_MOTIONS = ['Static', 'Slow Zoom In', 'Slow Zoom Out', 'Pan Left', 'Pan Right', 'Dolly Forward', 'Dolly Back', 'Handheld Shake', 'Orbit Left', 'Orbit Right', 'Tilt Up', 'Tilt Down'];
const DURATIONS = ['3 seconds', '5 seconds', '8 seconds', '10 seconds'];
const INTENSITIES = ['Subtle', 'Moderate', 'Strong'];
const FRAME_RATES = ['24fps (cinematic)', '30fps', '60fps'];
const RESOLUTIONS = ['1080p', '4K'];
const VIDEO_MODELS = [
  { id: 'nano-banana-pro', name: 'Nano Banana Pro', credits: 400, badge: 'BEST' },
  { id: 'seedream-45', name: 'Seedream 4.5', credits: 250, badge: null },
  { id: 'wan-22', name: 'Wan 2.2 Video', credits: 200, badge: null },
  { id: 'nova-v2', name: 'Nova V2', credits: 180, badge: null },
];

const STATUS_CYCLE = ['Analyzing scene...', 'Applying motion...', 'Rendering frames...', 'Finalizing...'];

export default function Step6GenerateVideo({ shot, character, wardrobe, location, onComplete, onBack }) {
  const [cameraMotion, setCameraMotion] = useState('Slow Zoom In');
  const [duration, setDuration] = useState('5 seconds');
  const [intensity, setIntensity] = useState('Moderate');
  const [frameRate, setFrameRate] = useState('24fps (cinematic)');
  const [resolution, setResolution] = useState('1080p');
  const [motionDesc, setMotionDesc] = useState('');
  const [selectedModel, setSelectedModel] = useState(VIDEO_MODELS[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [outputUrl, setOutputUrl] = useState(null);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef(null);
  const progressInterval = useRef(null);
  const statusInterval = useRef(null);

  const simulateGeneration = () => {
    setProgress(0);
    let p = 0;
    let si = 0;
    setStatusText(STATUS_CYCLE[0]);
    progressInterval.current = setInterval(() => {
      p += Math.random() * 3 + 1;
      if (p >= 98) p = 98;
      setProgress(p);
    }, 300);
    statusInterval.current = setInterval(() => {
      si = (si + 1) % STATUS_CYCLE.length;
      setStatusText(STATUS_CYCLE[si]);
    }, 2500);
  };

  const stopSimulation = () => {
    clearInterval(progressInterval.current);
    clearInterval(statusInterval.current);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setOutputUrl(null);
    simulateGeneration();
    // Simulate a video generation (real video gen API not available in this context)
    await new Promise(r => setTimeout(r, 8000));
    stopSimulation();
    setProgress(100);
    // Use the shot image as a placeholder for the "video" (real implementation would call a video model)
    setOutputUrl(shot?.shot_url || null);
    setIsGenerating(false);
    setStatusText('Done!');
  };

  useEffect(() => () => stopSimulation(), []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); }
      else { videoRef.current.play(); setIsPlaying(true); }
    }
  };

  const handleDownload = () => {
    if (!outputUrl) return;
    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = 'voxel-clip.mp4';
    a.click();
  };

  const lockedAssets = [];
  if (shot?.shot_url) lockedAssets.push({ url: shot.shot_url, label: 'Source Frame', wide: true });

  const creditCost = selectedModel.credits * parseInt(duration);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>{stepStyles}</style>
      <LockedAssets assets={lockedAssets} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left panel */}
        <div style={{ width: 310, borderRight: '1px solid rgba(255,255,255,0.06)', padding: '16px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }} className="hide-scrollbar">
          <div>
            <SectionLabel>Camera Motion</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {CAMERA_MOTIONS.map(m => <Pill key={m} label={m} active={cameraMotion === m} onClick={() => setCameraMotion(m)} />)}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <SectionLabel>Duration</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {DURATIONS.map(d => <Pill key={d} label={d} active={duration === d} onClick={() => setDuration(d)} />)}
              </div>
            </div>
            <div>
              <SectionLabel>Motion Intensity</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {INTENSITIES.map(i => <Pill key={i} label={i} active={intensity === i} onClick={() => setIntensity(i)} />)}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <SectionLabel>Frame Rate</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {FRAME_RATES.map(f => <Pill key={f} label={f} active={frameRate === f} onClick={() => setFrameRate(f)} />)}
              </div>
            </div>
            <div>
              <SectionLabel>Resolution</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {RESOLUTIONS.map(r => <Pill key={r} label={r} active={resolution === r} onClick={() => setResolution(r)} />)}
              </div>
            </div>
          </div>
          <div>
            <SectionLabel>Motion Description</SectionLabel>
            <StyledTextarea value={motionDesc} onChange={setMotionDesc} placeholder="e.g. slow dolly forward as character turns head, hair moves slightly in wind" rows={2} />
          </div>
          <div>
            <SectionLabel>Video Model</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {VIDEO_MODELS.map(m => (
                <button key={m.id} onClick={() => setSelectedModel(m)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: selectedModel.id === m.id ? 'rgba(229,57,53,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selectedModel.id === m.id ? 'rgba(229,57,53,0.45)' : 'rgba(255,255,255,0.07)'}`,
                  transition: 'all 0.15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedModel.id === m.id ? '#E53935' : 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                    <span style={{ color: selectedModel.id === m.id ? '#fff' : 'rgba(255,255,255,0.65)', fontSize: 12, fontFamily: '"DM Sans", sans-serif', fontWeight: selectedModel.id === m.id ? 600 : 400 }}>{m.name}</span>
                    {m.badge && <span style={{ background: 'rgba(229,57,53,0.2)', border: '1px solid rgba(229,57,53,0.4)', borderRadius: 4, padding: '1px 5px', fontSize: 9, color: '#E53935', fontWeight: 700 }}>{m.badge}</span>}
                  </div>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>✦ {m.credits}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 14, overflow: 'hidden' }}>
          {/* Video canvas */}
          <div style={{
            flex: 1, background: '#0D0D0D', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden', position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: 380,
          }}>
            {isGenerating && (
              <>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#1a1a1a', zIndex: 10 }}>
                  <div style={{ height: '100%', width: `${progress}%`, background: '#E53935', boxShadow: '0 0 10px rgba(229,57,53,0.6)', transition: 'width 0.3s ease' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 52, height: 52, border: '3px solid rgba(255,255,255,0.08)', borderTopColor: '#E53935', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>{statusText}</div>
                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{Math.floor(progress)}%</div>
                </div>
              </>
            )}
            {!isGenerating && outputUrl && (
              <>
                <img src={outputUrl} alt="Video frame" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
                  <button onClick={togglePlay} style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                </div>
              </>
            )}
            {!isGenerating && !outputUrl && shot?.shot_url && (
              <img src={shot.shot_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.4 }} />
            )}
            {!isGenerating && !outputUrl && !shot?.shot_url && (
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 14, textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>🎬</div>
                Configure motion and generate your video clip
              </div>
            )}
          </div>

          {error && <ErrorBanner message={error} onRetry={handleGenerate} />}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 13, padding: '11px 18px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', flexShrink: 0 }}>← Back</button>
            {outputUrl && (
              <>
                <GhostButton onClick={handleDownload}>
                  <Download size={14} /> Download Clip
                </GhostButton>
                <GhostButton onClick={handleGenerate} disabled={isGenerating}>
                  <RefreshCw size={14} /> Different Motion
                </GhostButton>
                <RedButton onClick={() => onComplete({ video_url: outputUrl })} style={{ flex: 1 }}>
                  <ChevronRight size={16} /> Add to Timeline →
                </RedButton>
              </>
            )}
            {!outputUrl && (
              <RedButton onClick={handleGenerate} disabled={isGenerating} style={{ flex: 1 }}>
                {isGenerating ? `${statusText}` : `Generate Video Clip → ✦ ~${selectedModel.credits} credits`}
              </RedButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}