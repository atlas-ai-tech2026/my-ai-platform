// Voxel Video page — 4 directions
// All share: Voxel brand (Anton, red #E01E1E, near-black bg), right-side prompt+model panel,
// creations feed on the left/center. Each direction has a distinct layout personality.

(() => {
const RED = '#E01E1E';
const RED_HOT = '#FF2A2A';
const RED_DEEP = '#8B0F0F';
const BG = '#0A0A0A';

// ─── Shared atoms ────────────────────────────────────────────────────────
const Logo = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 2 L22 7 L22 17 L12 22 L2 17 L2 7 Z" stroke={RED} strokeWidth="1.6" fill="rgba(224,30,30,0.15)" />
      <path d="M12 2 L12 22 M2 7 L22 17 M22 7 L2 17" stroke={RED} strokeWidth="1" opacity="0.7" />
    </svg>
    <span style={{ fontFamily: 'Anton, sans-serif', fontSize: 19, letterSpacing: '0.04em', color: RED, textShadow: `0 0 18px ${RED}88` }}>VOXEL</span>
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)', marginTop: -2 }}>AI</span>
  </div>
);

const Navbar = () => (
  <div style={{
    position: 'relative', zIndex: 10, height: 60,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 28px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(10,10,10,0.7)', backdropFilter: 'blur(24px)',
    fontFamily: 'DM Sans, Inter, sans-serif',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
      <Logo />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {[
          { n: 'Explore' }, { n: 'Image' }, { n: 'Video', active: true },
          { n: 'Audio' }, { n: 'Studio', pill: 'New' }, { n: 'Edit', pill: 'Coming Soon', soon: true },
        ].map(item => (
          <div key={item.n} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, fontWeight: 500,
            color: item.active ? '#FFF' : 'rgba(255,255,255,0.65)',
            borderBottom: item.active ? `2px solid ${RED}` : '2px solid transparent', paddingBottom: 4,
          }}>
            <span>{item.n}</span>
            {item.pill && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 999,
                background: item.soon ? RED : 'rgba(224,30,30,0.8)', color: '#FFF', textTransform: 'uppercase' }}>{item.pill}</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
        <span>Apps</span><span>Community</span><span>Pricing</span>
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', fontSize: 11.5 }}>
        <span style={{ color: RED }}>✦</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>40,000</span>
      </div>
      <div style={{ padding: '7px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, background: RED, color: '#FFF',
        boxShadow: `0 0 24px ${RED}66, 0 4px 14px rgba(224,30,30,0.4)` }}>Sign Up →</div>
    </div>
  </div>
);

const AmbientGlow = () => (
  <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
    <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: 900, height: 900,
      background: 'radial-gradient(circle, rgba(224,30,30,0.28), transparent 60%)', filter: 'blur(60px)' }} />
    <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: 700, height: 700,
      background: 'radial-gradient(circle, rgba(139,15,15,0.4), transparent 65%)', filter: 'blur(60px)' }} />
  </div>
);

// Photographic-ish video thumbnail
const VideoThumb = ({ hue, tall, aspect, label, playing, ch = '#C8A06E' }) => (
  <div style={{
    width: '100%', aspectRatio: aspect || (tall ? '9/16' : '16/9'),
    borderRadius: 14, overflow: 'hidden', position: 'relative',
    background: hue, boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.06)',
  }}>
    <div style={{ position: 'absolute', left: '45%', top: '28%', width: '30%', height: '55%',
      background: `radial-gradient(ellipse at 50% 20%, ${ch}, transparent 65%)`, filter: 'blur(2px)' }} />
    <div style={{ position: 'absolute', top: 0, left: '20%', width: 40, height: '55%',
      background: 'linear-gradient(180deg, rgba(255,240,200,0.35), transparent)', filter: 'blur(8px)', transform: 'rotate(-8deg)' }} />
    <div style={{ position: 'absolute', top: 8, right: 8, padding: '2px 6px', borderRadius: 4,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
      color: '#FFF', fontFamily: 'DM Sans, sans-serif' }}>VIDEO</div>
    {label && (
      <div style={{ position: 'absolute', bottom: 8, left: 8, padding: '3px 7px', borderRadius: 4,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', fontSize: 9,
        fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.85)' }}>{label}</div>
    )}
    {playing && (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#FFF' }}>▶</div>
      </div>
    )}
  </div>
);

