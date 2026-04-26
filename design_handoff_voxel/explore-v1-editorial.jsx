// EXPLORE V1 — Editorial magazine
// A curated print-magazine layout. Huge Anton headline, one big featured piece,
// then a 3-column asymmetric spread. Feels like a film quarterly.

function V_Explore_V1() {
  const red = '#E01E1E';
  const redHot = '#FF2A2A';
  const bg = '#0A0A0A';
  const noise = "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

  const Logo = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z" stroke={red} strokeWidth="1.6" fill="rgba(224,30,30,0.15)" />
        <path d="M12 2 L12 22 M2 7 L22 17 M22 7 L2 17" stroke={red} strokeWidth="1" opacity="0.7" />
      </svg>
      <span style={{ fontFamily: 'Anton, sans-serif', fontSize: 18, letterSpacing: '0.04em', color: red, textShadow: `0 0 18px ${red}88` }}>VOXEL</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>AI</span>
    </div>
  );

  const tile = (bg, subj, label, author, likes, hot) => ({ bg, subj, label, author, likes, hot });
  const tiles = {
    hero: tile('linear-gradient(135deg,#1a0a0a,#3a1a1a 40%,#8B2F1F 80%,#D9733A)', '30% 55%', 'CINEMA', 'marco.ridley', '12.4K', true),
    a: tile('linear-gradient(135deg,#1a0f2a,#4a2a6a 70%,#8B4E8B)', '55% 45%', 'PORTRAIT', 'ira.ln', '876'),
    b: tile('linear-gradient(135deg,#2a1a0f,#6B4E3A 60%,#C4A37A)', '40% 55%', 'FASHION', 'noor_k', '2.1K'),
    c: tile('linear-gradient(135deg,#0f1a2a,#2a4a6a 70%,#4E8BC4)', '60% 40%', 'SCI-FI', 'j.park', '4.3K'),
    d: tile('linear-gradient(135deg,#0f2a1f,#2a6B4A 60%,#7AC49E)', '50% 50%', 'NATURE', 'studio.v', '331'),
    e: tile('linear-gradient(135deg,#2a0f1a,#6B1F4A 70%,#B54E7A)', '45% 50%', 'ANIME', 'hex_9', '1.2K'),
  };

  const Card = ({ t, height, featured }) => (
    <div style={{
      width: '100%', height, borderRadius: 4, overflow: 'hidden',
      background: t.bg, position: 'relative',
      border: featured ? `1px solid ${red}` : '1px solid rgba(255,255,255,0.06)',
      boxShadow: featured ? `0 0 40px rgba(224,30,30,0.3), 0 20px 50px rgba(0,0,0,0.6)` : '0 10px 30px rgba(0,0,0,0.5)',
    }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: noise, opacity: 0.12, mixBlendMode: 'overlay' }} />
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at ${t.subj}, rgba(255,255,255,0.22), transparent 55%)` }} />
      {t.hot && (
        <div style={{ position: 'absolute', top: 12, left: 12, padding: '4px 9px', borderRadius: 2, background: red, fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Editor's Pick
        </div>
      )}
      <div style={{ position: 'absolute', top: 12, right: 12, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.85)', padding: '3px 7px', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)' }}>
        {t.label}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 14px 12px', background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}>
        {featured && (
          <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 30, letterSpacing: '0.02em', lineHeight: 1, marginBottom: 6, color: '#FFF' }}>
            THE LAST BAMBOO
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: '#FFF', fontWeight: 500 }}>@{t.author}</div>
          <div style={{ fontSize: 10, color: red, fontFamily: 'JetBrains Mono, monospace' }}>♥ {t.likes}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ width: '100%', height: '100%', background: bg, color: '#FFF', fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-10%', right: '20%', width: 800, height: 600, background: 'radial-gradient(ellipse, rgba(224,30,30,0.2), transparent 60%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: noise, opacity: 0.1, mixBlendMode: 'overlay' }} />
      </div>

      {/* Navbar */}
      <div style={{ position: 'relative', zIndex: 10, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(10,10,10,0.7)', backdropFilter: 'blur(24px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <Logo />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {['Explore','Image','Video','Audio','Studio','Edit'].map(n => (
              <div key={n} style={{ padding: '6px 10px', fontSize: 13, fontWeight: 500, color: n === 'Explore' ? '#FFF' : 'rgba(255,255,255,0.65)', borderBottom: n === 'Explore' ? `2px solid ${red}` : '2px solid transparent', paddingBottom: 4 }}>{n}</div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, background: red, color: '#FFF', boxShadow: `0 0 24px ${red}66` }}>Sign Up →</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, overflow: 'hidden', padding: '28px 40px 0' }}>
        {/* Masthead */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 18, borderBottom: `1px solid rgba(255,255,255,0.1)`, marginBottom: 22 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: red, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: red, boxShadow: `0 0 10px ${red}` }} />
              Issue 024 · Week of April 22
            </div>
            <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 72, letterSpacing: '0.005em', lineHeight: 0.92, color: '#FFF' }}>
              EXPLORE.
            </div>
            <div style={{ marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,0.6)', maxWidth: 520 }}>
              The best of what the Voxel community made this week — curated by our editors.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
            {['Trending','New','Following'].map((n,i) => (
              <div key={n} style={{ padding: '7px 14px', fontSize: 11, fontWeight: 600, background: i === 0 ? 'rgba(255,255,255,0.1)' : 'transparent', border: `1px solid ${i === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{n}</div>
            ))}
          </div>
        </div>

        {/* Editorial grid: big hero left, stacked cards right */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: 14, paddingBottom: 120 }}>
          <div style={{ gridRow: 'span 2' }}>
            <Card t={tiles.hero} height={540} featured />
          </div>
          <Card t={tiles.a} height={260} />
          <Card t={tiles.b} height={260} />
          <Card t={tiles.c} height={260} />
          <Card t={tiles.d} height={260} />
        </div>
      </div>
    </div>
  );
}
window.V_Explore_V1 = V_Explore_V1;
