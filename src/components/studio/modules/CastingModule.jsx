import React, { useState } from 'react';
import { Plus, Search, Trash2, Pencil, Upload, Loader2, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const STYLES = ['Photorealistic', 'Cinematic', 'Anime', 'Comic', '3D'];

export default function CastingModule({ characters, onRefresh }) {
  const [search, setSearch] = useState('');
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerChar, setDrawerChar] = useState(null); // null = new
  const [form, setForm] = useState({ name: '', description: '', style: 'Photorealistic' });
  const [generating, setGenerating] = useState(false);
  const [generatedOptions, setGeneratedOptions] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [saving, setSaving] = useState(false);

  const filtered = (characters || []).filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const openNew = () => {
    setDrawerChar(null);
    setForm({ name: '', description: '', style: 'Photorealistic' });
    setGeneratedOptions([]);
    setSelectedOption(null);
    setShowDrawer(true);
  };

  const openEdit = (c) => {
    setDrawerChar(c);
    setForm({ name: c.name, description: c.description || '', style: c.style || 'Photorealistic' });
    setGeneratedOptions([]);
    setSelectedOption(null);
    setShowDrawer(true);
  };

  const handleGenerate = async () => {
    if (!form.description.trim()) return;
    setGenerating(true);
    setGeneratedOptions([]);
    try {
      const promises = Array.from({ length: 4 }, () =>
        base44.integrations.Core.GenerateImage({
          prompt: `Portrait of ${form.description}, ${form.style} style, high quality, face focus, professional lighting, 4K`
        })
      );
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
      const data = { name: form.name, description: form.description, style: form.style, image_url: selectedOption };
      if (drawerChar) {
        await base44.entities.StudioCharacter.update(drawerChar.id, data);
      } else {
        await base44.entities.StudioCharacter.create(data);
      }
      onRefresh();
      setShowDrawer(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.StudioCharacter.delete(id);
    onRefresh();
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 12px' }}>
            <Search size={14} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search characters..." style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 13, fontFamily: '"DM Sans", sans-serif', flex: 1 }} />
          </div>
          <button
            onClick={openNew}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#E53935', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', whiteSpace: 'nowrap' }}
          >
            <Plus size={14} /> New Character
          </button>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }} className="hide-scrollbar">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {filtered.map(c => (
              <div key={c.id} style={{ background: '#131313', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.15s' }}>
                <div style={{ position: 'relative', aspectRatio: '3/4' }}>
                  {c.image_url ? (
                    <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#1a0000,#111)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>👤</div>
                  )}
                  <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                    <button onClick={() => openEdit(c)} style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.7)' }}>
                      <Pencil size={11} />
                    </button>
                    <button onClick={() => handleDelete(c.id)} style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(229,57,53,0.8)' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{c.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.description}</div>
                  <button
                    style={{ marginTop: 8, width: '100%', background: 'rgba(229,57,53,0.1)', border: '1px solid rgba(229,57,53,0.25)', borderRadius: 6, color: '#E53935', fontSize: 11, fontWeight: 600, padding: '5px', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(229,57,53,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(229,57,53,0.1)'}
                  >
                    Use in Scene
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: '60px 0', fontSize: 14 }}>
                No characters yet. Create your first character to get started.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drawer */}
      {showDrawer && (
        <div style={{ width: 340, borderLeft: '1px solid rgba(255,255,255,0.06)', background: '#0D0D0D', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInRight 0.3s ease' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>{drawerChar ? 'Edit Character' : 'New Character'}</span>
            <button onClick={() => setShowDrawer(false)} style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }} className="hide-scrollbar">
            {/* Name */}
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Character Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Elena Vasquez" style={{ width: '100%', background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: '"DM Sans", sans-serif', boxSizing: 'border-box' }} onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
            </div>
            {/* Description */}
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe appearance, age, style, personality..." rows={4} style={{ width: '100%', background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#fff', fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: '"DM Sans", sans-serif', resize: 'vertical', boxSizing: 'border-box' }} onFocus={e => e.target.style.borderColor = 'rgba(229,57,53,0.4)'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
            </div>
            {/* Style */}
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5 }}>Visual Style</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {STYLES.map(s => (
                  <button key={s} onClick={() => setForm(f => ({ ...f, style: s }))} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: form.style === s ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${form.style === s ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.08)'}`, color: form.style === s ? '#E53935' : 'rgba(255,255,255,0.6)', fontFamily: '"DM Sans", sans-serif' }}>{s}</button>
                ))}
              </div>
            </div>
            {/* Generate */}
            <button
              onClick={handleGenerate}
              disabled={generating || !form.description.trim()}
              style={{ width: '100%', background: generating || !form.description.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: generating || !form.description.trim() ? 'rgba(255,255,255,0.3)' : '#fff', fontSize: 13, fontWeight: 600, padding: '10px', cursor: generating || !form.description.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: '"DM Sans", sans-serif' }}
            >
              {generating ? <><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating 4 options...</> : '✦ Generate Portraits'}
            </button>
            {/* Options grid */}
            {generatedOptions.length > 0 && (
              <div>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>Select Portrait</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {generatedOptions.map((url, i) => (
                    <button key={i} onClick={() => setSelectedOption(url)} style={{ aspectRatio: '3/4', overflow: 'hidden', borderRadius: 8, border: `2px solid ${selectedOption === url ? '#E53935' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer', padding: 0, background: 'transparent', transition: 'border-color 0.15s' }}>
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Save */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              style={{ width: '100%', background: saving || !form.name.trim() ? 'rgba(229,57,53,0.3)' : '#E53935', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700, padding: '11px', cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer', fontFamily: '"DM Sans", sans-serif' }}
            >
              {saving ? 'Saving...' : drawerChar ? 'Update Character' : 'Save Character'}
            </button>
          </div>
        </div>
      )}
      <style>{`@keyframes slideInRight { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}