const VTHUMBS = [
  { hue: 'radial-gradient(ellipse at 30% 20%, #F5C87A 0%, #8B5A2B 25%, #2a1808 60%, #0a0402 100%)', ch: '#C8A06E', label: 'CINEMA · 5S' },
  { hue: 'radial-gradient(ellipse at 50% 30%, #7A4A9E 0%, #3a1f55 40%, #120a24 80%, #050208 100%)', ch: '#B088D0', label: 'PORTRAIT · 3S' },
  { hue: 'radial-gradient(ellipse at 60% 40%, #D96E3A 0%, #8B2F2F 40%, #2a0808 80%, #080202 100%)', ch: '#E89070', label: 'ACTION · 6S' },
  { hue: 'radial-gradient(ellipse at 40% 25%, #5EA4D9 0%, #1f4a7a 40%, #081a2a 80%, #020408 100%)', ch: '#88C0E8', label: 'SCI-FI · 8S' },
  { hue: 'radial-gradient(ellipse at 50% 35%, #7AE0A8 0%, #2a7a55 40%, #082a1a 80%, #020806 100%)', ch: '#A8E8C4', label: 'NATURE · 4S' },
  { hue: 'radial-gradient(ellipse at 55% 30%, #C4A37A 0%, #6B4A2a 40%, #1f1208 80%, #0a0502 100%)', ch: '#D8BE8E', label: 'CINEMA · 10S' },
];

