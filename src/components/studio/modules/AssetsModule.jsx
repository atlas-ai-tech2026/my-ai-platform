import React, { useState } from 'react';
import { Search, Download, Trash2, Play, X } from 'lucide-react';

const FILTER_TABS = ['All', 'Images', 'Videos', 'Audio', 'Characters', 'Locations'];

export default function AssetsModule({ scenes, characters, locations }) {
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [lightbox, setLightbox] = useState(null);

  // Build assets list from available data
  const allAssets = [
    ...(scenes || []).filter(s => s.generated_output_url).map(s => ({
      id: s.id, type: s.output_type === 'video' ? 'Videos' : 'Images',
      url: s.generated_output_url, label: s.scene_action || 'Scene', date: s.created_date,
    })),
    ...(characters || []).filter(c => c.image_url).map(c => ({
      id: c.id, type: 'Characters', url: c.image_url, label: c.name, date: c.created_date,
    })),
    ...(locations || []).filter(l => l.image_url).map(l => ({
      id: l.id, type: 'Locations', url: l.image_url, label: l.name, date: l.created_date,
    })),
  ];

  const filtered = allAssets.filter(a => {
    const matchFilter = filter === 'All' || a.type === filter;
    const matchSearch = !search || a.label.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 0, background: '#131313', borderRadius: 8, padding: 3, border: '1px solid rgba(255,255,255,0.06)' }}>
          {FILTER_TABS.map(t => (
            <button key={t} onClick={() => setFilter(t)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: filter === t ? '#E53935' : 'transparent', border: 'none', color: filter === t ? '#fff' : 'rgba(255,255,255,0.4)', fontFamily: '"DM Sans", sans-serif', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>{t}</button>
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#131313', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '7px 12px' }}>
          <Search size={13} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets..." style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 13, fontFamily: '"DM Sans", sans-serif', flex: 1 }} />
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }} className="hide-scrollbar">
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: '60px 0', fontSize: 14 }}>
            No assets yet. Generate scenes, characters, and locations to build your library.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {filtered.map(asset => (
              <div key={asset.id} style={{ background: '#131313', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s', cursor: 'pointer' }}
                onClick={() => setLightbox(asset)}
              >
                <div style={{ position: 'relative', aspectRatio: asset.type === 'Characters' ? '3/4' : '16/9' }}>
                  <img src={asset.url} alt={asset.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', top: 6, left: 6 }}>
                    <span style={{ background: '#E53935', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.06em' }}>
                      {asset.type.toUpperCase().slice(0, -1)}
                    </span>
                  </div>
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', transition: 'background 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)'; e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0)'; e.currentTarget.style.opacity = '0'; }}
                  >
                    <button onClick={e => { e.stopPropagation(); }} style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}><Download size={13} /></button>
                  </div>
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ color: '#fff', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.label}</div>
                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 2 }}>
                    {asset.date ? new Date(asset.date).toLocaleDateString() : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }} onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 20, right: 20, width: 36, height: 36, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}><X size={18} /></button>
          <img src={lightbox.url} alt={lightbox.label} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 12 }} onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}