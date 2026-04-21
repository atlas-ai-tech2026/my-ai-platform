import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, ZoomIn, ZoomOut, Plus } from 'lucide-react';

const TRANSITIONS = ['Cut', 'Dissolve', 'Fade', 'Wipe'];
const SPEEDS = ['0.25x', '0.5x', '1x', '1.5x', '2x', '4x'];

export default function EditorModule({ scenes, onAddScene }) {
  const [playing, setPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [clipSettings, setClipSettings] = useState({ speed: '1x', transitionIn: 'Cut', transitionOut: 'Cut', opacity: 100 });

  const timecode = '00:00:00:00';
  const totalDuration = (scenes || []).reduce((acc, s) => acc + (s.duration_seconds || 5), 0);

  const selectedScene = scenes?.find(s => s.id === selectedClip);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main editor area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Playback controls */}
        <div style={{ height: 44, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0 }}>
          <button style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.7)' }}><SkipBack size={13} /></button>
          <button
            onClick={() => setPlaying(p => !p)}
            style={{ width: 34, height: 34, background: '#E53935', border: 'none', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            {playing ? <Pause size={14} style={{ color: '#fff' }} /> : <Play size={14} style={{ color: '#fff' }} />}
          </button>
          <button style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.7)' }}><SkipForward size={13} /></button>

          <div style={{ background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '4px 12px', fontSize: 13, color: '#E53935', fontFamily: '"JetBrains Mono", monospace' }}>
            {timecode}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>/ {String(Math.floor(totalDuration / 60)).padStart(2,'0')}:{String(totalDuration % 60).padStart(2,'0')}</div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}><ZoomIn size={12} /></button>
          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}><ZoomOut size={12} /></button>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{Math.round(zoom * 100)}%</span>
        </div>

        {/* Video preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div style={{ flex: 1, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {selectedScene?.generated_output_url ? (
              <img src={selectedScene.generated_output_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : scenes?.length > 0 && scenes[0].generated_output_url ? (
              <img src={scenes[0].generated_output_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>▶</div>
                <div>No scenes yet</div>
                <div style={{ fontSize: 12, marginTop: 6, opacity: 0.6 }}>Generate scenes in Director to edit them here</div>
              </div>
            )}
          </div>

          {/* Timeline tracks */}
          <div style={{ height: 120, background: '#0A0A0A', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ width: 70, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                {['VIDEO', 'AUDIO', 'TEXT'].map(t => (
                  <div key={t} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>{t}</div>
                ))}
              </div>
              <div style={{ flex: 1, overflowX: 'auto', position: 'relative' }} className="hide-scrollbar">
                {/* Video track */}
                <div style={{ height: 40, borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', padding: '4px 4px', gap: 2 }}>
                  {(scenes || []).map((s, i) => {
                    const w = (s.duration_seconds || 5) * 20 * zoom;
                    return (
                      <button key={s.id} onClick={() => setSelectedClip(s.id === selectedClip ? null : s.id)} style={{ height: 30, width: w, minWidth: 40, background: s.id === selectedClip ? 'rgba(229,57,53,0.25)' : 'rgba(255,255,255,0.07)', border: `1px solid ${s.id === selectedClip ? 'rgba(229,57,53,0.6)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 4, cursor: 'pointer', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 5px', transition: 'all 0.15s' }}>
                        {s.generated_output_url && <img src={s.generated_output_url} alt="" style={{ height: '100%', width: 'auto', borderRadius: 3, marginRight: 4 }} />}
                        <span style={{ color: '#fff', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>S{i+1}</span>
                      </button>
                    );
                  })}
                  <button onClick={onAddScene} style={{ height: 30, width: 30, background: 'rgba(229,57,53,0.08)', border: '1px dashed rgba(229,57,53,0.2)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(229,57,53,0.5)', flexShrink: 0 }}><Plus size={12} /></button>
                </div>
                {/* Audio track */}
                <div style={{ height: 40, borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', padding: '4px 8px' }}>
                  <div style={{ height: 24, flex: 1, background: 'rgba(100,100,255,0.08)', border: '1px solid rgba(100,100,255,0.15)', borderRadius: 4, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 1, height: '100%' }}>
                      {Array.from({ length: 40 }).map((_, i) => (
                        <div key={i} style={{ width: 1.5, background: 'rgba(100,150,255,0.4)', borderRadius: 1, height: `${15 + Math.sin(i * 0.7) * 12}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
                {/* Text track */}
                <div style={{ height: 40, display: 'flex', alignItems: 'center', padding: '4px 8px' }}>
                  <div style={{ color: 'rgba(255,255,255,0.1)', fontSize: 11, fontStyle: 'italic' }}>Drop text overlays here</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel: clip properties */}
      {selectedClip && (
        <div style={{ width: 240, borderLeft: '1px solid rgba(255,255,255,0.06)', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0, overflowY: 'auto' }} className="hide-scrollbar">
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Clip Properties</div>
          
          <div>
            <label style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6 }}>Speed</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {SPEEDS.map(s => (
                <button key={s} onClick={() => setClipSettings(cs => ({ ...cs, speed: s }))} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: clipSettings.speed === s ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${clipSettings.speed === s ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.07)'}`, color: clipSettings.speed === s ? '#E53935' : 'rgba(255,255,255,0.5)', fontFamily: '"DM Sans", sans-serif' }}>{s}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6 }}>Opacity: {clipSettings.opacity}%</label>
            <input type="range" min={0} max={100} value={clipSettings.opacity} onChange={e => setClipSettings(cs => ({ ...cs, opacity: Number(e.target.value) }))} style={{ width: '100%', accentColor: '#E53935' }} />
          </div>

          <div>
            <label style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6 }}>Transition In</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {TRANSITIONS.map(t => (
                <button key={t} onClick={() => setClipSettings(cs => ({ ...cs, transitionIn: t }))} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: clipSettings.transitionIn === t ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${clipSettings.transitionIn === t ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.07)'}`, color: clipSettings.transitionIn === t ? '#E53935' : 'rgba(255,255,255,0.5)', fontFamily: '"DM Sans", sans-serif' }}>{t}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6 }}>Transition Out</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {TRANSITIONS.map(t => (
                <button key={t} onClick={() => setClipSettings(cs => ({ ...cs, transitionOut: t }))} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: clipSettings.transitionOut === t ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${clipSettings.transitionOut === t ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.07)'}`, color: clipSettings.transitionOut === t ? '#E53935' : 'rgba(255,255,255,0.5)', fontFamily: '"DM Sans", sans-serif' }}>{t}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}