// ─── V1 · Split sidebar — dark solid right panel ──────────────────────────
function V_Video_V1() {
  return (
    <div style={{ width: '100%', height: '100%', background: BG, color: '#FFF',
      fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative' }}>
      <AmbientGlow />
      <Navbar />

      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Main — feed */}
        <div style={{ flex: 1, padding: '24px 28px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: RED,
                fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', textTransform: 'uppercase',
                marginBottom: 8, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 10px ${RED}` }} />
                Kling 3.0 · Frame to Video
              </div>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 44, letterSpacing: '0.01em', lineHeight: 0.95, color: '#FFF' }}>
                BRING IT TO LIFE
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 999, fontSize: 12, fontWeight: 500 }}>✦ Creations ▾</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 999, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Collections</div>
            </div>
          </div>

          {/* Generating hero + grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {/* Generating card */}
            <div style={{ gridColumn: 'span 1', aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden',
              background: 'linear-gradient(135deg,#2a0a0a,#6B1515)', position: 'relative',
              border: `1px solid ${RED}`, boxShadow: `0 0 30px rgba(224,30,30,0.35), 0 12px 36px rgba(0,0,0,0.5)` }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <div style={{ fontSize: 24, color: '#FFF' }}>✦</div>
                <div style={{ fontSize: 10, color: RED, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                  letterSpacing: '0.14em', textTransform: 'uppercase' }}>Generating · 97%</div>
                <div style={{ width: '70%', height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 999 }}>
                  <div style={{ height: '100%', width: '97%', background: RED, boxShadow: `0 0 10px ${RED}`, borderRadius: 999 }} />
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>Finalizing video…</div>
              </div>
            </div>
            {VTHUMBS.slice(0, 5).map((t, i) => (
              <VideoThumb key={i} hue={t.hue} ch={t.ch} label={t.label} aspect="16/9" />
            ))}
          </div>
        </div>

        {/* Right panel — TRANSPARENT GLASS (V2-style) */}
        <div style={{ width: 380,
          margin: '20px 20px 20px 0',
          borderRadius: 22,
          background: 'rgba(20,18,20,0.38)',
          backdropFilter: 'blur(36px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.12) inset, 0 0 60px rgba(224,30,30,0.08)',
          padding: '20px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14,
          overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 14,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>←</div>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Frame to Video</span>
          </div>

          {/* Mode toggle — big tiles with icons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: '18px 12px', borderRadius: 14,
              background: `linear-gradient(180deg, ${RED}, ${RED_DEEP})`, color: '#FFF',
              textAlign: 'center', fontSize: 13, fontWeight: 700, position: 'relative',
              border: `1px solid ${RED_HOT}`,
              boxShadow: `0 0 24px rgba(224,30,30,0.45), 0 1px 0 rgba(255,255,255,0.2) inset` }}>
              <div style={{ fontSize: 28, marginBottom: 6, lineHeight: 1, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}>🎞️</div>
              Start/End Frame
            </div>
            <div style={{ padding: '18px 12px', borderRadius: 14,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
              <div style={{ fontSize: 28, marginBottom: 6, lineHeight: 1 }}>📝</div>
              Text
            </div>
          </div>

          {/* Model row */}
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%',
              background: 'linear-gradient(135deg,#3a5edc,#1a2e8e)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 800, color: '#FFF' }}>K</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Model</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Kling 3.0</div>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16 }}>›</span>
          </div>

          {/* Start & end frame group — bordered container */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Set start & end frame</div>
            <div style={{ padding: 14, borderRadius: 14,
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', gap: 10, alignItems: 'center' }}>
              {/* Start uploader */}
              <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8, color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 500 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: RED,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, color: '#FFF', fontWeight: 300,
                  boxShadow: `0 0 14px rgba(224,30,30,0.45)` }}>+</div>
                <div>Add a start<br/>frame</div>
              </div>
              {/* Swap */}
              <div style={{ width: 30, height: 30, borderRadius: 8,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>⇄</div>
              {/* End uploader (dimmer) */}
              <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8, color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 500 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%',
                  background: 'rgba(139,15,15,0.45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, color: 'rgba(255,255,255,0.65)', fontWeight: 300 }}>+</div>
                <div>Add a end<br/>frame</div>
              </div>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Describe your video</span>
              <div style={{ width: 26, height: 26, borderRadius: 7,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>⚡</div>
            </div>
            <div style={{ padding: 14, borderRadius: 14,
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
              minHeight: 130, position: 'relative' }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.42)', lineHeight: 1.5 }}>
                Describe scene transitions, camera movement trajectories, or character actions with text to precisely control the entire video from beginning to end.
              </div>
              <div style={{ position: 'absolute', bottom: 12, left: 12, width: 28, height: 28, borderRadius: 7,
                background: 'rgba(224,30,30,0.18)', border: `1px solid rgba(224,30,30,0.55)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: RED, fontSize: 13 }}>⚡</div>
            </div>
          </div>

          {/* Camera motion — full width row */}
          <div style={{ padding: '12px 14px', borderRadius: 12,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500 }}>
            <span style={{ fontSize: 15 }}>🎥</span>
            <span>Camera Motion</span>
            <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.5)' }}>▾</span>
          </div>

          {/* Options grid — 4 chips */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            {[
              { n: 'Audio', v: 'Off', icon: '♪', toggle: true },
              { n: 'Res', v: '1080p', icon: '🖥' },
              { n: 'Duration', v: '5s', icon: '⏱' },
              { n: 'Ratio', v: '16:9', icon: '▭' },
            ].map((o, i) => (
              <div key={i} style={{ padding: '8px 10px', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
                  <span style={{ fontSize: 11 }}>{o.icon}</span>{o.n}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', marginTop: 2 }}>
                  {o.v}
                  {o.toggle && <span style={{ marginLeft: 'auto', width: 22, height: 12, borderRadius: 10,
                    background: 'rgba(255,255,255,0.18)', position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 1, top: 1, width: 10, height: 10, borderRadius: '50%', background: '#FFF' }} />
                  </span>}
                </div>
              </div>
            ))}
          </div>

          {/* Count + Generate */}
          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '0 10px', height: 36, display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.7)' }}>−</div>
              <div style={{ padding: '0 10px', height: 36, display: 'flex', alignItems: 'center',
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12, borderLeft: '1px solid rgba(255,255,255,0.1)',
                borderRight: '1px solid rgba(255,255,255,0.1)' }}>1 / 4</div>
              <div style={{ padding: '0 10px', height: 36, display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.7)' }}>+</div>
            </div>
            <div style={{ flex: 1, height: 36, borderRadius: 10,
              background: `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`, color: '#FFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'Anton, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase',
              fontSize: 13, fontWeight: 700,
              boxShadow: `0 0 28px ${RED}88, 0 4px 14px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset` }}>
              GENERATE →
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── V2 · Glass panel on right ────────────────────────────────────────────
function V_Video_V2() {
  return (
    <div style={{ width: '100%', height: '100%', background: BG, color: '#FFF',
      fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative' }}>
      <AmbientGlow />
      <Navbar />

      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', overflow: 'hidden', padding: '20px 28px', gap: 20 }}>
        {/* Main feed — bento-ish */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: RED,
                fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', textTransform: 'uppercase',
                marginBottom: 6, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 10px ${RED}` }} />
                Motion · Kling 3.0
              </div>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 42, letterSpacing: '0.01em', lineHeight: 0.95 }}>
                VIDEO WITHOUT LIMITS
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['All', 'Mine', 'Saved'].map((n, i) => (
                <div key={n} style={{ padding: '7px 14px', fontSize: 12, fontWeight: 500, borderRadius: 999,
                  background: i === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${i === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
                  color: i === 0 ? '#FFF' : 'rgba(255,255,255,0.6)' }}>{n}</div>
              ))}
            </div>
          </div>

          {/* Bento */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gridTemplateRows: '1fr 1fr',
            gap: 12, flex: 1, minHeight: 0 }}>
            {/* Hero generating */}
            <div style={{ gridRow: 'span 2', borderRadius: 16, overflow: 'hidden', position: 'relative',
              background: 'radial-gradient(ellipse at 40% 40%, #6B1515 0%, #2a0a0a 50%, #050202 100%)',
              border: `1px solid ${RED}`, boxShadow: `0 0 40px rgba(224,30,30,0.3), 0 20px 50px rgba(0,0,0,0.6)` }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <div style={{ fontSize: 40, color: RED_HOT, filter: `drop-shadow(0 0 20px ${RED})` }}>✦</div>
                <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 28, letterSpacing: '0.04em' }}>GENERATING</div>
                <div style={{ fontSize: 11, color: RED, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                  letterSpacing: '0.14em' }}>97% · FINALIZING</div>
                <div style={{ width: '60%', height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 999 }}>
                  <div style={{ height: '100%', width: '97%', background: RED, boxShadow: `0 0 10px ${RED}`, borderRadius: 999 }} />
                </div>
              </div>
              <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14,
                padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(14px)',
                fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>
                “A lone astronaut walks across a crater under a blood-red sky…”
              </div>
            </div>
            {VTHUMBS.slice(0, 4).map((t, i) => (
              <VideoThumb key={i} hue={t.hue} ch={t.ch} label={t.label} aspect="16/10" playing={i === 0} />
            ))}
          </div>
        </div>

        {/* Right glass panel */}
        <div style={{ width: 360, borderRadius: 22,
          background: 'rgba(20,18,20,0.38)',
          backdropFilter: 'blur(36px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.12) inset, 0 0 60px rgba(224,30,30,0.08)',
          padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: RED, fontFamily: 'JetBrains Mono, monospace' }}>Compose</div>

          {/* Mode pill segmented */}
          <div style={{ display: 'flex', padding: 4, borderRadius: 999,
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ flex: 1, padding: '8px 0', textAlign: 'center', fontSize: 12, fontWeight: 600,
              borderRadius: 999, background: RED, color: '#FFF',
              boxShadow: `0 0 16px rgba(224,30,30,0.45)` }}>Frame → Video</div>
            <div style={{ flex: 1, padding: '8px 0', textAlign: 'center', fontSize: 12, fontWeight: 500,
              color: 'rgba(255,255,255,0.6)' }}>Text → Video</div>
          </div>

          {/* Model pill with avatar */}
          <div style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg,#3a5edc,#1a2e8e)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>K</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Model</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Kling 3.0</div>
            </div>
            <div style={{ padding: '3px 7px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: 'rgba(224,30,30,0.2)', border: `1px solid ${RED}`, color: RED,
              letterSpacing: '0.08em' }}>PRO</div>
            <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>▾</span>
          </div>

          {/* Frame picker — side-by-side cards */}
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase',
              letterSpacing: '0.1em', marginBottom: 8 }}>Start / End Frame</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
              <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10,
                background: 'radial-gradient(ellipse at 40% 40%, #F5C87A 0%, #6B4A26 40%, #1a1008 100%)',
                position: 'relative' }}>
                <div style={{ position: 'absolute', top: 6, left: 6, padding: '2px 6px', borderRadius: 4,
                  background: 'rgba(0,0,0,0.6)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>START</div>
              </div>
              <div style={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: RED,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 0 16px ${RED}88` }}>⇄</div>
              </div>
              <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                gap: 4 }}>
                <div style={{ fontSize: 20, color: RED }}>+</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>End frame</div>
              </div>
            </div>
          </div>

          {/* Prompt */}
          <div style={{ padding: 14, borderRadius: 14, background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.07)', minHeight: 100 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>Describe your video</span>
              <span style={{ color: RED }}>✦</span>
            </div>
            <div style={{ fontSize: 14, color: '#FFF' }}>the character is walking through the alley
              <span style={{ borderRight: `1.5px solid ${RED}`, marginLeft: 1 }}>&nbsp;</span>
            </div>
          </div>

          {/* Chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { n: '◎ Camera Motion', emph: true },
              { n: '♪ Audio · Off' },
              { n: '▦ 1080p' },
              { n: '◷ 5s' },
              { n: '▭ 16:9' },
            ].map((c, i) => (
              <div key={i} style={{ padding: '6px 10px', borderRadius: 999, fontSize: 11,
                background: c.emph ? 'rgba(224,30,30,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${c.emph ? 'rgba(224,30,30,0.4)' : 'rgba(255,255,255,0.09)'}`,
                color: c.emph ? '#FFD0D0' : '#FFF' }}>{c.n}</div>
            ))}
          </div>

          {/* CTA */}
          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            <div style={{ width: 84, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 8px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>−</span>
              <span>1 / 4</span>
              <span style={{ color: 'rgba(255,255,255,0.6)' }}>+</span>
            </div>
            <div style={{ flex: 1, height: 40, borderRadius: 10,
              background: `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`, color: '#FFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'Anton, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase',
              fontSize: 14, fontWeight: 700,
              boxShadow: `0 0 28px ${RED}88, 0 6px 20px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset` }}>
              GENERATE →
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── V3 · Cinematic preview stage — big player left, controls right ─────
function V_Video_V3() {
  return (
    <div style={{ width: '100%', height: '100%', background: BG, color: '#FFF',
      fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative' }}>
      <AmbientGlow />
      <Navbar />

      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', overflow: 'hidden',
        padding: '20px 28px', gap: 20 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
          {/* Big preview */}
          <div style={{ flex: 1, borderRadius: 18, overflow: 'hidden', position: 'relative',
            background: 'radial-gradient(ellipse at 30% 40%, #8B5A2B 0%, #2a1808 45%, #050202 100%)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {/* Silhouette */}
            <div style={{ position: 'absolute', left: '48%', top: '25%', width: 140, height: 320,
              background: 'radial-gradient(ellipse at 50% 20%, #C8A06E, transparent 60%)', filter: 'blur(3px)' }} />
            {/* Light beam */}
            <div style={{ position: 'absolute', top: 0, left: '30%', width: 60, height: '70%',
              background: 'linear-gradient(180deg, rgba(255,240,200,0.4), transparent)', filter: 'blur(10px)',
              transform: 'rotate(-8deg)' }} />
            {/* Generating overlay */}
            <div style={{ position: 'absolute', top: 18, left: 18, padding: '6px 12px', borderRadius: 999,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(20px)', border: `1px solid ${RED}`,
              fontSize: 10.5, color: RED, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 8px ${RED}` }} />
              Rendering · 97%
            </div>
            {/* Timeline */}
            <div style={{ position: 'absolute', bottom: 18, left: 18, right: 18 }}>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 999, position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '97%',
                  background: `linear-gradient(90deg, ${RED_DEEP}, ${RED_HOT})`, borderRadius: 999,
                  boxShadow: `0 0 10px ${RED}` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8,
                fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.6)' }}>
                <span>00:00</span><span>00:04.8 / 00:05.0</span>
              </div>
            </div>
          </div>

          {/* Recent strip */}
          <div style={{ display: 'flex', gap: 10, height: 120 }}>
            {VTHUMBS.slice(0, 6).map((t, i) => (
              <div key={i} style={{ flex: 1, borderRadius: 10, overflow: 'hidden', position: 'relative',
                background: t.hue, border: i === 0 ? `1px solid ${RED}` : '1px solid rgba(255,255,255,0.06)',
                boxShadow: i === 0 ? `0 0 18px rgba(224,30,30,0.3)` : '0 6px 18px rgba(0,0,0,0.4)' }}>
                <div style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 9,
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em',
                  color: 'rgba(255,255,255,0.85)' }}>{t.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — tall glass card */}
        <div style={{ width: 340, borderRadius: 20,
          background: 'rgba(18,14,14,0.55)', backdropFilter: 'blur(30px) saturate(1.3)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
          padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 22, letterSpacing: '0.04em' }}>COMPOSE</div>
            <div style={{ fontSize: 10, color: RED, fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.1em', fontWeight: 700 }}>KLING 3.0</div>
          </div>

          {/* Frame / Text tabs */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { n: 'Frame', icon: '▦', active: true },
              { n: 'Text', icon: 'T' },
              { n: 'Extend', icon: '⇥' },
            ].map((t, i) => (
              <div key={i} style={{ flex: 1, padding: '10px 6px', borderRadius: 12, textAlign: 'center',
                background: t.active ? RED : 'rgba(255,255,255,0.04)',
                border: t.active ? 'none' : '1px solid rgba(255,255,255,0.08)',
                fontSize: 11, fontWeight: 600, color: t.active ? '#FFF' : 'rgba(255,255,255,0.6)',
                boxShadow: t.active ? `0 0 16px rgba(224,30,30,0.4)` : 'none' }}>
                <div style={{ fontSize: 14, marginBottom: 2 }}>{t.icon}</div>{t.n}
              </div>
            ))}
          </div>

          {/* Frame row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10,
              background: 'radial-gradient(ellipse at 40% 40%, #F5C87A 0%, #6B4A26 40%, #1a1008 100%)' }} />
            <div style={{ fontSize: 20, color: RED }}>→</div>
            <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10,
              background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: RED, fontSize: 22 }}>+</div>
          </div>

          {/* Prompt */}
          <div style={{ padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.07)', minHeight: 80 }}>
            <div style={{ fontSize: 14, color: '#FFF' }}>the character is walking<span style={{ borderRight: `1.5px solid ${RED}`, marginLeft: 1 }}>&nbsp;</span></div>
          </div>

          {/* Inline options — list rows */}
          {[
            { n: 'Motion', v: 'Slow push-in', icon: '◎' },
            { n: 'Audio', v: 'Off', icon: '♪' },
            { n: 'Resolution', v: '1080p · HD', icon: '▦' },
            { n: 'Duration', v: '5s', icon: '◷' },
            { n: 'Aspect', v: '16:9', icon: '▭' },
          ].map((o, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 10,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', width: 18, textAlign: 'center' }}>{o.icon}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{o.n}</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{o.v}</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>›</span>
            </div>
          ))}

          <div style={{ marginTop: 'auto' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)',
              fontFamily: 'JetBrains Mono, monospace', marginBottom: 8, textAlign: 'center' }}>COST · 400 ✦ / VIDEO</div>
            <div style={{ height: 44, borderRadius: 12,
              background: `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`, color: '#FFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'Anton, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase',
              fontSize: 15, fontWeight: 700,
              boxShadow: `0 0 30px ${RED}88, 0 8px 22px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset` }}>
              GENERATE VIDEO →
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── V4 · Streaming-style rows + floating glass side sheet ──────────────
function V_Video_V4() {
  const rows = [
    { cat: 'Your Creations', items: VTHUMBS.slice(0, 5) },
    { cat: 'Community · Trending', items: [VTHUMBS[2], VTHUMBS[3], VTHUMBS[4], VTHUMBS[5], VTHUMBS[0]] },
    { cat: 'Cinematic', items: [VTHUMBS[5], VTHUMBS[0], VTHUMBS[4], VTHUMBS[2], VTHUMBS[1]] },
  ];
  return (
    <div style={{ width: '100%', height: '100%', background: BG, color: '#FFF',
      fontFamily: 'DM Sans, Inter, sans-serif', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative' }}>
      <AmbientGlow />
      <Navbar />

      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Feed */}
        <div style={{ flex: 1, padding: '20px 28px 20px', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: RED,
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', textTransform: 'uppercase',
              marginBottom: 6, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: RED, boxShadow: `0 0 10px ${RED}` }} />
              Motion Library
            </div>
            <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 40, lineHeight: 0.95 }}>MOVE EVERY FRAME</div>
          </div>

          {rows.map((r, ri) => (
            <div key={ri}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{r.cat}</div>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>View all ›</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {r.items.map((t, i) => (
                  <VideoThumb key={i} hue={t.hue} ch={t.ch} label={t.label} aspect="16/9" playing={ri === 0 && i === 0} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Floating side sheet — glass */}
        <div style={{
          position: 'absolute', right: 24, top: 84, bottom: 24, width: 360,
          borderRadius: 22,
          background: 'rgba(18,14,14,0.5)',
          backdropFilter: 'blur(40px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 40px 100px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.12) inset, 0 0 80px rgba(224,30,30,0.08)',
          padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto',
          zIndex: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: RED, boxShadow: `0 0 10px ${RED}` }} />
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>NEW VIDEO</div>
            <div style={{ marginLeft: 'auto', fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>×</div>
          </div>

          {/* Model — prominent */}
          <div style={{ padding: 14, borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(224,30,30,0.2), rgba(139,15,15,0.08))',
            border: '1px solid rgba(224,30,30,0.35)',
            display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg,#3a5edc,#1a2e8e)`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>K</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,200,200,0.7)', letterSpacing: '0.08em',
                textTransform: 'uppercase' }}>Model · Flagship</div>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 20, letterSpacing: '0.04em', color: '#FFF' }}>KLING 3.0</div>
            </div>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(0,0,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</div>
          </div>

          {/* Mode */}
          <div style={{ display: 'flex', padding: 4, borderRadius: 999,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)' }}>
            {[
              { n: 'Frame', active: true }, { n: 'Text' }, { n: 'Ref' },
            ].map((t, i) => (
              <div key={i} style={{ flex: 1, padding: '7px 0', textAlign: 'center', fontSize: 11, fontWeight: 600,
                borderRadius: 999,
                background: t.active ? RED : 'transparent',
                color: t.active ? '#FFF' : 'rgba(255,255,255,0.55)' }}>{t.n}</div>
            ))}
          </div>

          {/* Frames */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10,
              background: 'radial-gradient(ellipse at 40% 40%, #F5C87A 0%, #6B4A26 40%, #1a1008 100%)',
              position: 'relative' }}>
              <div style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 700,
                letterSpacing: '0.08em', padding: '2px 6px', background: 'rgba(0,0,0,0.6)', borderRadius: 4 }}>START</div>
            </div>
            <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 10, border: '1px dashed rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.02)', fontSize: 20, color: RED }}>+</div>
          </div>

          {/* Prompt */}
          <div style={{ padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.07)', minHeight: 70 }}>
            <div style={{ fontSize: 13, color: '#FFF' }}>the character is walking toward the camera</div>
          </div>

          {/* Chips — wrapped */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['◎ Slow push-in', '♪ Audio On', '▦ 1080p', '◷ 5s', '▭ 16:9', '⚑ Negative'].map((c, i) => (
              <div key={i} style={{ padding: '6px 10px', borderRadius: 999, fontSize: 11,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>{c}</div>
            ))}
          </div>

          {/* Footer CTA */}
          <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
            <div style={{ width: 80, height: 44, borderRadius: 12,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>−</span><span>1/4</span>
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>+</span>
            </div>
            <div style={{ flex: 1, height: 44, borderRadius: 12,
              background: `linear-gradient(180deg, ${RED_HOT}, ${RED_DEEP})`, color: '#FFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'Anton, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase',
              fontSize: 14, fontWeight: 700,
              boxShadow: `0 0 28px ${RED}88, 0 8px 22px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset` }}>
              GENERATE →
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.V_Video_V1 = V_Video_V1;
window.V_Video_V2 = V_Video_V2;
window.V_Video_V3 = V_Video_V3;
window.V_Video_V4 = V_Video_V4;
})();
