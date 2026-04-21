import React, { useState } from 'react';
import { Play, Plus, Loader2 } from 'lucide-react';

const MOODS = ['Epic', 'Emotional', 'Tense', 'Upbeat', 'Ambient', 'Dark', 'Inspiring'];
const TEMPOS = ['Slow', 'Medium', 'Fast'];
const VOICES = [
  { id: 'v1', name: 'Marcus', accent: 'American', gender: 'Male' },
  { id: 'v2', name: 'Sophia', accent: 'British', gender: 'Female' },
  { id: 'v3', name: 'Kai', accent: 'Australian', gender: 'Male' },
  { id: 'v4', name: 'Luna', accent: 'French', gender: 'Female' },
  { id: 'v5', name: 'Diego', accent: 'Spanish', gender: 'Male' },
  { id: 'v6', name: 'Aria', accent: 'Japanese', gender: 'Female' },
];
const SFX_CATEGORIES = ['Ambient', 'Action', 'Nature', 'Urban', 'Sci-Fi', 'Horror'];

const Chip = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: active ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${active ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.08)'}`, color: active ? '#E53935' : 'rgba(255,255,255,0.6)', transition: 'all 0.15s', fontFamily: '"DM Sans", sans-serif', whiteSpace: 'nowrap' }}>{label}</button>
);

function MusicTab() {
  const [mood, setMood] = useState('Epic');
  const [tempo, setTempo] = useState('Medium');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => { setGenerating(false); setGenerated(true); }, 2500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
      <div>
        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mood</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {MOODS.map(m => <Chip key={m} label={m} active={mood === m} onClick={() => setMood(m)} />)}
        </div>
      </div>
      <div>
        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tempo</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {TEMPOS.map(t => <Chip key={t} label={t} active={tempo === t} onClick={() => setTempo(t)} />)}
        </div>
      </div>
      {generated && (
        <div style={{ background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button style={{ width: 36, height: 36, background: '#E53935', border: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Play size={14} style={{ color: '#fff' }} /></button>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>{mood} {tempo} — Generated Track</div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>00:32</div>
            </div>
          </div>
          <div style={{ height: 40, background: '#1a1a1a', borderRadius: 6, position: 'relative', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', height: '100%', gap: 1, padding: '0 8px' }}>
              {Array.from({ length: 60 }).map((_, i) => (
                <div key={i} style={{ width: 2, background: 'rgba(229,57,53,0.6)', borderRadius: 1, height: `${20 + Math.sin(i * 0.5) * 15 + Math.random() * 15}%`, flexShrink: 0 }} />
              ))}
            </div>
          </div>
          <button style={{ marginTop: 10, width: '100%', background: 'rgba(229,57,53,0.12)', border: '1px solid rgba(229,57,53,0.3)', borderRadius: 7, color: '#E53935', fontSize: 13, fontWeight: 600, padding: '8px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}>+ Add to Timeline</button>
        </div>
      )}
      <button onClick={handleGenerate} disabled={generating} style={{ padding: '12px 24px', background: generating ? 'rgba(229,57,53,0.3)' : '#E53935', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: '"DM Sans", sans-serif', alignSelf: 'flex-start' }}>
        {generating ? <><Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating Music...</> : '✦ Generate Music'}
      </button>
    </div>
  );
}

function VoiceoverTab() {
  const [script, setScript] = useState('');
  const [voice, setVoice] = useState('v1');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 680 }}>
      <div>
        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Voiceover Script</label>
        <textarea value={script} onChange={e => setScript(e.target.value)} placeholder="Type or paste your voiceover text here..." rows={5} style={{ width: '100%', background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 14, padding: '12px', outline: 'none', fontFamily: '"DM Sans", sans-serif', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.7 }} onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
      </div>
      <div>
        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Select Voice</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {VOICES.map(v => (
            <button key={v.id} onClick={() => setVoice(v.id)} style={{ background: voice === v.id ? 'rgba(229,57,53,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${voice === v.id ? 'rgba(229,57,53,0.4)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 9, padding: '10px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{v.name}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{v.gender} · {v.accent}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                <div style={{ width: 16, height: 16, background: 'rgba(255,255,255,0.05)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Play size={8} style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>Preview</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => { setGenerating(true); setTimeout(() => { setGenerating(false); setGenerated(true); }, 2000); }} disabled={generating || !script.trim()} style={{ padding: '12px 24px', background: generating || !script.trim() ? 'rgba(229,57,53,0.3)' : '#E53935', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: generating || !script.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: '"DM Sans", sans-serif', alignSelf: 'flex-start' }}>
        {generating ? <><Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating...</> : '✦ Generate Voiceover'}
      </button>
    </div>
  );
}

function SFXTab() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Ambient');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 600 }}>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sound effects..." style={{ background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 13, padding: '10px 14px', outline: 'none', fontFamily: '"DM Sans", sans-serif' }} onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SFX_CATEGORIES.map(c => <Chip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />)}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>Sound effects library coming soon</div>
    </div>
  );
}

export default function AudioModule() {
  const [tab, setTab] = useState('music');
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 20px', flexShrink: 0 }}>
        {[['music','Music'],['voiceover','Voiceover'],['sfx','Sound Effects']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '14px 18px', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === id ? '#E53935' : 'transparent'}`, color: tab === id ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: tab === id ? 600 : 400, cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', transition: 'all 0.15s' }}>{label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }} className="hide-scrollbar">
        {tab === 'music' && <MusicTab />}
        {tab === 'voiceover' && <VoiceoverTab />}
        {tab === 'sfx' && <SFXTab />}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}