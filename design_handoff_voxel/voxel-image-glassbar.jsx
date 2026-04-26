// Voxel Image page — GLASS PROMPT BAR variation.
// Same brand DNA as V_ImageOnBrand, but the floating prompt box is truly
// transparent + heavily blurred so the gallery bleeds through it.
// Match: /uploads/Screenshot 2026-04-22 at 4.56.43 PM (close-up of glass bar
// over cinematic thumbnails) — dark translucent tint, no hard red border,
// just a whisper of white at the edge and a red accent strip on top.

function V_ImageGlassBar() {
  const red = '#E01E1E';
  const redHot = '#FF2A2A';
  const redDeep = '#8B0F0F';
  const bg = '#0A0A0A';

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

  // Gallery tiles — richer, more photographic feel so you can SEE the blur working
  const tiles = [
    { bg: 'linear-gradient(160deg,#2a1208 0%,#8B4A26 40%,#E8A668 100%)', tall: false, label: 'CINEMA' },
    { bg: 'linear-gradient(150deg,#120a24 0%,#3a1f55 45%,#7a3a8f 100%)', tall: true,  label: 'PORTRAIT' },
    { bg: 'linear-gradient(145deg,#2a0808 0%,#A02a2a 50%,#F26a3a 100%)', tall: false, label: 'ACTION' },
    { bg: 'linear-gradient(150deg,#081a2a 0%,#1f4a7a 50%,#5EA4D9 100%)', tall: false, label: 'SCI-FI' },
    { bg: 'linear-gradient(155deg,#1f1208 0%,#6B4A2a 50%,#C4A37A 100%)', tall: true,  label: 'CINEMA' },
    { bg: 'linear-gradient(150deg,#082a1a 0%,#2a7a55 50%,#7AE0A8 100%)', tall: false, label: 'NATURE' },
  ];

  const chip = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 12px',
    background: active ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)'}`,
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    borderRadius: 999, fontSize: 12,
    color: '#FFF',
    fontFamily: 'DM Sans, Inter, sans-serif', fontWeight: 500,
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{
      width: '100%', height: '100%', background: bg, color: '#FFF',
      fontFamily: 'DM Sans, Inter, -apple-system, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
    }}>
      {/* Ambient red glow */}
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

      {/* Navbar */}
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

        {/* Gallery — pushed further down so the glass bar overlaps richer imagery */}
        <div style={{
          display: 'flex', gap: 12, overflow: 'hidden',
          paddingBottom: 180, alignItems: 'flex-start',
          marginTop: 8,
        }}>
          {/* Loading card */}
          <div style={{
            width: 210, height: 290, borderRadius: 12, overflow: 'hidden',
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
              width: 210, height: t.tall ? 340 : 290, borderRadius: 12, overflow: 'hidden',
              background: t.bg, position: 'relative', flexShrink: 0,
              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {/* Subtle "figure" shape so the blur has real content to smear */}
              <div style={{
                position: 'absolute', left: '50%', top: '30%',
                width: 80, height: 180, transform: 'translateX(-50%)',
                background: 'radial-gradient(ellipse at 50% 30%, rgba(0,0,0,0.55), transparent 65%)',
                filter: 'blur(6px)',
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: `radial-gradient(ellipse at ${20 + i*10}% ${20 + (i*13)%20}%, rgba(255,255,255,0.22), transparent 50%)`,
              }} />
              {i === 0 && (
                <div style={{
                  position: 'absolute', top: 10, left: 10,
                  padding: '4px 9px', borderRadius: 4,
                  background: red, fontSize: 9, fontWeight: 800,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  fontFamily: 'DM Sans, sans-serif',
                }}>NEW MODEL</div>
              )}
              <div style={{
                position: 'absolute', bottom: 10, left: 10,
                fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                letterSpacing: '0.15em', color: 'rgba(255,255,255,0.85)',
                padding: '3px 7px', borderRadius: 4,
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
              }}>{t.label}</div>
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

      {/* GLASS PROMPT BAR — Artlist-style: dark tint, heavy blur,         */}
      {/* sidebar icon column + main area, rounded chips at bottom.         */}
      <div style={{
        position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)',
        width: 'min(920px, 94%)', zIndex: 20,
        // DARK translucent — images smear through it like Artlist
        background: 'rgba(20,18,20,0.35)',
        backdropFilter: 'blur(32px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 24,
        boxShadow: [
          '0 30px 80px rgba(0,0,0,0.55)',
          '0 1px 0 rgba(255,255,255,0.1) inset',
          `0 0 60px rgba(224,30,30,0.08)`,
        ].join(', '),
        padding: '14px 16px 12px',
        overflow: 'visible',
      }}>
        {/* Red resize-handle on top center */}
        <div style={{
          position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)',
          width: 40, height: 3, borderRadius: 2,
          background: red, boxShadow: `0 0 10px ${red}`,
        }} />

        {/* Top row — + button, model badge, right-side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: 'blur(20px)',
            borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: 300,
          }}>+</div>

          <div style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 9.5, fontWeight: 700,
            background: 'rgba(224,30,30,0.9)', color: '#FFF',
            fontFamily: 'DM Sans, sans-serif',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            boxShadow: `0 0 16px rgba(224,30,30,0.5)`,
          }}>Cinema · ARRI 35 · 50mm</div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.75)', fontSize: 14,
            }}>←</div>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.85)',
              fontFamily: 'Playfair Display, serif',
              fontStyle: 'italic', fontSize: 14,
            }}>T</div>
          </div>
        </div>

        {/* Prompt text */}
        <div style={{
          fontSize: 15, color: 'rgba(255,255,255,0.95)', minHeight: 44,
          lineHeight: 1.6, fontWeight: 400, padding: '2px 2px 8px',
        }}>
          A samurai standing in misty bamboo forest at dawn, anamorphic lens flare
          <span style={{ borderRight: `1.5px solid ${red}`, marginLeft: 1 }}>&nbsp;</span>
        </div>

        {/* Bottom row — chips + generate */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        }}>
          <div style={{ ...chip(true),
            background: 'rgba(224,30,30,0.2)',
            border: '1px solid rgba(224,30,30,0.4)',
            color: '#FFD8D8',
          }}>
            <span style={{ width: 7, height: 7, background: red, borderRadius: 999, boxShadow: `0 0 6px ${red}` }} />
            <span>Nano Banana Pro</span>
            <span style={{ opacity: 0.6, fontSize: 10 }}>▾</span>
          </div>
          <div style={chip(false)}>
            <div style={{ width: 13, height: 8, border: '1.5px solid #FFF', borderRadius: 1 }} />
            <span>16:9</span>
          </div>
          <div style={chip(false)}><span style={{ color: 'rgba(255,255,255,0.7)' }}>✦</span><span>2K</span></div>
          <div style={{ ...chip(false), padding: '0 8px', gap: 4 }}>
            <span style={{ padding: '0 4px', color: 'rgba(255,255,255,0.7)' }}>−</span>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>1 / 4</span>
            <span style={{ padding: '0 4px', color: 'rgba(255,255,255,0.7)' }}>+</span>
          </div>
          <div style={chip(false)}>Negative Prompt</div>
          <div style={chip(true)}><span>◇</span><span>Cinematic</span></div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontFamily: 'JetBrains Mono, monospace' }}>150 ✦</div>
            <div style={{
              height: 38, padding: '0 22px', borderRadius: 999,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Close-up view — just the glass bar over a photographic gallery strip.
// Matches the "close on the box" reference image exactly.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function V_GlassBarCloseup() {
  const red = '#E01E1E';
  const redHot = '#FF2A2A';
  const redDeep = '#8B0F0F';

  // Fake but rich photographic thumbnails so the blur has real content to sample
  const photos = [
    { g: 'radial-gradient(ellipse at 30% 20%, #F5C87A 0%, #8B5A2B 25%, #2a1808 60%, #0a0402 100%)', figure: '#C8A06E' },
    { g: 'radial-gradient(ellipse at 50% 30%, #6B7280 0%, #3a4050 30%, #181c24 70%, #050608 100%)', figure: '#8B7A6B' },
    { g: 'radial-gradient(ellipse at 60% 40%, #A89068 0%, #5a4830 35%, #201810 75%, #0a0806 100%)', figure: '#C2A885' },
    { g: 'radial-gradient(ellipse at 40% 25%, #6B5540 0%, #3a2a1c 40%, #151008 80%, #080502 100%)', figure: '#A0845E' },
  ];

  return (
    <div style={{
      width: '100%', height: '100%', background: '#050202', position: 'relative',
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, Inter, sans-serif', color: '#FFF',
    }}>
      {/* Red ambient */}
      <div style={{
        position: 'absolute', top: '-20%', right: '-20%', width: 900, height: 900,
        background: 'radial-gradient(circle, rgba(224,30,30,0.35), transparent 60%)',
        filter: 'blur(60px)',
      }} />

      {/* Gallery strip (top) */}
      <div style={{
        position: 'absolute', top: 40, left: 40, right: 40,
        display: 'flex', gap: 16,
      }}>
        {photos.map((p, i) => (
          <div key={i} style={{
            flex: 1, height: 380, borderRadius: 16, overflow: 'hidden',
            background: p.g, position: 'relative',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            {/* "Character" silhouette so the blur really shows */}
            <div style={{
              position: 'absolute', left: '45%', top: '30%',
              width: 90, height: 200,
              background: `radial-gradient(ellipse at 50% 20%, ${p.figure}, transparent 60%)`,
              filter: 'blur(2px)',
            }} />
            {/* Light beam for drama */}
            <div style={{
              position: 'absolute', top: 0, left: '25%', width: 40, height: '60%',
              background: 'linear-gradient(180deg, rgba(255,240,200,0.35), transparent)',
              filter: 'blur(8px)', transform: 'rotate(-8deg)',
            }} />
            {/* Red hairline frame accent on a couple */}
            {(i === 0 || i === 2) && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 16, pointerEvents: 'none',
                boxShadow: `inset 0 0 0 1px rgba(224,30,30,0.55), inset 0 0 40px rgba(224,30,30,0.12)`,
              }} />
            )}
          </div>
        ))}
      </div>

      {/* THE GLASS BAR — Artlist-style dark transparent */}
      <div style={{
        position: 'absolute', bottom: 40, left: 40, right: 40,
        height: 300,
        background: 'rgba(20,18,20,0.38)',
        backdropFilter: 'blur(36px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 24,
        boxShadow: [
          '0 40px 100px rgba(0,0,0,0.7)',
          '0 1px 0 rgba(255,255,255,0.1) inset',
          `0 0 80px rgba(224,30,30,0.08)`,
        ].join(', '),
        padding: '20px 22px 20px 78px',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Left sidebar icon column (Artlist pattern) */}
        <div style={{
          position: 'absolute', left: 14, top: 20, bottom: 20, width: 48,
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: 4, borderRadius: 14,
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {[
            { icon: '▦', active: true },
            { icon: '▶' },
            { icon: '♪' },
          ].map((b, i) => (
            <div key={i} style={{
              height: 38, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: b.active ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: b.active ? '#FFF' : 'rgba(255,255,255,0.5)',
              fontSize: 15,
            }}>{b.icon}</div>
          ))}
        </div>
        {/* Red resize handle */}
        <div style={{
          position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)',
          width: 56, height: 3, borderRadius: 2,
          background: red, boxShadow: `0 0 12px ${red}`,
        }} />
        {/* Top-right small resize corner icon */}
        <div style={{
          position: 'absolute', top: 14, right: 14,
          color: 'rgba(255,255,255,0.45)', fontSize: 13,
        }}>⤢</div>
        {/* Drag-to-resize tooltip */}
        <div style={{
          position: 'absolute', top: -34, left: '50%', transform: 'translateX(-50%)',
          padding: '5px 10px', borderRadius: 6,
          background: 'rgba(20,20,20,0.85)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 500,
        }}>Drag to resize</div>

        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <div style={{
            width: 40, height: 40,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.9)', fontSize: 20, fontWeight: 300,
          }}>+</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.8)', fontSize: 16,
            }}>←</div>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.9)',
              fontFamily: 'Playfair Display, serif',
              fontStyle: 'italic', fontSize: 17,
            }}>T</div>
          </div>
        </div>

        {/* Prompt */}
        <div style={{
          fontSize: 17, color: 'rgba(255,255,255,0.65)', flex: 1,
          fontWeight: 400, padding: '4px 4px',
        }}>
          Describe the image you want to create
        </div>

        {/* Bottom row — generate */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px',
            background: 'rgba(224,30,30,0.2)',
            border: '1px solid rgba(224,30,30,0.45)',
            backdropFilter: 'blur(20px)',
            borderRadius: 999, fontSize: 12, color: '#FFD8D8', fontWeight: 500,
          }}>
            <span style={{ width: 7, height: 7, background: red, borderRadius: 999, boxShadow: `0 0 6px ${red}` }} />
            <span>Nano Banana Pro</span>
            <span style={{ opacity: 0.6, fontSize: 10 }}>▾</span>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(20px)',
            borderRadius: 999, fontSize: 12, color: '#FFF', fontWeight: 500,
          }}>16:9</div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(20px)',
            borderRadius: 999, fontSize: 12, color: '#FFF', fontWeight: 500,
          }}>◇ Cinematic</div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'JetBrains Mono, monospace' }}>150 ✦</div>
            <div style={{
              height: 42, padding: '0 26px', borderRadius: 999,
              background: `linear-gradient(180deg, ${redHot}, ${redDeep})`,
              color: '#FFF', fontSize: 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: 'Anton, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase',
              boxShadow: `0 0 30px ${red}88, 0 6px 20px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset`,
            }}>
              <span>GENERATE</span>
              <span style={{ fontSize: 16 }}>→</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.V_ImageGlassBar = V_ImageGlassBar;
window.V_GlassBarCloseup = V_GlassBarCloseup;
