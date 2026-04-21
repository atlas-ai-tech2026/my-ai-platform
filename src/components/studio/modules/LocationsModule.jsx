import React, { useState } from 'react';
import { Plus, Search, Trash2, Pencil, Loader2, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const STYLES = ['Photorealistic', 'Cinematic', 'Stylized', 'Anime'];
const TIMES = ['Dawn', 'Day', 'Golden Hour', 'Night'];
const WEATHER = ['Clear', 'Cloudy', 'Rain', 'Snow', 'Fog'];

const Chip = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: active ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${active ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.08)'}`, color: active ? '#E53935' : 'rgba(255,255,255,0.6)', fontFamily: '"DM Sans", sans-serif' }}>{label}</button>
);

export default function LocationsModule({ locations, onRefresh }) {
  const [search, setSearch] = useState('');
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerLoc, setDrawerLoc] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', interior_exterior: 'Exterior', time_of_day: 'Day', weather: 'Clear', style: 'Cinematic' });
  const [generating, setGenerating] = useState(false);
  const [generatedOptions, setGeneratedOptions] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [saving, setSaving] = useState(false);

  const filtered = (locations || []).filter(l => l.name.toLowerCase().includes(search.toLowerCase()));

  const openNew = () => {
    setDrawerLoc(null);
    setForm({ name: '', description: '', interior_exterior: 'Exterior', time_of_day: 'Day', weather: 'Clear', style: 'Cinematic' });
    setGeneratedOptions([]);
    setSelectedOption(null);
    setShowDrawer(true);
  };

  const openEdit = (l) => {
    setDrawerLoc(l);
    setForm({ name: l.name, description: l.description || '', interior_exterior: l.interior_exterior || 'Exterior', time_of_day: l.time_of_day || 'Day', weather: l.weather || 'Clear', style: l.style || 'Cinematic' });
    setGeneratedOptions([]);
    setSelectedOption(null);
    setShowDrawer(true);
  };

  const handleGenerate = async () => {
    if (!form.description.trim()) return;
    setGenerating(true);
    setGeneratedOptions([]);
    try {
      const prompt = `${form.interior_exterior} location: ${form.description}, ${form.time_of_day} lighting, ${form.weather} weather, ${form.style} style, cinematic wide shot, 4K, no people`;
      const promises = Array.from({ length: 4 }, () => base44.integrations.Core.GenerateImage({ prompt }));
      const results = await Promise.all(promises);
      setGeneratedOptions(results.map(r => r.url));
      setSelectedOption(results[0].url);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const data = { ...form, image_url: selectedOption, tags_json: JSON.stringify({ interior_exterior: form.interior_exterior, time_of_day: form.time_of_day, weather: form.weather }) };
      if (drawerLoc) {
        await base44.entities.StudioLocation.update(drawerLoc.id, data);
      } else {
        await base44.entities.StudioLocation.create(data);
      }
      onRefresh();
      setShowDrawer(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.StudioLocation.delete(id);
    onRefresh();
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 12px' }}>
            <Search size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search locations..." style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 13, fontFamily: '"DM Sans", sans-serif', flex: 1 }} />
          </div>
          <button onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#E53935', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', whiteSpace: 'nowrap' }}>
            <Plus size={14} /> New Location
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }} className="hide-scrollbar">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {filtered.map(l => (
              <div key={l.id} style={{ background: '#131313', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ position: 'relative', aspectRatio: '16/9' }}>
                  {l.image_url ? (
                    <img src={l.image_url} alt={l.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#001a0a,#111)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🌍</div>
                  )}
                  <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                    <button onClick={() => openEdit(l)} style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.7)' }}><Pencil size={11} /></button>
                    <button onClick={() => handleDelete(l.id)} style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(229,57,53,0.8)' }}><Trash2 size={11} /></button>
                  </div>
                  {l.interior_exterior && (
                    <div style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 7px', fontSize: 10, color: '#fff' }}>{l.interior_exterior}</div>
                  )}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{l.name}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                    {l.time_of_day && <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{l.time_of_day}</span>}
                    {l.weather && <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px', fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{l.weather}</span>}
                  </div>
                  <button style={{ width: '100%', background: 'rgba(229,57,53,0.1)', border: '1px solid rgba(229,57,53,0.25)', borderRadius: 6, color: '#E53935', fontSize: 11, fontWeight: 600, padding: '5px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(229,57,53,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(229,57,53,0.1)'}
                  >Use in Scene</button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: '60px 0', fontSize: 14 }}>No locations yet. Create your first location.</div>
            )}
          </div>
        </div>
      </div>

      {showDrawer && (
        <div style={{ width: 340, borderLeft: '1px solid rgba(255,255,255,0.06)', background: '#0D0D0D', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInRight 0.3s ease' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>{drawerLoc ? 'Edit Location' : 'New Location'}</span>
            <button onClick={() => setShowDrawer(false)} style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}><X size={14} /></button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }} className="hide-scrollbar">
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Location Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rainy Tokyo Alley" style={{ width: '100%', background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: '"DM Sans", sans-serif', boxSizing: 'border-box' }} onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the environment, mood, details..." rows={3} style={{ width: '100%', background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: '"DM Sans", sans-serif', resize: 'vertical', boxSizing: 'border-box' }} onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Type</label>
              <div style={{ display: 'flex', gap: 5 }}>
                <Chip label="Interior" active={form.interior_exterior === 'Interior'} onClick={() => setForm(f => ({ ...f, interior_exterior: 'Interior' }))} />
                <Chip label="Exterior" active={form.interior_exterior === 'Exterior'} onClick={() => setForm(f => ({ ...f, interior_exterior: 'Exterior' }))} />
              </div>
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Time of Day</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {TIMES.map(t => <Chip key={t} label={t} active={form.time_of_day === t} onClick={() => setForm(f => ({ ...f, time_of_day: t }))} />)}
              </div>
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Weather</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {WEATHER.map(w => <Chip key={w} label={w} active={form.weather === w} onClick={() => setForm(f => ({ ...f, weather: w }))} />)}
              </div>
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Style</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {STYLES.map(s => <Chip key={s} label={s} active={form.style === s} onClick={() => setForm(f => ({ ...f, style: s }))} />)}
              </div>
            </div>
            <button onClick={handleGenerate} disabled={generating || !form.description.trim()} style={{ width: '100%', background: generating || !form.description.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: generating || !form.description.trim() ? 'rgba(255,255,255,0.3)' : '#fff', fontSize: 13, fontWeight: 600, padding: '10px', cursor: generating || !form.description.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: '"DM Sans", sans-serif' }}>
              {generating ? <><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating 4 options...</> : '✦ Generate Locations'}
            </button>
            {generatedOptions.length > 0 && (
              <div>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>Select Location</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {generatedOptions.map((url, i) => (
                    <button key={i} onClick={() => setSelectedOption(url)} style={{ aspectRatio: '16/9', overflow: 'hidden', borderRadius: 8, border: `2px solid ${selectedOption === url ? '#E53935' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer', padding: 0, background: 'transparent' }}>
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{ width: '100%', background: saving || !form.name.trim() ? 'rgba(229,57,53,0.3)' : '#E53935', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700, padding: '11px', cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer', fontFamily: '"DM Sans", sans-serif' }}>
              {saving ? 'Saving...' : drawerLoc ? 'Update Location' : 'Save Location'}
            </button>
          </div>
        </div>
      )}
      <style>{`@keyframes slideInRight { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}