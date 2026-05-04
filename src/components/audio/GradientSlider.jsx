// Custom slider for the Audio page sliders (Stability / Similarity /
// Style). Tailwind UI's <Slider /> from shadcn would also work but its
// track style doesn't match the spec's gradient + glow recipe without
// overriding most of the chrome anyway. This is ~80 lines and renders
// pixel-perfect plus supports a `disabled` mode that fades the chrome
// for sliders the active model ignores.
import React, { useRef, useState, useCallback } from 'react';

const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';

export default function GradientSlider({
  label, value, onChange,
  min = 0, max = 1, step = 0.01,
  disabled = false, disabledHint = '',
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;

  const updateFromEvent = useCallback((e) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    const ratio = Math.min(1, Math.max(0, x / r.width));
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    onChange?.(Math.min(max, Math.max(min, Number(stepped.toFixed(4)))));
  }, [min, max, step, onChange]);

  const handlePointerDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    setDragging(true);
    updateFromEvent(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e) => {
    if (disabled || !dragging) return;
    updateFromEvent(e);
  };
  const handlePointerUp = (e) => {
    if (disabled) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div title={disabled ? disabledHint : undefined} style={{ opacity: disabled ? 0.45 : 1, transition: 'opacity 0.18s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}
          {disabled && (
            <span style={{
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.05em',
              padding: '1px 5px', borderRadius: 3,
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>V3 IGNORES</span>
          )}
        </span>
        <span style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11, color: '#FFF', fontWeight: 600,
        }}>{value.toFixed(2)}</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'relative',
          height: 14,
          padding: '5.5px 0',
          cursor: disabled ? 'not-allowed' : 'pointer',
          touchAction: 'none',
        }}
      >
        <div style={{
          height: 3, borderRadius: 999,
          background: 'rgba(255,255,255,0.10)',
        }} />
        <div style={{
          position: 'absolute', top: 5.5, left: 0,
          height: 3, borderRadius: 999,
          width: `${pct}%`,
          background: disabled
            ? 'rgba(255,255,255,0.2)'
            : `linear-gradient(90deg, ${RED_DEEP}, ${RED_HOT})`,
          boxShadow: disabled ? 'none' : `0 0 6px ${RED}`,
          transition: dragging ? 'none' : 'width 0.12s',
        }} />
        <div style={{
          position: 'absolute',
          top: '50%',
          left: `calc(${pct}% - 6px)`,
          width: 12, height: 12, borderRadius: '50%',
          background: '#FFF',
          transform: 'translateY(-50%)',
          boxShadow: disabled
            ? '0 1px 3px rgba(0,0,0,0.6)'
            : '0 0 8px rgba(224,30,30,0.55), 0 1px 3px rgba(0,0,0,0.6)',
          transition: dragging ? 'none' : 'left 0.12s',
        }} />
      </div>
    </div>
  );
}
