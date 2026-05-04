// The Voice Canvas centrepiece. Track header + time ruler + a mirrored
// bar waveform with a draggable selection region and a glowing playhead,
// plus a transport bar with round red ▶ and a level meter.
//
// State (playhead position, selection range, isPlaying) lives in the
// parent Audio.jsx — this component is dumb and renders what it's given,
// emitting onSeek / onSelectionChange / transport events.
import React, { useRef, useCallback, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import {
  fmtTime, TrackHeader, TimeRuler, LevelMeter, TransportGhost,
} from './waveformAtoms';

const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

export default function WaveformStage({
  amplitudes,
  duration,
  playhead,
  onSeek,
  isPlaying,
  onPlayToggle,
  onSkipStart,
  onSkipEnd,
  selection, // { start, end } in 0..1 of duration, or null
  onSelectionChange,
  trackTitle = 'Voice Take · 03',
  voiceLabel = 'Adam · 44.1kHz · 16bit · 00:18',
}) {
  const canvasRef = useRef(null);
  const dragModeRef = useRef(null); // 'select' | 'scrub' | null

  const playheadPct = duration > 0 ? Math.min(1, Math.max(0, playhead / duration)) : 0;

  const ratioFromEvent = useCallback((e) => {
    const el = canvasRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    return Math.min(1, Math.max(0, x / r.width));
  }, []);

  const handlePointerDown = (e) => {
    e.preventDefault();
    const ratio = ratioFromEvent(e);
    // Shift-drag → select region, plain drag → seek.
    if (e.shiftKey) {
      dragModeRef.current = 'select';
      onSelectionChange?.({ start: ratio, end: ratio });
    } else {
      dragModeRef.current = 'scrub';
      onSeek?.(ratio * duration);
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e) => {
    if (!dragModeRef.current) return;
    const ratio = ratioFromEvent(e);
    if (dragModeRef.current === 'scrub') {
      onSeek?.(ratio * duration);
    } else {
      onSelectionChange?.(prev => {
        const start = prev?.start ?? ratio;
        return { start: Math.min(start, ratio), end: Math.max(start, ratio) };
      });
    }
  };
  const handlePointerUp = (e) => {
    dragModeRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const selRange = useMemo(() => {
    if (!selection) return null;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    if (b - a < 0.005) return null;
    return { start: a, end: b };
  }, [selection]);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 18,
      padding: 18,
      display: 'flex', flexDirection: 'column', gap: 12,
      boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
      flex: 1, minHeight: 0,
    }}>
      <TrackHeader trackTitle={trackTitle} voiceLabel={voiceLabel} />
      <TimeRuler />

      {/* Waveform canvas */}
      <div
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'relative',
          flex: 1, minHeight: 220,
          borderRadius: 12,
          padding: '20px 8px',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.05)',
          background: 'linear-gradient(180deg, rgba(20,8,8,0.6), rgba(8,4,4,0.8))',
          cursor: dragModeRef.current === 'scrub' ? 'ew-resize' : 'crosshair',
          touchAction: 'none',
        }}
        title="Click to seek · Shift-drag to select a region"
      >
        {/* Centre axis line */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          height: 1, background: 'rgba(255,255,255,0.10)',
          pointerEvents: 'none',
        }} />

        {/* Selection region overlay */}
        {selRange && (
          <div style={{
            position: 'absolute',
            top: 6, bottom: 6,
            left: `${selRange.start * 100}%`,
            width: `${(selRange.end - selRange.start) * 100}%`,
            background: 'rgba(224,30,30,0.12)',
            border: `1px solid ${RED}`,
            borderRadius: 6,
            pointerEvents: 'none',
            transition: 'background 0.15s',
          }} />
        )}

        {/* Bars */}
        <div style={{
          position: 'relative',
          display: 'flex', alignItems: 'center',
          gap: 1.5, height: '100%',
        }}>
          {amplitudes.map((v, i) => {
            const ratio = i / (amplitudes.length - 1 || 1);
            const inSel = selRange && ratio >= selRange.start && ratio <= selRange.end;
            return (
              <div key={i} style={{
                flex: 1,
                height: `${v * 90}%`,
                borderRadius: 1,
                background: inSel
                  ? `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`
                  : 'linear-gradient(180deg, rgba(255,80,80,0.85), rgba(139,15,15,0.6))',
                boxShadow: inSel ? `0 0 6px ${RED}` : 'none',
                transition: 'height 400ms cubic-bezier(0.22, 1, 0.36, 1)',
              }} />
            );
          })}
        </div>

        {/* Playhead */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${playheadPct * 100}%`,
          width: 2,
          background: '#FFF',
          boxShadow: `0 0 12px ${RED_HOT}`,
          pointerEvents: 'none',
          transform: 'translateX(-1px)',
        }}>
          <div style={{
            position: 'absolute',
            top: -7, left: '50%', transform: 'translateX(-50%)',
            width: 14, height: 14, borderRadius: '50%',
            background: '#FFF',
            boxShadow: `0 0 12px ${RED_HOT}, 0 0 4px rgba(255,255,255,0.7)`,
          }} />
        </div>
      </div>

      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TransportGhost icon={<SkipBack style={{ width: 13, height: 13 }} />} onClick={onSkipStart} label="Skip to start" />
          <button
            type="button"
            onClick={onPlayToggle}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`,
              border: 'none',
              color: '#FFF',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 18px rgba(224,30,30,0.55), 0 4px 12px rgba(139,15,15,0.5), inset 0 1px 0 rgba(255,255,255,0.25)',
              transition: 'transform 0.1s, box-shadow 0.18s',
            }}
            onMouseDown={e => { e.currentTarget.style.transform = 'translateY(1px)'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'none'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            {isPlaying
              ? <Pause style={{ width: 16, height: 16 }} fill="currentColor" />
              : <Play style={{ width: 16, height: 16, marginLeft: 2 }} fill="currentColor" />}
          </button>
          <TransportGhost
            icon={isPlaying
              ? <Pause style={{ width: 13, height: 13 }} fill="currentColor" />
              : <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', display: 'flex', gap: 1 }}>▮▮</span>}
            onClick={onPlayToggle}
            label="Toggle"
          />
          <TransportGhost icon={<SkipForward style={{ width: 13, height: 13 }} />} onClick={onSkipEnd} label="Skip to end" />
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12, color: '#FFF', fontWeight: 600,
            minWidth: 80, textAlign: 'right',
          }}>{fmtTime(playhead, true)}</span>
          <div style={{
            flex: 1, height: 3, borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${playheadPct * 100}%`,
              background: `linear-gradient(90deg, ${RED_DEEP}, ${RED_HOT})`,
              boxShadow: '0 0 8px rgba(224,30,30,0.5)',
              transition: isPlaying ? 'none' : 'width 0.2s',
            }} />
          </div>
          <span style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 600,
            minWidth: 80,
          }}>{fmtTime(duration, true)}</span>
        </div>

        <LevelMeter />
      </div>
    </div>
  );
}
