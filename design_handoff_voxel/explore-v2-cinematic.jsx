// EXPLORE V2 — Cinematic full-bleed hero
// Massive featured image fills top half of viewport with dramatic overlay,
// small secondary rail below. Feels like a movie poster / Letterboxd front page.

function V_Explore_V2() {
  const red = '#E01E1E';
  const redHot = '#FF2A2A';
  const bg = '#050505';
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

  const mini = [
    { bg: 'linear-gradient(135deg,#1a0f2a,#4a2a6a,#8B4E8B)', author: 'ira.ln', label: 'PORTRAIT' },
    { bg: 'linear-gradient(135deg,#2a1a0f,#6B4E3A,#C4A37A)', author: 'noor_k', label: 'FASHION' },
    { bg: 'linear-gradient(135deg,#0f1a2a,#2a4a6a,#4E8BC4)', author: 'j.park', label: 'SCI-FI' },
    { bg: 'linear-gradient(135deg,#0f2a1f,#2a6B4A,#7AC49E)', author: 'studio.v', label: 'NATURE' },
    { bg: 'linear-gradient(135deg,#2a0f1a,#6B1F4A,#B54E7A)', author: 'hex_9', label: 'ANIME' },
    { bg: 'linear-gradient(135deg,#2a2a0f,#6B6B2F,#C4C47A)', author: 'alma', label: 'PRODUCT' },
  ];

  return (
    <div style={{ width: '100%', height: '100%', background: bg, color: '#FFF', fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {/* Navbar (floats over hero) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <Logo />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {['Explore','Image','Video','Audio','Studio','Edit'].map(n => (
              <div key={n} style={{ padding: '6px 10px', fontSize: 13, fontWeight: 500, color: n === 'Explore' ? '#FFF' : 'rgba(255,255,255,0.7)', borderBottom: n === 'Explore' ? `2px solid ${red}` : '2px solid transparent', paddingBottom: 4 }}>{n}</div>
            ))}
          </div>
        </div>
        <div style={{ padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, background: red, color: '#FFF', boxShadow: `0 0 24px ${red}66` }}>Sign Up →</div>
      </div>

      {/* Full-bleed hero */}
      <div style={{ position: 'relative', height: '62%', background: 'linear-gradient(135deg,#1a0a0a 0%,#3a1a1a 25%,#8B2F1F 55%,#E01E1E 85%,#FFB57A 100%)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: noise, opacity: 0.14, mixBlendMode: 'overlay' }} />
        <div style={{ position: 'absolute', top: '20%', right: '15%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(255,220,180,0.5), transparent 60%)', filter: 'blur(30px)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.5) 70%, rgba(5,5,5,1) 100%)' }} />

        {/* Meta — bottom-left */}
        <div style={{ position: 'absolute', bottom: 40, left: 40, right: 40, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: red, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>
              <span style={{ padding: '3px 8px', background: red, color: '#FFF', borderRadius: 2 }}>FEATURED</span>
              <span>Today's Spotlight · @marco.ridley</span>
            </div>
            <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 78, letterSpacing: '0.005em', lineHeight: 0.9, color: '#FFF', textShadow: '0 4px 30px rgba(0,0,0,0.6)' }}>
              A SAMURAI IN<br/>THE BAMBOO MIST.
            </div>
            <div style={{ marginTop: 14, fontSize: 14, color: 'rgba(255,255,255,0.85)', maxWidth: 520, lineHeight: 1.5 }}>
              Anamorphic lens flare, dawn light, ARRI 35mm — Nano Banana Pro. 847 remixes this week.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <div style={{ padding: '10px 20px', background: '#FFF', color: '#0A0A0A', fontSize: 12.5, fontWeight: 700, borderRadius: 6, fontFamily: 'Anton, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase' }}>View & Remix →</div>
              <div style={{ padding: '10px 20px', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontSize: 12.5, fontWeight: 600, borderRadius: 6 }}>Copy Prompt</div>
            </div>
          </div>
          {/* Stats sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'right' }}>
            <div>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 42, color: red, lineHeight: 1 }}>12.4K</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Likes</div>
            </div>
            <div>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 42, color: '#FFF', lineHeight: 1 }}>847</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Remixes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Secondary rail */}
      <div style={{ position: 'relative', flex: 1, padding: '22px 40px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 22, letterSpacing: '0.04em' }}>MORE FROM THE COMMUNITY</div>
          <div style={{ fontSize: 11, color: red, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>See all →</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 }}>
          {mini.map((t, i) => (
            <div key={i} style={{ height: 180, borderRadius: 4, background: t.bg, position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ position: 'absolute', inset: 0, backgroundImage: noise, opacity: 0.12, mixBlendMode: 'overlay' }} />
              <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 8, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.15em', color: '#FFF', padding: '2px 6px', background: 'rgba(0,0,0,0.6)' }}>{t.label}</div>
              <div style={{ position: 'absolute', bottom: 8, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10 }}>
                <span style={{ color: '#FFF', fontWeight: 500 }}>@{t.author}</span>
                <span style={{ color: red, fontFamily: 'JetBrains Mono, monospace' }}>♥</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.V_Explore_V2 = V_Explore_V2;
