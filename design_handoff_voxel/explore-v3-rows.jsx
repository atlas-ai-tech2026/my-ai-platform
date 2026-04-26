// EXPLORE V3 — Category rows (Netflix/streaming style)
// Horizontal scrolling rows, each a category or curated list.
// Made for browsing, not discovering. Feels familiar.

function V_Explore_V3() {
  const red = '#E01E1E';
  const bg = '#0A0A0A';
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

  const gen = (h, b, s, l, a, badge) => ({ h, bg: b, subj: s, label: l, author: a, badge });
  const rows = [
    {
      title: 'TRENDING NOW', sub: 'What the world is generating today',
      items: [
        gen(170, 'linear-gradient(135deg,#2a0f0f,#8B2F2F,#D9733A)', '40% 50%', 'CINEMA', 'marco.r', '🔥 #1'),
        gen(170, 'linear-gradient(135deg,#1a0f2a,#4a2a6a,#8B4E8B)', '55% 45%', 'PORTRAIT', 'ira.ln', '#2'),
        gen(170, 'linear-gradient(135deg,#2a1a0f,#6B4E3A,#C4A37A)', '40% 55%', 'FASHION', 'noor_k', '#3'),
        gen(170, 'linear-gradient(135deg,#0f1a2a,#2a4a6a,#4E8BC4)', '60% 40%', 'SCI-FI', 'j.park', '#4'),
        gen(170, 'linear-gradient(135deg,#0f2a1f,#2a6B4A,#7AC49E)', '50% 50%', 'NATURE', 'studio.v', '#5'),
        gen(170, 'linear-gradient(135deg,#2a0f1a,#6B1F4A,#B54E7A)', '45% 50%', 'ANIME', 'hex_9', '#6'),
      ],
    },
    {
      title: 'CINEMATIC', sub: 'ARRI · anamorphic · filmic',
      items: [
        gen(170, 'linear-gradient(135deg,#1a0a0a,#3a1a1a,#8B3F1F)', '30% 70%', 'WIDE', 'marco.r'),
        gen(170, 'linear-gradient(135deg,#0a1a1a,#1a4a4a,#4a8B8B)', '65% 40%', 'CLOSE', 'studio.v'),
        gen(170, 'linear-gradient(135deg,#1a0f0a,#3a1f1a,#6B3F2F)', '50% 60%', 'NIGHT', 'alma'),
        gen(170, 'linear-gradient(135deg,#0f0f0f,#2a1a0f,#6B4E2F)', '40% 45%', 'DUSK', 'j.park'),
        gen(170, 'linear-gradient(135deg,#1a1a2a,#2a2a4a,#4a4a7a)', '55% 50%', 'BLUE', 'hex_9'),
        gen(170, 'linear-gradient(135deg,#2a0f2a,#4a1a4a,#8B3F8B)', '45% 55%', 'NEON', 'ira.ln'),
      ],
    },
    {
      title: 'FROM CREATORS YOU FOLLOW', sub: '3 new this week',
      items: [
        gen(170, 'linear-gradient(135deg,#2a1a0f,#6B4E3A,#C4A37A)', '50% 50%', 'PORTRAIT', 'noor_k'),
        gen(170, 'linear-gradient(135deg,#0f2a2a,#2a6B6B,#7EC4C4)', '50% 50%', 'PRODUCT', 'alma'),
        gen(170, 'linear-gradient(135deg,#2a2a0f,#6B6B2F,#C4C47A)', '40% 60%', 'FASHION', 'noor_k'),
        gen(170, 'linear-gradient(135deg,#0f1a0f,#2f4a2f,#7AC47A)', '50% 50%', 'NATURE', 'studio.v'),
        gen(170, 'linear-gradient(135deg,#1a0f1a,#4a2a4a,#8B4E8B)', '45% 55%', 'SURREAL', 'hex_9'),
        gen(170, 'linear-gradient(135deg,#2a1a1a,#6B3F3F,#C47A7A)', '55% 45%', 'PORTRAIT', 'marco.r'),
      ],
    },
  ];

  const Tile = ({ t }) => (
    <div style={{ width: 220, height: t.h, borderRadius: 6, background: t.bg, position: 'relative', overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: noise, opacity: 0.12, mixBlendMode: 'overlay' }} />
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at ${t.subj}, rgba(255,255,255,0.22), transparent 55%)` }} />
      {t.badge && (
        <div style={{ position: 'absolute', top: 8, left: 8, fontFamily: 'Anton, sans-serif', fontSize: 14, letterSpacing: '0.04em', padding: '2px 8px', background: red, color: '#FFF', borderRadius: 3 }}>{t.badge}</div>
      )}
      <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 8, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.15em', color: '#FFF', padding: '2px 6px', background: 'rgba(0,0,0,0.6)' }}>{t.label}</div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 10px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}>
        <div style={{ fontSize: 10, color: '#FFF', fontWeight: 500 }}>@{t.author}</div>
      </div>
    </div>
  );

  return (
    <div style={{ width: '100%', height: '100%', background: bg, color: '#FFF', fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: noise, opacity: 0.08, mixBlendMode: 'overlay', zIndex: 0 }} />

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
        <div style={{ padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, background: red, color: '#FFF', boxShadow: `0 0 24px ${red}66` }}>Sign Up →</div>
      </div>

      {/* Hero strip */}
      <div style={{ position: 'relative', zIndex: 2, padding: '22px 28px 12px' }}>
        <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 46, letterSpacing: '0.01em', lineHeight: 0.95 }}>
          EXPLORE THE <span style={{ color: red }}>UNIVERSE</span>.
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>Millions of generations. Curated for you.</div>
      </div>

      {/* Rows */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, overflow: 'hidden', paddingBottom: 20 }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ padding: '12px 0 6px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 28px 10px' }}>
              <div>
                <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 20, letterSpacing: '0.05em' }}>{row.title}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>{row.sub}</div>
              </div>
              <div style={{ fontSize: 10, color: red, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>See all →</div>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '0 28px', overflow: 'hidden' }}>
              {row.items.map((t, i) => <Tile key={i} t={t} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
window.V_Explore_V3 = V_Explore_V3;
