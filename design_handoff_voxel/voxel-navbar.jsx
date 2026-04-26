// Voxel Navbar — on-brand with Circular Credit Button
// Two states side-by-side: collapsed (circle) and expanded (popover open)

function V_Navbar() {
  const red = '#E01E1E';
  const redHot = '#FF2A2A';
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
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)', marginTop: -2 }}>AI</span>
    </div>
  );

  const primaryNav = [
    { n: 'Explore' }, { n: 'Image', active: true }, { n: 'Video' },
    { n: 'Audio' }, { n: 'Studio', pill: 'New' }, { n: 'Edit', pill: 'Coming Soon', soon: true },
  ];
  const secondaryNav = ['Apps', 'Community', 'Pricing'];

  const NavItems = () => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {primaryNav.map(item => (
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
        {secondaryNav.map(n => <span key={n}>{n}</span>)}
      </div>
    </>
  );

  // COLLAPSED STATE — circle with clean progress ring around it
  const CircleCredit = () => {
    const R = 22;                         // ring radius (outside border)
    const CIRC = 2 * Math.PI * R;
    const pctRemaining = 0.8;             // 80% remaining
    const dashOffset = CIRC * (1 - pctRemaining);
    return (
      <div style={{ position: 'relative', width: 48, height: 48 }}>
        {/* Full 360° track — always visible all the way around */}
        <svg width="48" height="48" viewBox="0 0 48 48"
             style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <circle cx="24" cy="24" r={R} fill="none"
                  stroke="rgba(224,30,30,0.35)" strokeWidth="1.5" />
        </svg>
        {/* Active depleting arc on top */}
        <svg width="48" height="48" viewBox="0 0 48 48"
             style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
          <circle cx="24" cy="24" r={R} fill="none"
                  stroke={red} strokeWidth="2"
                  strokeDasharray={CIRC}
                  strokeDashoffset={dashOffset}
                  style={{ filter: `drop-shadow(0 0 4px ${red})` }} />
        </svg>
        <div style={{
          position: 'absolute', top: 4, left: 4, width: 40, height: 40,
          borderRadius: '50%',
          background: `radial-gradient(circle at 50% 45%, rgba(224,30,30,0.28), rgba(224,30,30,0.1))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: `0 0 12px rgba(224,30,30,0.25)`,
        }}>
          <span style={{ color: red, fontSize: 15, lineHeight: 1 }}>✦</span>
        </div>
      </div>
    );
  };

  // EXPANDED STATE — circle + popover
  const UsageBar = ({ label, used, total, color }) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontFamily: 'DM Sans, sans-serif' }}>{label}</span>
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, monospace' }}>{used.toLocaleString()} / {total.toLocaleString()}</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(used/total)*100}%`, background: color, borderRadius: 999, boxShadow: `0 0 8px ${color}88` }} />
      </div>
    </div>
  );

  const Popover = () => (
    <div style={{
      position: 'absolute', top: 50, right: 0, width: 300,
      background: 'rgba(15,8,8,0.96)',
      backdropFilter: 'blur(40px) saturate(1.6)',
      border: '1px solid rgba(224,30,30,0.25)', borderRadius: 16,
      boxShadow: `0 24px 70px rgba(0,0,0,0.7), 0 0 40px rgba(224,30,30,0.2)`,
      padding: 20, zIndex: 50,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10.5, color: red, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>
            ✦ CREDITS
          </div>
          <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 38, color: '#FFF', letterSpacing: '0.01em', lineHeight: 1 }}>
            40,000
          </div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginTop: 5 }}>
            of 50,000 total
          </div>
        </div>
        <div style={{
          padding: '4px 10px', borderRadius: 999, fontSize: 9.5, fontWeight: 700,
          background: 'rgba(224,30,30,0.15)', border: `1px solid ${red}`, color: red,
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>PRO</div>
      </div>

      {/* Overall usage bar */}
      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ height: '100%', width: '80%', background: `linear-gradient(90deg, ${redHot}, ${red})`, borderRadius: 999, boxShadow: `0 0 12px ${red}` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.5)', marginBottom: 18 }}>
        <span>10,000 used</span>
        <span>80% remaining</span>
      </div>

      {/* Renew date */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '11px 13px', background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, marginBottom: 14,
      }}>
        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>Renews on</span>
        <span style={{ fontSize: 11.5, color: '#FFF', fontFamily: 'JetBrains Mono, monospace' }}>May 15, 2026</span>
      </div>

      {/* Upgrade button */}
      <button style={{
        width: '100%', height: 42, borderRadius: 10, border: 'none',
        background: `linear-gradient(180deg, ${redHot}, #8B0F0F)`,
        color: '#FFF', fontSize: 13, fontWeight: 700,
        fontFamily: 'Anton, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase',
        cursor: 'pointer',
        boxShadow: `0 0 24px rgba(224,30,30,0.5), 0 6px 16px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <span>Upgrade</span>
        <span>→</span>
      </button>
    </div>
  );

  const ExpandedCredit = () => {
    const R = 22;
    const CIRC = 2 * Math.PI * R;
    const pctRemaining = 0.8;
    const dashOffset = CIRC * (1 - pctRemaining);
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative', width: 48, height: 48 }}>
          <svg width="48" height="48" viewBox="0 0 48 48"
               style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <circle cx="24" cy="24" r={R} fill="none"
                    stroke="rgba(224,30,30,0.35)" strokeWidth="1.5" />
          </svg>
          <svg width="48" height="48" viewBox="0 0 48 48"
               style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
            <circle cx="24" cy="24" r={R} fill="none"
                    stroke={red} strokeWidth="2"
                    strokeDasharray={CIRC}
                    strokeDashoffset={dashOffset}
                    style={{ filter: `drop-shadow(0 0 4px ${red})` }} />
          </svg>
          <div style={{
            position: 'absolute', top: 4, left: 4, width: 40, height: 40,
            borderRadius: '50%',
            background: `radial-gradient(circle at 50% 45%, rgba(224,30,30,0.4), rgba(224,30,30,0.15))`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: `0 0 18px rgba(224,30,30,0.5)`,
          }}>
            <span style={{ color: red, fontSize: 15, lineHeight: 1 }}>✦</span>
          </div>
        </div>
        <Popover />
      </div>
    );
  };

  // Render two navbar states stacked
  const Navbar = ({ expanded, caption }) => (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
        {caption}
      </div>
      <div style={{
        position: 'relative',
        height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', borderRadius: 12,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          <Logo />
          <NavItems />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Login ghost */}
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', padding: '7px 10px' }}>Login</div>
          {/* Sign Up button */}
          <div style={{
            padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 8,
            background: red, color: '#FFF',
            boxShadow: `0 0 24px ${red}66, 0 4px 14px rgba(224,30,30,0.4)`,
          }}>Sign Up →</div>
          {/* Credit button */}
          {expanded ? <ExpandedCredit /> : <CircleCredit />}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{
      width: '100%', height: '100%', background: bg, color: '#FFF',
      fontFamily: 'DM Sans, Inter, -apple-system, sans-serif',
      padding: 40, display: 'flex', flexDirection: 'column', gap: 32,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Red ambient glow */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '-30%', right: '-10%', width: 800, height: 800,
          background: 'radial-gradient(circle, rgba(224,30,30,0.22), transparent 60%)',
          filter: 'blur(60px)',
        }} />
      </div>

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 28, letterSpacing: '0.02em', marginBottom: 6 }}>
          NAVBAR · GLOBAL · CREDIT BUTTON
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', maxWidth: 600 }}>
          Circular credit button sits in the top-right of every page. Click to open a detailed usage breakdown — credits remaining, per-category usage (Image / Video / Audio / Edit), plan tier, renewal date, and upgrade CTA.
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 36 }}>
        <Navbar expanded={false} caption="State 01 — Collapsed (default)" />
        <Navbar expanded={true}  caption="State 02 — Expanded (on click)" />
      </div>

      <div style={{
        position: 'relative', zIndex: 2,
        padding: 16, background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
        fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6,
      }}>
        <span style={{ color: red, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 10.5, fontWeight: 600 }}>Spec</span>
        <div style={{ marginTop: 6 }}>
          40×40 circle · progress ring shows usage % · click toggles popover · global component, same on every page · replaces the existing text chip in navbar · doubles as the plan/billing entry point.
        </div>
      </div>
    </div>
  );
}

window.V_Navbar = V_Navbar;
