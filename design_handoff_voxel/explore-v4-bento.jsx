// EXPLORE V4 — Dense bento grid
// Tight, info-dense mosaic. Mixed tile sizes packed edge-to-edge.
// Stats + category pill rail up top. For power users who want maximum signal.

function V_Explore_V4() {
  const red = '#E01E1E';
  const bg = '#080808';
  const noise = "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

  const Logo = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z" stroke={red} strokeWidth="1.6" fill="rgba(224,30,30,0.15)" />
        <path d="M12 2 L12 22 M2 7 L22 17 M22 7 L2 17" stroke={red} strokeWidth="1" opacity="0.7" />
      </svg>
      <span style={{ fontFamily: 'Anton, sans-serif', fontSize: 18, letterSpacing: '0.04em', color: red, textShadow: `0 0 18px ${red}88` }}>VOXEL</span>
    </div>
  );

  // Bento tiles — explicit grid placement
  const bento = [
    { c: '1 / 4', r: '1 / 4', bg: 'linear-gradient(135deg,#1a0a0a,#8B2F1F,#E01E1E)', subj: '30% 55%', label: 'CINEMA', author: 'marco.ridley', likes: '12.4K', hero: true },
    { c: '4 / 6', r: '1 / 3', bg: 'linear-gradient(135deg,#1a0f2a,#4a2a6a,#8B4E8B)', subj: '55% 45%', label: 'PORTRAIT', author: 'ira.ln', likes: '876' },
    { c: '6 / 8', r: '1 / 3', bg: 'linear-gradient(135deg,#2a1a0f,#6B4E3A,#C4A37A)', subj: '40% 55%', label: 'FASHION', author: 'noor_k', likes: '2.1K' },
    { c: '4 / 5', r: '3 / 5', bg: 'linear-gradient(135deg,#0f1a2a,#2a4a6a,#4E8BC4)', subj: '60% 40%', label: 'SCI-FI', author: 'j.park', likes: '4.3K' },
    { c: '5 / 7', r: '3 / 4', bg: 'linear-gradient(135deg,#0f2a1f,#2a6B4A,#7AC49E)', subj: '50% 50%', label: 'NATURE', author: 'studio.v', likes: '331' },
    { c: '7 / 8', r: '3 / 5', bg: 'linear-gradient(135deg,#2a0f1a,#6B1F4A,#B54E7A)', subj: '45% 50%', label: 'ANIME', author: 'hex_9', likes: '1.2K' },
    { c: '5 / 7', r: '4 / 5', bg: 'linear-gradient(135deg,#2a2a0f,#6B6B2F,#C4C47A)', subj: '40% 60%', label: 'PRODUCT', author: 'alma', likes: '418' },
    { c: '1 / 3', r: '4 / 5', bg: 'linear-gradient(135deg,#0a1a1a,#1a4a4a,#4a8B8B)', subj: '65% 40%', label: 'MONO', author: 'hex_9', likes: '89' },
    { c: '3 / 4', r: '4 / 5', bg: 'linear-gradient(135deg,#2a0f0f,#6B1F1F,#B5443F)', subj: '50% 50%', label: 'ACTION', author: 'marco.r', likes: '523' },
  ];

  const cats = ['All','Cinema','Portrait','Anime','Product','3D','Fashion','Architecture','Surreal','Sci-Fi','Nature','Mono'];

  return (
    <div style={{ width: '100%', height: '100%', background: bg, color: '#FFF', fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {/* Navbar */}
      <div style={{ position: 'relative', zIndex: 10, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(8,8,8,0.8)', backdropFilter: 'blur(24px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <Logo />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {['Explore','Image','Video','Audio','Studio','Edit'].map(n => (
              <div key={n} style={{ padding: '6px 10px', fontSize: 13, fontWeight: 500, color: n === 'Explore' ? '#FFF' : 'rgba(255,255,255,0.65)', borderBottom: n === 'Explore' ? `2px solid ${red}` : '2px solid transparent', paddingBottom: 4 }}>{n}</div>
            ))}
          </div>
        </div>
        <div style={{ padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, background: red, color: '#FFF', boxShadow: `0 0 24px ${red}66` }}>Sign Up →</div>
      </div>

      {/* Dense header with live stats */}
      <div style={{ padding: '16px 28px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 28, letterSpacing: '0.02em' }}>EXPLORE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.55)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: red, boxShadow: `0 0 10px ${red}` }} />
              <span style={{ color: '#FFF' }}>LIVE</span>
              <span>— 2,847 generated in the last hour</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {[
            { v: '4.2M', l: 'Total' },
            { v: '38K', l: 'Today' },
            { v: '847', l: 'Now' },
          ].map(s => (
            <div key={s.l} style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 18, color: '#FFF', lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category pill rail */}
      <div style={{ padding: '10px 28px 10px', display: 'flex', gap: 5, overflow: 'hidden', borderBottom: '1px solid rgba(255,255,255,0.05)', alignItems: 'center' }}>
        {cats.map((c, i) => (
          <div key={c} style={{
            padding: '5px 11px', fontSize: 11, fontWeight: 600, borderRadius: 3,
            background: i === 0 ? red : 'rgba(255,255,255,0.05)',
            color: i === 0 ? '#FFF' : 'rgba(255,255,255,0.7)',
            border: `1px solid ${i === 0 ? red : 'rgba(255,255,255,0.08)'}`,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{c}</div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
          <div style={{ padding: '5px 11px', fontSize: 11, fontWeight: 600, borderRadius: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>16:9 ▾</div>
          <div style={{ padding: '5px 11px', fontSize: 11, fontWeight: 600, borderRadius: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>Nano Banana ▾</div>
        </div>
      </div>

      {/* Bento grid */}
      <div style={{ flex: 1, padding: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(4, 1fr)', gap: 6, height: '100%' }}>
          {bento.map((t, i) => (
            <div key={i} style={{
              gridColumn: t.c, gridRow: t.r,
              borderRadius: 4, background: t.bg, position: 'relative', overflow: 'hidden',
              border: t.hero ? `1px solid ${red}` : '1px solid rgba(255,255,255,0.05)',
              boxShadow: t.hero ? `0 0 30px rgba(224,30,30,0.3)` : 'none',
            }}>
              <div style={{ position: 'absolute', inset: 0, backgroundImage: noise, opacity: 0.12, mixBlendMode: 'overlay' }} />
              <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at ${t.subj}, rgba(255,255,255,0.22), transparent 55%)` }} />
              {t.hero && (
                <div style={{ position: 'absolute', top: 10, left: 10, padding: '3px 7px', background: red, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em' }}>EDITOR'S PICK</div>
              )}
              <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 8, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', color: '#FFF', padding: '2px 6px', background: 'rgba(0,0,0,0.6)' }}>{t.label}</div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: t.hero ? '24px 14px 10px' : '14px 8px 6px', background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}>
                {t.hero && (
                  <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 26, letterSpacing: '0.02em', lineHeight: 1, marginBottom: 5 }}>THE LAST BAMBOO</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: t.hero ? 11 : 9, color: '#FFF', fontWeight: 500 }}>@{t.author}</div>
                  <div style={{ fontSize: t.hero ? 10 : 8, color: red, fontFamily: 'JetBrains Mono, monospace' }}>♥ {t.likes}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.V_Explore_V4 = V_Explore_V4;
