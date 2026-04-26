// Voxel brand-aligned Image page — Direction 4 DNA but with true Voxel identity:
// Anton display type, VOXEL wordmark, red #E01E1E as brand primary (not just accent),
// black background with red ambient glow, "New Model" / "Coming Soon" pill language.

function V_ImageOnBrand() {
  const red = '#E01E1E';
  const redHot = '#FF2A2A';
  const redDeep = '#8B0F0F';
  const bg = '#0A0A0A';

  // noise removed — clean flat surfaces only

  // Wordmark: stylized V cube + VOXEL text
  const Logo = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z" stroke={red} strokeWidth="1.6" fill="rgba(224,30,30,0.15)" />
        <path d="M12 2 L12 22 M2 7 L22 17 M22 7 L2 17" stroke={red} strokeWidth="1" opacity="0.7" />
      </svg>
      <span style={{
        fontFamily: 'Anton, sans-serif', fontSize: 19, letterSpacing: '0.04em',
        color: red, textShadow: `0 0 18px ${red}88`,
      }}>VOXEL</span>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.5)', marginTop: -2,
      }}>AI</span>
    </div>
  );

  const tiles = [
    { bg: 'linear-gradient(135deg,#4a2f1a,#8B6F4E 60%,#C4A37A)', tall: false, label: 'CINEMA' },
    { bg: 'linear-gradient(135deg,#1a0f2a,#4a2a6a 70%,#8B4E8B)', tall: true, label: 'PORTRAIT' },
    { bg: 'linear-gradient(135deg,#2a0f0f,#8B2F2F 70%,#D9733A)', tall: false, label: 'ACTION' },
    { bg: 'linear-gradient(135deg,#0f1a2a,#2a4a6a 70%,#4E8BC4)', tall: false, label: 'SCI-FI' },
    { bg: 'linear-gradient(135deg,#2a1a0f,#6B4E3A 60%,#C4A37A)', tall: true, label: 'CINEMA' },
    { bg: 'linear-gradient(135deg,#0f2a1f,#2a6B4A 60%,#7AC49E)', tall: false, label: 'NATURE' },
  ];

  const chip = (active, accent) => ({
    display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px',
    background: accent ? 'rgba(224,30,30,0.16)' : active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${accent ? 'rgba(224,30,30,0.5)' : active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
    backdropFilter: 'blur(18px) saturate(1.4)',
    borderRadius: 999, fontSize: 12,
    color: accent ? '#FFB5B5' : '#FFF',
    fontFamily: 'DM Sans, Inter, sans-serif', fontWeight: 500,
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{
      width: '100%', height: '100%', background: bg, color: '#FFF',
      fontFamily: 'DM Sans, Inter, -apple-system, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
    }}>
      {/* Red ambient glow bg */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <div style={{
          position: 'absolute', top: '-20%', right: '-10%', width: 900, height: 900,
          background: 'radial-gradient(circle, rgba(224,30,30,0.28), transparent 60%)',
          filter: 'blur(60px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', left: '-10%', width: 700, height: 700,
          background: 'radial-gradient(circle, rgba(139,15,15,0.4), transparent 65%)',
          filter: 'blur(60px)',
        }} />
      </div>

      {/* Navbar — thin, brand logo, no rounded island */}
      <div style={{
        position: 'relative', zIndex: 10,
        height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(10,10,10,0.7)', backdropFilter: 'blur(24px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <Logo />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {[
              { n: 'Explore' }, { n: 'Image', active: true }, { n: 'Video' },
              { n: 'Audio' }, { n: 'Studio', pill: 'New' }, { n: 'Edit', pill: 'Coming Soon', soon: true },
            ].map(item => (
              <div key={item.n} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', fontSize: 13, fontWeight: 500,
                color: item.active ? '#FFF' : 'rgba(255,255,255,0.65)',
                borderBottom: item.active ? `2px solid ${red}` : '2px solid transparent',
                paddingBottom: 4,
              }}>
                <span>{item.n}</span>
                {item.pill && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                    padding: '2px 7px', borderRadius: 999,
                    background: item.soon ? red : 'rgba(224,30,30,0.8)',
                    color: '#FFF', textTransform: 'uppercase',
                  }}>{item.pill}</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
            <span>Apps</span><span>Community</span><span>Pricing</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 999,
            background: 'rgba(255,255,255,0.06)', fontSize: 11.5,
          }}>
            <span style={{ color: red }}>✦</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>40,000</span>
          </div>
          <div style={{
            padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 8,
            background: red, color: '#FFF',
            boxShadow: `0 0 24px ${red}66, 0 4px 14px rgba(224,30,30,0.4)`,
          }}>Sign Up →</div>
        </div>
      </div>

      {/* Content */}
      <div style={{
        position: 'relative', zIndex: 2, flex: 1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        padding: '20px 28px 0',
      }}>
        {/* Model hero */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          padding: '4px 0 16px',
        }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 10.5, color: red,
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10,
              fontWeight: 600,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: red, boxShadow: `0 0 10px ${red}` }} />
              Flagship · Nano Banana Pro
            </div>
            <div style={{
              fontFamily: 'Anton, sans-serif',
              fontSize: 52, letterSpacing: '0.01em', lineHeight: 0.95,
              color: '#FFF',
            }}>
              CREATE WITHOUT LIMITS
            </div>
            <div style={{
              marginTop: 10, fontSize: 14, color: 'rgba(255,255,255,0.6)', maxWidth: 560,
            }}>
              4K image generation with cinematic control. Describe anything, generate in seconds.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {['History', 'Saved', 'Community'].map((n, i) => (
              <div key={n} style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 500, borderRadius: 999,
                background: i === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${i === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
                color: i === 0 ? '#FFF' : 'rgba(255,255,255,0.6)',
                backdropFilter: 'blur(14px)',
              }}>{n}</div>
            ))}
          </div>
        </div>

        {/* Gallery row */}
        <div style={{
          display: 'flex', gap: 12, overflow: 'hidden',
          paddingBottom: 200, alignItems: 'flex-start',
        }}>
          {/* Loading card */}
          <div style={{
            width: 200, height: 260, borderRadius: 12, overflow: 'hidden',
            background: 'rgba(20,10,10,0.6)', backdropFilter: 'blur(20px)',
            border: `1px solid ${red}`,
            boxShadow: `0 0 30px rgba(224,30,30,0.35), 0 12px 36px rgba(0,0,0,0.5)`,
            display: 'flex', flexDirection: 'column', flexShrink: 0,
          }}>
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg,rgba(224,30,30,0.2),rgba(139,15,15,0.4))`,
              position: 'relative',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: `radial-gradient(circle, ${redHot}, transparent)`,
                filter: 'blur(8px)', opacity: 0.8,
              }} />
              <div style={{ position: 'absolute', fontSize: 20, color: '#FFF' }}>✦</div>
            </div>
            <div style={{ padding: '10px 12px' }}>
              <div style={{
                fontSize: 10, color: red, fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace', marginBottom: 5,
                letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>Rendering 67%</div>
              <div style={{ height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 999 }}>
                <div style={{ height: '100%', width: '67%', background: red, borderRadius: 999,
                  boxShadow: `0 0 10px ${red}` }} />
              </div>
            </div>
          </div>

          {tiles.map((t, i) => (
            <div key={i} style={{
              width: 200, height: t.tall ? 320 : 260, borderRadius: 12, overflow: 'hidden',
              background: t.bg, position: 'relative', flexShrink: 0,
              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: `radial-gradient(ellipse at ${20 + i*10}% ${60 + (i*13)%20}%, rgba(255,255,255,0.22), transparent 50%)`,
              }} />
              {/* NEW MODEL badge on first */}
              {i === 0 && (
                <div style={{
                  position: 'absolute', top: 10, left: 10,
                  padding: '4px 9px', borderRadius: 4,
                  background: red, fontSize: 9, fontWeight: 800,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  fontFamily: 'DM Sans, sans-serif',
                }}>NEW MODEL</div>
              )}
              {/* Category label */}
              <div style={{
                position: 'absolute', bottom: 10, left: 10,
                fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                letterSpacing: '0.15em', color: 'rgba(255,255,255,0.85)',
                padding: '3px 7px', borderRadius: 4,
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
              }}>{t.label}</div>
              {/* Like */}
              <div style={{
                position: 'absolute', top: 10, right: 10,
                width: 28, height: 28, borderRadius: '50%',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: '#FFF',
              }}>♥</div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating prompt bar — stronger red, Anton-styled Generate */}
      <div style={{
        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        width: 'min(900px, 94%)', zIndex: 20,
        background: 'rgba(15,8,8,0.65)',
        backdropFilter: 'blur(50px) saturate(1.6)',
        border: '1px solid rgba(224,30,30,0.2)', borderRadius: 20,
        boxShadow: `0 24px 70px rgba(0,0,0,0.6), 0 0 40px rgba(224,30,30,0.15), 0 1px 0 rgba(255,255,255,0.08) inset`,
        padding: '14px 16px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.7)', fontSize: 13,
          }}>+</div>
          <div style={{
            padding: '3px 9px', borderRadius: 4, fontSize: 9.5, fontWeight: 700,
            background: red, color: '#FFF',
            fontFamily: 'DM Sans, sans-serif',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>Cinema · ARRI 35 · 50mm</div>
        </div>

        <div style={{
          fontSize: 15, color: '#FFF', minHeight: 44, lineHeight: 1.6, fontWeight: 400,
        }}>
          A samurai standing in misty bamboo forest at dawn, anamorphic lens flare
          <span style={{ borderRight: `1.5px solid ${red}`, marginLeft: 1 }}>&nbsp;</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10,
        }}>
          <div style={chip(true, true)}>
            <span style={{ width: 7, height: 7, background: red, borderRadius: 999, boxShadow: `0 0 6px ${red}` }} />
            <span>Nano Banana Pro</span>
            <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
          </div>
          <div style={chip(false, false)}>
            <div style={{ width: 13, height: 8, border: '1.5px solid #FFF', borderRadius: 1 }} />
            <span>16:9</span>
          </div>
          <div style={chip(false, false)}><span style={{ color: 'rgba(255,255,255,0.7)' }}>✦</span><span>2K</span></div>
          <div style={{ ...chip(false, false), padding: '0 8px', gap: 4 }}>
            <span style={{ padding: '0 4px', color: 'rgba(255,255,255,0.7)' }}>−</span>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>1 / 4</span>
            <span style={{ padding: '0 4px', color: 'rgba(255,255,255,0.7)' }}>+</span>
          </div>
          <div style={chip(false, false)}>Negative</div>
          <div style={chip(true, false)}><span>◇</span><span>Cinematic</span></div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontFamily: 'JetBrains Mono, monospace' }}>150 ✦</div>
            <div style={{
              height: 40, padding: '0 22px', borderRadius: 999,
              background: `linear-gradient(180deg, ${redHot}, ${redDeep})`,
              color: '#FFF', fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'Anton, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase',
              boxShadow: `0 0 30px ${red}88, 0 6px 20px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset`,
            }}>
              <span>GENERATE</span>
              <span style={{ fontSize: 14 }}>→</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.V_ImageOnBrand = V_ImageOnBrand;
