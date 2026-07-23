import React, { useState } from 'react';
import { X, Check } from 'lucide-react';

// Kling Motion Control and Kling 3.0 Omni Edit are intentionally NOT
// listed here — they each have their own top-tab on the Video page.
// Keeping them in the Create-tab model picker would let users pick a
// model whose UI doesn't match the active tab.
// Full catalog — kie.ai-first (verified ids), FAL for models kie doesn't
// offer. Every entry is priced in creditPricing.js at ≥40% margin of sale.
// Names must match server VIDEO_DIRECT_MAP keys exactly.
const VIDEO_MODELS = [
  // ── kie.ai-backed ──
  { id:'kling-3',        name:'Kling 3.0',         brand:'Kling',     color:'#2563EB', badge:'NEW',  desc:'Enhanced audio, consistency & multi-shots',    tags:['Start/End','Multi-shots','Audio'], res:'720-1080p', dur:'3-15s',  featured:true,  img:'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=400&q=80&fit=crop' },
  { id:'seedance-2',     name:'Seedance 2.0',      brand:'Seedance',  color:'#0D9488', badge:'NEW',  desc:'Cinematic output with native audio, multi-shot editing & director-level camera control',  tags:['Multi-shots','Audio','Director'], res:'480-720p', dur:'4-15s',  featured:true,  img:'https://images.unsplash.com/photo-1518834107812-67b0b7c58434?w=400&q=80&fit=crop' },
  { id:'seedance-2-fast',name:'Seedance 2.0 Fast', brand:'Seedance',  color:'#0D9488', badge:'FAST', desc:'Same Seedance 2.0 quality at ultra-fast speed — text/image/reference to video',          tags:['Fast','Reference','Audio'],       res:'480-720p', dur:'4-15s',  featured:true,  img:'https://images.unsplash.com/photo-1518834107812-67b0b7c58434?w=400&q=80&fit=crop' },
  { id:'seedance-2-mini',name:'Seedance 2.0 Mini', brand:'Seedance',  color:'#0D9488', badge:'VALUE',desc:'Lightest Seedance 2.0 — reference / image / text to video at the lowest cost',           tags:['Reference','Audio','Value'],      res:'480-720p', dur:'4-15s',  featured:true,  img:'https://images.unsplash.com/photo-1518834107812-67b0b7c58434?w=400&q=80&fit=crop' },
  { id:'seedance-1-5',   name:'Seedance 1.5 Pro',  brand:'Seedance',  color:'#0D9488', badge:null,   desc:'Cinematic videos with audio & multi-shots',   tags:['Start Frame','Audio'],             res:'480-1080p', dur:'4-12s',  featured:true,  img:'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=400&q=80&fit=crop' },
  { id:'veo-3-1',        name:'Veo 3.1',           brand:'Google',    color:'#10A37F', badge:'NEW',  desc:'High fidelity videos with audio & 4K',        tags:['Start Frame','Audio','4K'],        res:'720p-4K',   dur:'4-8s',   featured:true,  img:'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=120&q=80&fit=crop' },
  { id:'veo-3-fast',     name:'Veo 3 Fast',        brand:'Google',    color:'#10A37F', badge:'FAST', desc:'Faster, cheaper Veo tier with audio',         tags:['Start Frame','Audio','Fast'],      res:'720-1080p', dur:'8s',     img:'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=120&q=80&fit=crop' },
  { id:'kling-2-6',      name:'Kling 2.6',         brand:'Kling',     color:'#2563EB', badge:null,   desc:'Cinematic videos with audio & voice',          tags:['Start Frame','Audio'],             res:'720-1080p', dur:'5-10s',  img:'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=120&q=80&fit=crop' },
  // Sora 2 temporarily removed 2026-07-23 — kie's Sora interface is paused
  // ("This interface is temporarily paused"); every generation failed with
  // auto-refund. Re-add this entry when kie reactivates it:
  // { id:'sora-2', name:'Sora 2', brand:'Sora', color:'#444', badge:'NEW', desc:'Story-telling videos with audio — real Sora 2', tags:['Start Frame','Audio'], res:'720-1080p', dur:'10s', img:'https://images.unsplash.com/photo-1518770660439-4636190af475?w=120&q=80&fit=crop' },
  { id:'wan-2-6',        name:'Wan 2.6',           brand:'Wan',       color:'#7C3AED', badge:null,   desc:'Cinematic videos with audio & multi-shots',   tags:['Start Frame','Multi-shots','Audio'],res:'720-1080p',dur:'5-15s',  img:'https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=120&q=80&fit=crop' },
  { id:'grok-imagine',   name:'Grok Imagine',      brand:'Grok',      color:'#D97706', badge:null,   desc:'Fast generation of cinematic videos',          tags:['Start Frame','Audio'],             res:'480-720p',  dur:'6-30s',  img:'https://images.unsplash.com/photo-1534972195531-d756b9bfa9f2?w=120&q=80&fit=crop' },
  // ── FAL-backed (not available on kie.ai) ──
  { id:'kling-3-omni',   name:'Kling 3.0 Omni',    brand:'Kling',     color:'#2563EB', badge:null,   desc:'Enhanced multimodal references',              tags:['Reference','Multi-shots','Audio'], res:'720-1080p', dur:'3-15s',  img:'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80&fit=crop' },
  { id:'kling-2-5',      name:'Kling 2.5',         brand:'Kling',     color:'#2563EB', badge:null,   desc:'Great creativity with exceptional value',      tags:['Start/End'],                       res:'720-1080p', dur:'5-10s',  img:'https://images.unsplash.com/photo-1560942485-b2a11cc13456?w=120&q=80&fit=crop' },
  { id:'kling-2-1',      name:'Kling 2.1',         brand:'Kling',     color:'#2563EB', badge:null,   desc:'Natural motion & great prompt adherence',      tags:['Start/End'],                       res:'720-1080p', dur:'5-10s',  img:'https://images.unsplash.com/photo-1543946207-39bd91e70ca7?w=120&q=80&fit=crop' },
  { id:'kling-o1',       name:'Kling O1',          brand:'Kling',     color:'#2563EB', badge:null,   desc:'Enhanced multimodal references',               tags:['Reference','Start/End'],           res:'720-1080p', dur:'3-10s',  img:'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=120&q=80&fit=crop' },
  { id:'hailuo-2-3',     name:'Hailuo 2.3',        brand:'Hailuo',    color:'#A855F7', badge:null,   desc:'Great for cinematic & acting scenes',          tags:['Start Frame'],                     res:'768-1080p', dur:'6-10s',  img:'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=120&q=80&fit=crop' },
  { id:'seedance-1',     name:'Seedance 1',        brand:'Seedance',  color:'#0D9488', badge:null,   desc:'Narrative videos with multi-shots',            tags:['Start/End','Multi-shots'],         res:'480-1080p', dur:'5-10s',  img:'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=120&q=80&fit=crop' },
  { id:'ltx-2',          name:'LTX 2',             brand:'LTX',       color:'#0891B2', badge:null,   desc:'Fast cinematic 4K videos up to 20s',           tags:['Start Frame','Audio','4K'],        res:'4K',        dur:'6-10s',  img:'https://images.unsplash.com/photo-1581375321224-79da6fd32627?w=120&q=80&fit=crop' },
  { id:'vidu-q3',        name:'Vidu Q3',           brand:'Vidu',      color:'#92400E', badge:null,   desc:'Great for storyboards and adding references',  tags:['Start Frame','Audio'],             res:'540-1080p', dur:'1-16s',  img:'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&q=80&fit=crop' },
  { id:'vidu-q2',        name:'Vidu Q2',           brand:'Vidu',      color:'#92400E', badge:null,   desc:'Great for anime scenes and storyboards',       tags:['Reference','Start/End'],           res:'720-1080p', dur:'5-8s',   img:'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=120&q=80&fit=crop' },
  { id:'pixverse-5',     name:'PixVerse 5',        brand:'PixVerse',  color:'#DB2777', badge:null,   desc:'Great for short videos',                       tags:['Start/End','Multi-shots','Audio'], res:'360-1080p', dur:'5-10s',  img:'https://images.unsplash.com/photo-1536924940846-227afb31e2a5?w=120&q=80&fit=crop' },
  { id:'wan-2-2',        name:'Wan 2.2',           brand:'Wan',       color:'#7C3AED', badge:null,   desc:'Consistent aesthetic',                         tags:['Start Frame'],                     res:'480-720p',  dur:'5-10s',  img:'https://images.unsplash.com/photo-1604871000636-074fa5117945?w=120&q=80&fit=crop' },
];

