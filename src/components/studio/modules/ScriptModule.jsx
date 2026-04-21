import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const GENRES = ['Action', 'Drama', 'Comedy', 'Horror', 'Sci-Fi', 'Documentary', 'Commercial', 'Short Film'];
const TONES = ['Dark', 'Light', 'Neutral'];
const DURATIONS = ['15s', '30s', '60s', '3min', 'Custom'];

const Chip = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: active ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${active ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.08)'}`, color: active ? '#E53935' : 'rgba(255,255,255,0.6)', fontFamily: '"DM Sans", sans-serif', whiteSpace: 'nowrap' }}>{label}</button>
);

export default function ScriptModule() {
  const [genre, setGenre] = useState('Drama');
  const [tone, setTone] = useState('Neutral');
  const [duration, setDuration] = useState('60s');
  const [premise, setPremise] = useState('');
  const [script, setScript] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!premise.trim()) return;
    setGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Write a professional ${genre} screenplay in ${tone} tone, approximately ${duration} runtime. Premise: ${premise}. Format with scene headings (INT./EXT. LOCATION - TIME), action lines, and character dialogue. Make it cinematic and visually descriptive.`,
      });
      setScript(typeof result === 'string' ? result : result?.content || '');
    } finally {
      setGenerating(false);
    }
  };

  // Extract scene headings for navigation
  const scenes = script ? script.split('\n').filter(l => l.match(/^(INT\.|EXT\.)/i)) : [];

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Config row */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {GENRES.map(g => <Chip key={g} label={g} active={genre === g} onClick={() => setGenre(g)} />)}
          </div>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ display: 'flex', gap: 5 }}>
            {TONES.map(t => <Chip key={t} label={t} active={tone === t} onClick={() => setTone(t)} />)}
          </div>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ display: 'flex', gap: 5 }}>
            {DURATIONS.map(d => <Chip key={d} label={d} active={duration === d} onClick={() => setDuration(d)} />)}
          </div>
        </div>

        {/* Script area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            placeholder={`INT. COFFEE SHOP - DAY\n\nA young woman sits alone at a corner table, staring out the window. Rain streaks down the glass.\n\n\t\t\tEMILY\n\t\t(whispering)\nSome things you just can't undo.\n\n...`}
            style={{
              width: '100%', height: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: '#ddd', fontSize: 13, fontFamily: '"Courier Prime", "Courier New", monospace',
              padding: '24px 40px', resize: 'none', lineHeight: 1.8, boxSizing: 'border-box',
              caretColor: '#E53935',
            }}
          />
          {generating && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,8,8,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
              <Loader2 size={32} style={{ color: '#E53935', animation: 'spin 0.8s linear infinite' }} />
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Writing your screenplay...</div>
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ width: 260, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '14px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Generate</div>
          <textarea value={premise} onChange={e => setPremise(e.target.value)} placeholder="Describe your story in one sentence..." rows={3} style={{ width: '100%', background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 12, padding: '8px 10px', outline: 'none', fontFamily: '"DM Sans", sans-serif', resize: 'none', boxSizing: 'border-box', marginBottom: 8 }} onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
          <button onClick={handleGenerate} disabled={generating || !premise.trim()} style={{ width: '100%', background: generating || !premise.trim() ? 'rgba(229,57,53,0.3)' : '#E53935', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px', cursor: generating || !premise.trim() ? 'not-allowed' : 'pointer', fontFamily: '"DM Sans", sans-serif' }}>
            {generating ? 'Writing...' : '✦ Generate Script'}
          </button>
        </div>

        {scenes.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }} className="hide-scrollbar">
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Scenes</div>
            {scenes.map((s, i) => (
              <button key={i} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: '"Courier New", monospace', marginBottom: 2, transition: 'all 0.15s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}
              >
                {i + 1}. {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}