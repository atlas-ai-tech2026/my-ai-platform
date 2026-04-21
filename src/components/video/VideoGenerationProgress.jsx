import React, { useEffect, useState, useRef } from 'react';
import { Sparkles } from 'lucide-react';

const STAGES = [
  { pct: 5,  msg: 'Preparing assets...' },
  { pct: 18, msg: 'Analyzing your prompt...' },
  { pct: 32, msg: 'Building scene composition...' },
  { pct: 48, msg: 'Rendering frame 1 of 24...' },
  { pct: 56, msg: 'Rendering frame 6 of 24...' },
  { pct: 64, msg: 'Rendering frame 12 of 24...' },
  { pct: 74, msg: 'Rendering frame 18 of 24...' },
  { pct: 83, msg: 'Rendering frame 24 of 24...' },
  { pct: 91, msg: 'Applying motion smoothing...' },
  { pct: 97, msg: 'Finalizing video...' },
];

const S = { font: '"DM Sans", sans-serif' };

export default function VideoGenerationProgress({ isGenerating, durationMs = 3000 }) {
  const [pct, setPct] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const intervalRef = useRef(null);
  const stageRef = useRef(0);

  useEffect(() => {
    if (!isGenerating) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // brief "100%" flash then reset
      setPct(100);
      const t = setTimeout(() => { setPct(0); setStageIndex(0); stageRef.current = 0; }, 400);
      return () => clearTimeout(t);
    }

    setPct(0);
    setStageIndex(0);
    stageRef.current = 0;

    const totalTicks = durationMs / 80;
    let tick = 0;

    intervalRef.current = setInterval(() => {
      tick++;
      const raw = (tick / totalTicks) * 100;
      const capped = Math.min(raw, 97); // never hit 100 until done
      setPct(Math.round(capped));

      // advance stage
      const nextStage = STAGES.findIndex((s, i) => i > stageRef.current && s.pct <= capped);
      if (nextStage !== -1) {
        stageRef.current = nextStage;
        setStageIndex(nextStage);
      }
    }, 80);

    return () => clearInterval(intervalRef.current);
  }, [isGenerating, durationMs]);

  if (!isGenerating && pct === 0) return null;

  const msg = STAGES[stageIndex]?.msg || 'Processing...';

  return (
    <div style={{
      margin: '0 0 12px 0',
      background: '#161616',
      border: '1px solid #2A2A2A',
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles className="w-3.5 h-3.5" style={{ color: '#E01E1E', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: S.font }}>
            Generating video
          </span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#FF4444', fontFamily: S.font }}>
          {pct}%
        </span>
      </div>

      {/* Bar */}
      <div style={{ height: 6, background: '#2A2A2A', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #CC0000, #FF2222)',
          borderRadius: 999,
          transition: 'width 0.12s ease',
          boxShadow: '0 0 8px rgba(224,30,30,0.5)',
        }} />
      </div>

      {/* Status message */}
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontFamily: S.font }}>
        {msg}
      </span>
    </div>
  );
}