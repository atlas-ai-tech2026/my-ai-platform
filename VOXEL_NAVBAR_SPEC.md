# Voxel Navbar — Global Credit Button Spec

**Goal:** Replace the existing credit display logic (or lack of it) in `src/components/navigation/Navbar.jsx` with a **circular credit button** that shows a popover on click. This navbar is shared across every page, so the change applies globally automatically.

---

## Brand tokens

```js
const red     = '#E01E1E';
const redHot  = '#FF2A2A';
const redDeep = '#8B0F0F';
```

Fonts already loaded in the app: **Anton**, **DM Sans**, **JetBrains Mono**.

---

## File to edit

`src/components/navigation/Navbar.jsx`

Keep everything currently in the file — logo, primaryNavItems, secondaryNavItems, mobile menu, auth modal wiring, scroll behavior. **Only add the new Credit Button** and place it in the right-side action area next to Login / Sign Up.

---

## New component — add at the top of the file (below imports)

```jsx
import { useState, useRef, useEffect } from 'react';

// ─── Credit Button ──────────────────────────────────────────────────────────
// Click to open popover with total credit, usage bar, renewal, and upgrade CTA.
// Props: credits (number used OR remaining — pick one and stay consistent),
//        total  (plan total), renewsOn (string e.g. "May 15, 2026"),
//        plan   (string e.g. "PRO" | "FREE" | "TEAM")
function CreditButton({ credits = 40000, total = 50000, renewsOn = 'May 15, 2026', plan = 'PRO' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // remaining = credits  (interpret prop as "remaining"; adjust if your backend sends "used")
  const remaining = credits;
  const used = Math.max(0, total - remaining);
  const pctRemaining = Math.min(1, Math.max(0, remaining / total));

  // Close on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const red = '#E01E1E';
  const redHot = '#FF2A2A';
  const C = 17;                         // circle radius
  const CIRC = 2 * Math.PI * C;         // circumference
  // Ring shows how much is USED (fills clockwise as you use credits)
  const dashOffset = CIRC * pctRemaining;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* ─── Circle button ─── */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Credits"
        style={{
          width: 40, height: 40, borderRadius: '50%',
          background: open ? 'rgba(224,30,30,0.18)' : 'rgba(224,30,30,0.12)',
          border: `1.5px solid ${red}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', position: 'relative',
          boxShadow: open
            ? `0 0 24px rgba(224,30,30,0.55)`
            : `0 0 18px rgba(224,30,30,0.35)`,
          padding: 0,
          transition: 'box-shadow 0.2s, background 0.2s',
        }}
      >
        <svg
          width="40" height="40" viewBox="0 0 40 40"
          style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
        >
          <circle cx="20" cy="20" r={C} fill="none" stroke="rgba(224,30,30,0.15)" strokeWidth="2" />
          <circle
            cx="20" cy="20" r={C} fill="none" stroke={red} strokeWidth="2"
            strokeDasharray={CIRC}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </svg>
        <span style={{ color: red, fontSize: 14, zIndex: 1, lineHeight: 1 }}>✦</span>
      </button>

      {/* ─── Popover ─── */}
      {open && (
        <div
          style={{
            position: 'absolute', top: 50, right: 0, width: 300,
            background: 'rgba(15,8,8,0.96)',
            backdropFilter: 'blur(40px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
            border: '1px solid rgba(224,30,30,0.25)',
            borderRadius: 16,
            boxShadow: '0 24px 70px rgba(0,0,0,0.7), 0 0 40px rgba(224,30,30,0.2)',
            padding: 20,
            zIndex: 100,
            animation: 'credPop 0.2s ease-out',
          }}
        >
          <style>{`
            @keyframes credPop {
              from { opacity: 0; transform: translateY(-6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {/* Header: big credit number + plan badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{
                fontSize: 10.5, color: red, fontFamily: '"JetBrains Mono", monospace',
                letterSpacing: '0.14em', textTransform: 'uppercase',
                marginBottom: 6, fontWeight: 600,
              }}>
                ✦ CREDITS
              </div>
              <div style={{
                fontFamily: 'Anton, sans-serif',
                fontSize: 38, color: '#FFF',
                letterSpacing: '0.01em', lineHeight: 1,
              }}>
                {remaining.toLocaleString()}
              </div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginTop: 5 }}>
                of {total.toLocaleString()} total
              </div>
            </div>
            <div style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 9.5, fontWeight: 700,
              background: 'rgba(224,30,30,0.15)',
              border: `1px solid ${red}`, color: red,
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>{plan}</div>
          </div>

          {/* Usage bar */}
          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%',
              width: `${pctRemaining * 100}%`,
              background: `linear-gradient(90deg, ${redHot}, ${red})`,
              borderRadius: 999,
              boxShadow: `0 0 12px ${red}`,
            }} />
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 10.5, fontFamily: '"JetBrains Mono", monospace',
            color: 'rgba(255,255,255,0.5)', marginBottom: 18,
          }}>
            <span>{used.toLocaleString()} used</span>
            <span>{Math.round(pctRemaining * 100)}% remaining</span>
          </div>

          {/* Renews row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '11px 13px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10, marginBottom: 14,
          }}>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>Renews on</span>
            <span style={{ fontSize: 11.5, color: '#FFF', fontFamily: '"JetBrains Mono", monospace' }}>
              {renewsOn}
            </span>
          </div>

          {/* Upgrade button → navigates to /pricing */}
          <Link
            to={createPageUrl('Pricing')}
            onClick={() => setOpen(false)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', height: 42, borderRadius: 10,
              background: `linear-gradient(180deg, ${redHot}, #8B0F0F)`,
              color: '#FFF', fontSize: 13, fontWeight: 700,
              fontFamily: 'Anton, sans-serif',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              textDecoration: 'none',
              boxShadow: '0 0 24px rgba(224,30,30,0.5), 0 6px 16px rgba(139,15,15,0.5), 0 1px 0 rgba(255,255,255,0.25) inset',
            }}
          >
            <span>Upgrade</span>
            <span>→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
```

---

## Where to place the CreditButton

Find this block in `Navbar.jsx`:

```jsx
{/* Auth Buttons */}
<div className="hidden lg:flex items-center gap-3">
  <Button variant="ghost" ...>Login</Button>
  <Button className="bg-primary ...">Sign Up →</Button>
</div>
```

**Replace it with:**

```jsx
{/* Auth Buttons + Credit */}
<div className="hidden lg:flex items-center gap-3">
  <Button variant="ghost" className="text-foreground-secondary hover:text-white" onClick={() => setAuthModal('login')}>
    Login
  </Button>
  <Button className="bg-primary hover:bg-primary-hover text-white" onClick={() => setAuthModal('signup')}>
    Sign Up →
  </Button>
  <CreditButton credits={40000} total={50000} renewsOn="May 15, 2026" plan="PRO" />
</div>
```

> **Hook up real data later.** For now the props are hardcoded. When you wire up billing, pass real values (e.g. from a `useUser()` hook or context) — the component already handles any numbers you give it.

---

## Mobile placement (optional but recommended)

In the mobile menu block, add the credit button right before the Login/Sign Up row:

Find:
```jsx
<div className="h-px bg-border my-2" />

<div className="flex gap-2 pt-2">
  <Button variant="outline" ...>Login</Button>
  <Button ...>Sign Up</Button>
</div>
```

**Insert above it:**
```jsx
<div className="flex items-center justify-between px-4 py-3 rounded-lg" style={{
  background: 'rgba(224,30,30,0.08)', border: '1px solid rgba(224,30,30,0.2)',
}}>
  <div>
    <div style={{ fontSize: 10, color: '#E01E1E', fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }}>
      ✦ Credits
    </div>
    <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 22, color: '#FFF', lineHeight: 1, marginTop: 2 }}>
      40,000 <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: '"DM Sans", sans-serif' }}>/ 50,000</span>
    </div>
  </div>
  <Link
    to={createPageUrl('Pricing')}
    onClick={() => setMobileOpen(false)}
    style={{
      padding: '8px 16px', borderRadius: 8,
      background: 'linear-gradient(180deg, #FF2A2A, #8B0F0F)',
      color: '#FFF', fontSize: 11, fontWeight: 700,
      fontFamily: 'Anton, sans-serif', letterSpacing: '0.08em',
      textTransform: 'uppercase', textDecoration: 'none',
    }}
  >
    Upgrade
  </Link>
</div>
```

---

## What NOT to change

- `primaryNavItems`, `secondaryNavItems` arrays
- `isActive` logic
- Scroll listener / `scrolled` state
- `authModal` state + `LoginModal` rendering
- `VoxelLogo` import
- Active underline animation on primary links
- Mobile menu toggle
- Container widths, background `rgba(10, 10, 10, 0.92)`, `backdrop-filter: blur(12px)`

---

## Summary

1. Add `CreditButton` component at the top of `Navbar.jsx` (below imports)
2. Drop `<CreditButton … />` after the Sign Up button in the desktop auth row
3. Add the mobile credit summary block in the mobile menu
4. Done. Every page in the app that uses `<Layout>` automatically gets it.