const font = '"DM Sans", sans-serif';

export default function VideoModelModal({ selectedId, onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const featured = VIDEO_MODELS.filter(m => m.featured);
  const filtered = VIDEO_MODELS.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.desc.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      position:'absolute', top:0, left:450,
      width:'calc(100% - 450px)', height:'100%',
      background:'rgba(10,10,10,0.98)',
      backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)',
      zIndex:50, display:'flex', flexDirection:'column', overflow:'hidden',
      animation:'vmSlideIn 0.22s ease',
    }}>
      <style>{`
        @keyframes vmSlideIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        .vm-row:hover { background: rgba(255,255,255,0.04) !important; }
        .featured-cards-row::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Header — flex-shrink: 0 */}
      <div style={{ flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 24px 16px', borderBottom:'1px solid #0D0D0D' }}>
        <span style={{ fontSize:18, fontWeight:700, color:'#fff', fontFamily:font }}>Model</span>
        <button onClick={onClose} style={{ width:30, height:30, background:'#0D0D0D', border:'none', borderRadius:8, color:'rgba(255,255,255,0.6)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Recommended label — flex-shrink: 0 */}
      <div style={{ flexShrink:0, fontSize:13, color:'rgba(255,255,255,0.4)', fontFamily:font, padding:'12px 24px 8px 24px' }}>
        Recommended
      </div>

      {/* Featured cards — flex-shrink: 0, horizontal scroll */}
      <div style={{ flexShrink:0, padding:'0 20px 16px 20px' }}>
        <div className="featured-cards-row" style={{ display:'flex', gap:12, overflowX:'auto', overflowY:'visible', scrollbarWidth:'none', paddingBottom:4 }}>
          {[
            { id:'kling-3-omni', name:'Kling 3.0 Omni', brand:'Kling', color:'#2563EB', desc:'Enhanced multimodal references',           img:'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/6568d539e_Screenshot2026-03-11at22532AM.png', objPos:'center 55%' },
            { id:'kling-3',      name:'Kling 3.0',       brand:'Kling', color:'#2563EB', desc:'Enhanced audio, consistency & multi-shots', img:'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/592be7b6d_ChatGPTImageMar8202603_02_54AM.png', objPos:'center center' },
            { id:'seedance-1-5', name:'Seedance 1.5 Pro', brand:'Seedance', color:'#0D9488', desc:'Cinematic videos with audio & multi-shots', img:'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/55231ed2c_Screenshot2026-03-11at22510AM.png', objPos:'center top' },
            { id:'seedance-2', name:'Seedance 2.0', brand:'Seedance', color:'#0D9488', desc:'Cinematic output with native audio & director-level camera control', video:'/media/seedance-2-hero.mp4', objPos:'center center' },
            { id:'seedance-2-fast', name:'Seedance 2.0 Fast', brand:'Seedance', color:'#0D9488', desc:'Same Seedance 2.0 quality at ultra-fast speed', video:'/media/seedance-2-hero.mp4', objPos:'center center' },
            { id:'seedance-2-mini', name:'Seedance 2.0 Mini', brand:'Seedance', color:'#0D9488', desc:'Lightest Seedance 2.0 — lowest cost per second', video:'/media/seedance-2-hero.mp4', objPos:'center center' },
          ].map(card => (
            <div key={card.id} onClick={() => { if (card.comingSoon) return; const m = VIDEO_MODELS.find(x => x.id === card.id); if (m) { onSelect(m); onClose(); } }}
              style={{ minWidth:210, width:210, height:110, borderRadius:12, overflow:'hidden', position:'relative', cursor:'pointer', flexShrink:0, border: selectedId===card.id ? '2px solid #E01E1E' : '1px solid #2A2A2A', transition:'border-color 0.2s' }}>
              {card.video ? (
                <video src={card.video} autoPlay muted loop playsInline preload="metadata"
                  style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition: card.objPos || 'center', display:'block' }} />
              ) : (
                <img src={card.img} alt={card.name} style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition: card.objPos || 'center', display:'block' }} />
              )}
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)', display:'flex', flexDirection:'column', justifyContent:'flex-end', padding:'8px 10px' }}>
                {/* Brand logo top-left */}
                <div style={{ position:'absolute', top:7, left:8, width:22, height:22, borderRadius:'50%', background: card.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#fff', fontFamily:font, boxShadow:'0 2px 6px rgba(0,0,0,0.5)' }}>
                  {card.brand.charAt(0)}
                </div>
                {card.comingSoon && (
                  <div style={{ position:'absolute', top:7, right:8, padding:'2px 7px', borderRadius:999, background:'rgba(0,0,0,0.7)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.8)', fontSize:9, fontWeight:700, fontFamily:font, backdropFilter:'blur(4px)' }}>COMING SOON</div>
                )}
                <div style={{ fontSize:13, fontWeight:800, color: card.comingSoon ? 'rgba(255,255,255,0.5)' : '#fff', fontFamily:font, lineHeight:1.1, textShadow:'0 1px 4px rgba(0,0,0,0.5)' }}>{card.name}</div>
                <div style={{ fontSize:9.5, color:'rgba(255,255,255,0.7)', fontFamily:font, marginTop:2, lineHeight:1.3, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{card.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters — flex-shrink: 0 */}
      <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:10, padding:'10px 24px', borderBottom:'1px solid #0D0D0D', borderTop:'1px solid #0D0D0D', flexWrap:'wrap' }}>
        <span style={{ padding:'6px 16px', borderRadius:999, background:'#fff', color:'#000', fontWeight:600, fontSize:13, fontFamily:font }}>All models</span>
        {['All providers', 'All features'].map(f => (
          <span key={f} style={{ padding:'6px 14px', borderRadius:999, border:'1px solid #2A2A2A', color:'rgba(255,255,255,0.6)', fontSize:13, fontFamily:font, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
            {f} <span style={{ fontSize:10 }}>▾</span>
          </span>
        ))}
        <div style={{ flex:1, minWidth:140, background:'#161616', border:'1px solid #2A2A2A', borderRadius:8, padding:'7px 12px', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ color:'rgba(255,255,255,0.3)', fontSize:14 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models..."
            style={{ background:'transparent', border:'none', outline:'none', color:'#fff', fontSize:13, fontFamily:font, width:'100%' }} />
        </div>
      </div>

      {/* Model list — flex: 1, only this scrolls */}
      <div style={{ flex:1, overflowY:'auto', padding:'8px 24px 32px' }}>
        {filtered.map(m => {
          const isSel = selectedId === m.id;
          const logoStyle = m.id.startsWith('veo-3')
            ? { background:'#fff', color:'#4285F4' }
            : m.id === 'sora-2'
            ? { background:'#1A1A1A', border:'1.5px solid #3A3A3A', color:'rgba(255,255,255,0.8)' }
            : { background: m.color, color:'#fff' };
          return (
            <div key={m.id} className="vm-row" onClick={() => { if (!m.comingSoon) { onSelect(m); onClose(); } }}
              style={{
                display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
                borderRadius:12, cursor:'pointer', marginBottom:2, transition:'all 0.15s',
                background: isSel ? 'rgba(224,30,30,0.06)' : 'transparent',
                borderLeft:`3px solid ${isSel ? '#E01E1E' : 'transparent'}`,
              }}>
              <div style={{ width:38, height:38, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:700, fontFamily:font, ...logoStyle }}>
                {m.brand.charAt(0)}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:14, fontWeight:600, color:'#fff', fontFamily:font, flexWrap:'wrap' }}>
                  <span style={{ color: m.comingSoon ? 'rgba(255,255,255,0.4)' : '#fff' }}>{m.name}</span>
                  {m.badge === 'SOON' ? (
                    <span style={{ padding:'2px 6px', borderRadius:5, background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:700 }}>COMING SOON</span>
                  ) : m.badge ? (
                    <span style={{ padding:'2px 6px', borderRadius:5, background:'rgba(224,30,30,0.15)', border:'1px solid rgba(224,30,30,0.35)', color:'#FF5555', fontSize:10, fontWeight:700 }}>{m.badge}</span>
                  ) : null}
                </div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', fontFamily:font, marginTop:2 }}>{m.desc}</div>
              </div>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap', justifyContent:'flex-end', maxWidth:220, flexShrink:0 }}>
                {m.tags.map(tag => (
                  <span key={tag} style={{ padding:'3px 8px', borderRadius:6, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', fontSize:11, color:'rgba(255,255,255,0.55)', whiteSpace:'nowrap' }}>{tag}</span>
                ))}
                <span style={{ padding:'3px 8px', borderRadius:6, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', fontSize:11, color:'rgba(255,255,255,0.4)', whiteSpace:'nowrap' }}>{m.res}</span>
                <span style={{ padding:'3px 8px', borderRadius:6, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', fontSize:11, color:'rgba(255,255,255,0.4)', whiteSpace:'nowrap' }}>{m.dur}</span>
              </div>
              {isSel && <Check className="w-4 h-4 flex-shrink-0" style={{ color:'#E01E1E' }} />}
            </div>
          );
        })}
        <p style={{ textAlign:'center', color:'rgba(255,255,255,0.25)', fontSize:13, fontFamily:font, marginTop:20 }}>More models are coming soon...</p>
      </div>
    </div>
  );
}