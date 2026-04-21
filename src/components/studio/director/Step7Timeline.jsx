import React, { useState, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Download, Plus, Trash2, Copy, RefreshCw } from 'lucide-react';
import { RedButton, GhostButton, SectionLabel, stepStyles } from './DirectorShared';

const TRANSITIONS = ['Cut', 'Dissolve', 'Fade to Black', 'Wipe'];

export default function Step7Timeline({ clips, onAddNewScene, onExport }) {
  const [videoClips, setVideoClips] = useState(clips || []);
  const [selectedClip, setSelectedClip] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [transitions, setTransitions] = useState({});
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('00:00:00');
  const [contextMenu, setContextMenu] = useState(null);

  const totalDuration = videoClips.reduce((sum, c) => sum + (c.duration || 5), 0);
  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const handleRightClick = (e, clipIdx) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, clipIdx });
  };

  const closeCtx = () => setContextMenu(null);

  const deleteClip = (idx) => {
    setVideoClips(prev => prev.filter((_, i) => i !== idx));
    if (selectedClip === idx) setSelectedClip(null);
    closeCtx();
  };

  const duplicateClip = (idx) => {
    setVideoClips(prev => {
      const arr = [...prev];
      arr.splice(idx + 1, 0, { ...arr[idx] });
      return arr;
    });
    closeCtx();
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress(0);
    for (let i = 0; i <= 100; i += 2) {
      await new Promise(r => setTimeout(r, 80));
      setExportProgress(i);
    }
    setIsExporting(false);
    // Trigger download of first clip as placeholder
    if (videoClips[0]?.url) {
      const a = document.createElement('a');
      a.href = videoClips[0].url;
      a.download = 'voxel-film.mp4';
      a.click();
    }
  };

  const selectedClipData = selectedClip !== null ? videoClips[selectedClip] : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }} onClick={closeCtx}>
      <style>{stepStyles}</style>

      {/* Top controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onAddNewScene} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(229,57,53,0.1)', border: '1px solid rgba(229,57,53,0.3)', borderRadius: 8, color: '#E53935', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}>
            <Plus size={14} /> Add New Scene
          </button>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{videoClips.length} clip{videoClips.length !== 1 ? 's' : ''} · {formatTime(totalDuration)}</div>
        </div>
        <RedButton onClick={handleExport} disabled={isExporting || videoClips.length === 0} style={{ padding: '8px 18px' }}>
          <Download size={14} /> {isExporting ? `Rendering ${exportProgress}%` : 'Export Final Video'}
        </RedButton>
      </div>

      {isExporting && (
        <div style={{ height: 3, background: '#1a1a1a', flexShrink: 0 }}>
          <div style={{ height: '100%', width: `${exportProgress}%`, background: '#E53935', transition: 'width 0.2s', boxShadow: '0 0 8px rgba(229,57,53,0.5)' }} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Main area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Preview player */}
          <div style={{ flex: 1, background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 0 }}>
            {videoClips.length > 0 && videoClips[0]?.url ? (
              <img src={videoClips[0].url} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: 14, textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.2 }}>▶</div>
                No clips yet — add a scene to get started
              </div>
            )}
            {/* Playback controls overlay */}
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.7)', borderRadius: 30, padding: '8px 16px', backdropFilter: 'blur(12px)' }}>
              <button onClick={() => {}} style={ctrlBtn}><SkipBack size={14} /></button>
              <button onClick={() => setIsPlaying(p => !p)} style={{ ...ctrlBtn, background: 'rgba(229,57,53,0.3)', border: '1px solid rgba(229,57,53,0.5)' }}>
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button onClick={() => {}} style={ctrlBtn}><SkipForward size={14} /></button>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: '"JetBrains Mono", monospace', marginLeft: 4 }}>
                {currentTime} / {formatTime(totalDuration)}
              </span>
            </div>
          </div>

          {/* Timeline tracks */}
          <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(0,0,0,0.3)' }}>
            {/* Video track */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 70, color: 'rgba(255,255,255,0.3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Video</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', minHeight: 56 }} className="hide-scrollbar">
                {videoClips.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: 12, padding: '0 10px' }}>No clips yet</div>
                ) : (
                  videoClips.map((clip, i) => (
                    <React.Fragment key={i}>
                      <div
                        onClick={() => setSelectedClip(i)}
                        onContextMenu={(e) => handleRightClick(e, i)}
                        style={{
                          minWidth: `${Math.max(80, (clip.duration || 5) * 20)}px`,
                          height: 52, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', flexShrink: 0,
                          border: `2px solid ${selectedClip === i ? '#E53935' : 'rgba(255,255,255,0.1)'}`,
                          position: 'relative', background: '#1a1a1a', transition: 'border-color 0.15s',
                        }}
                      >
                        {clip.url && <img src={clip.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <div style={{ position: 'absolute', bottom: 2, left: 4, color: 'rgba(255,255,255,0.6)', fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>{clip.duration || 5}s</div>
                      </div>
                      {i < videoClips.length - 1 && (
                        <TransitionButton
                          value={transitions[i] || 'Cut'}
                          onChange={v => setTransitions(prev => ({ ...prev, [i]: v }))}
                        />
                      )}
                    </React.Fragment>
                  ))
                )}
              </div>
            </div>

            {/* Audio track placeholder */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 70, color: 'rgba(255,255,255,0.3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Music</div>
              <div style={{ flex: 1, height: 32, background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <button style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}>+ Add Music</button>
              </div>
            </div>

            {/* Voiceover track placeholder */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 70, color: 'rgba(255,255,255,0.3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Voice</div>
              <div style={{ flex: 1, height: 32, background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <button style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}>+ Add Voiceover</button>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel - clip properties */}
        {selectedClipData && (
          <div style={{ width: 200, borderLeft: '1px solid rgba(255,255,255,0.06)', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }} className="hide-scrollbar">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Clip {selectedClip + 1}</div>
              <button onClick={() => deleteClip(selectedClip)} style={{ background: 'none', border: 'none', color: 'rgba(229,57,53,0.6)', cursor: 'pointer', padding: 4 }}>
                <Trash2 size={14} />
              </button>
            </div>
            {selectedClipData.url && <img src={selectedClipData.url} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8 }} />}
            <ClipProp label="Duration" value={`${selectedClipData.duration || 5}s`} />
            <ClipProp label="Speed" value="1x" />
            <ClipProp label="Volume" value="100%" />
            <GhostButton onClick={() => duplicateClip(selectedClip)} style={{ width: '100%' }}>
              <Copy size={12} /> Duplicate
            </GhostButton>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 999,
            background: 'rgba(20,20,24,0.97)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            minWidth: 140,
          }}
        >
          {[
            { label: 'Duplicate', icon: <Copy size={12} />, action: () => duplicateClip(contextMenu.clipIdx) },
            { label: 'Delete', icon: <Trash2 size={12} />, action: () => deleteClip(contextMenu.clipIdx), danger: true },
          ].map(item => (
            <button key={item.label} onClick={item.action} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: 'none', border: 'none', color: item.danger ? '#ff6b6b' : 'rgba(255,255,255,0.7)',
              fontSize: 13, cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', textAlign: 'left',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ctrlBtn = {
  width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.1)',
  border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

const ClipProp = ({ label, value }) => (
  <div>
    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
    <div style={{ color: '#fff', fontSize: 13 }}>{value}</div>
  </div>
);

const TransitionButton = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(p => !p)} style={{
        width: 36, height: 52, background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2,
        fontFamily: '"DM Sans", sans-serif',
      }}>
        ⋮<span style={{ fontSize: 8 }}>{value.split(' ')[0]}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', background: 'rgba(20,20,24,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden', zIndex: 100, minWidth: 110 }}>
          {['Cut', 'Dissolve', 'Fade to Black', 'Wipe'].map(t => (
            <button key={t} onClick={() => { onChange(t); setOpen(false); }} style={{
              width: '100%', padding: '8px 12px', background: value === t ? 'rgba(229,57,53,0.1)' : 'none',
              border: 'none', color: value === t ? '#E53935' : 'rgba(255,255,255,0.6)', fontSize: 12,
              cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', textAlign: 'left',
            }}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};