import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import VoxelLogo from '../VoxelLogo';
import { Menu, X, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

// ─── Credit Button ──────────────────────────────────────────────────────────
// Dark circle body + red progress ring around it + red ✦ glyph inside.
// Reads the live balance off the AuthContext user object. We deliberately
// do NOT show a "X of N total" or "renews on" line — there is no credit
// cap or renewal date in the schema yet (no packages table, no Stripe).
// The ring is full when balance > 0, empty at zero — once a real cap
// exists, replace `pctRemaining` with `balance / cap`.
function CreditButton({ user }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Postgres NUMERIC arrives as a string ("0.00", "20.00"); coerce.
  const balance = Number(user?.credits || 0);
  const remaining = Math.floor(balance);
  const pkg = user?.package || 'Free';
  const pctRemaining = balance > 0 ? 1 : 0;

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const red = '#E01E1E';
  const redHot = '#FF2A2A';
  const C = 22;
  const CIRC = 2 * Math.PI * C;
  const dashOffset = CIRC * (1 - pctRemaining);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Credits"
        style={{
          width: 48, height: 48, padding: 0,
          background: 'transparent', border: 'none',
          cursor: 'pointer', position: 'relative',
          transition: 'transform 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {/* SVG #1 — full 360° faded red track (always visible) */}
        <svg
          width="48" height="48" viewBox="0 0 48 48"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <circle
            cx="24" cy="24" r={C}
            fill="none"
            stroke="rgba(224,30,30,0.35)"
            strokeWidth="1.5"
          />
        </svg>

        {/* SVG #2 — depleting bright red arc (rotated -90°) */}
        <svg
          width="48" height="48" viewBox="0 0 48 48"
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            transform: 'rotate(-90deg)',
          }}
        >
          <circle
            cx="24" cy="24" r={C}
            fill="none"
            stroke={red}
            strokeWidth="2"
            strokeDasharray={CIRC}
            strokeDashoffset={dashOffset}
            style={{
              filter: `drop-shadow(0 0 4px ${red})`,
              transition: 'stroke-dashoffset 0.6s ease',
            }}
          />
        </svg>

        {/* Inner 40×40 disc — DARK with subtle red tint, NO border */}
        <div style={{
          position: 'absolute', top: 4, left: 4,
          width: 40, height: 40, borderRadius: '50%',
          background: open
            ? 'radial-gradient(circle at 50% 45%, rgba(224,30,30,0.35), rgba(20,8,8,0.95))'
            : 'radial-gradient(circle at 50% 45%, rgba(224,30,30,0.22), rgba(15,8,8,0.95))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: open
            ? '0 0 18px rgba(224,30,30,0.5)'
            : '0 0 12px rgba(224,30,30,0.3)',
          transition: 'box-shadow 0.2s, background 0.2s',
        }}>
          <span style={{
            color: red, fontSize: 15, lineHeight: 1,
            filter: `drop-shadow(0 0 4px ${red})`,
          }}>✦</span>
        </div>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 58, right: 0, width: 300,
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
                {remaining === 0 ? 'No credits left' : 'available to spend'}
              </div>
            </div>
            <div style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 9.5, fontWeight: 700,
              background: 'rgba(224,30,30,0.15)',
              border: `1px solid ${red}`, color: red,
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>{pkg}</div>
          </div>

          {/* Signed-in identity row — replaces the old "Renews on" line.
              Tells the user which account they're logged in with so they
              don't accidentally top up the wrong inbox. The email truncates
              with ellipsis so long addresses don't blow out the popover. */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 10, padding: '11px 13px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10, marginBottom: 14,
          }}>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
              Signed in as
            </span>
            <span
              style={{
                fontSize: 11.5, color: '#FFF',
                fontFamily: '"JetBrains Mono", monospace',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={user?.email || ''}
            >
              {user?.email || '—'}
            </span>
          </div>

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

const primaryNavItems = [
  { name: 'Explore', path: 'Explore' },
  { name: 'Image', path: 'Image' },
  { name: 'Video', path: 'Video' },
  { name: 'Audio', path: 'Audio' },
  { name: 'Studio', path: 'Studio', badge: 'New' },
  { name: 'Edit', path: 'Edit', badge: 'Coming Soon' },
];

const secondaryNavItems = [
  { name: 'Apps', path: 'Apps' },
  { name: 'Community', path: 'Community' },
  { name: 'Pricing', path: 'Pricing' },
];

// Compact "you're signed in" pill: shows the local-part of the email and a
// log-out icon. Replaces the Login + Sign Up buttons once the user is
// authenticated so signups produce visible feedback (the previous version
// always rendered the login buttons, which made successful signups feel
// like nothing happened).
function UserPill({ email, onLogout }) {
  const localPart = (email || '').split('@')[0] || 'account';
  return (
    <div className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full border border-border bg-background-secondary">
      <span className="text-sm font-medium text-white truncate max-w-[140px]" title={email}>
        {localPart}
      </span>
      <button
        type="button"
        onClick={onLogout}
        className="p-1 rounded-full hover:bg-muted text-foreground-muted hover:text-white transition-colors"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}

export default function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, isAuthenticated, openAuthModal, logout } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (path) => {
    const currentPath = location.pathname;
    if (path === 'Explore') return currentPath === '/';
    return currentPath === `/${path.toLowerCase()}`;
  };

  return (
    <>
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-b border-border' : ''
      }`}
      style={{
        background: 'rgba(10, 10, 10, 0.92)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to={createPageUrl('Explore')} className="flex-shrink-0">
            <VoxelLogo size="default" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-1">
            {/* Primary Nav */}
            {primaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                className={`relative px-4 py-2 text-sm font-medium transition-colors group ${
                  isActive(item.path) 
                    ? 'text-white' 
                    : 'text-foreground-secondary hover:text-white'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {item.name}
                  {item.badge && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-primary text-white rounded-full">
                      {item.badge}
                    </span>
                  )}
                </span>
                {/* Active underline */}
                <span 
                  className={`absolute bottom-0 left-4 right-4 h-0.5 bg-primary transform origin-left transition-transform duration-300 ${
                    isActive(item.path) ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                  }`}
                />
              </Link>
            ))}

            {/* Divider */}
            <div className="w-px h-6 bg-border mx-2" />

            {/* Secondary Nav */}
            {secondaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  isActive(item.path) 
                    ? 'text-white' 
                    : 'text-foreground-muted hover:text-foreground-secondary'
                }`}
              >
                {item.name}
              </Link>
            ))}
          </div>

          {/* Auth Buttons + Credit */}
          <div className="hidden lg:flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <UserPill email={user?.email} onLogout={logout} />
                <CreditButton user={user} />
              </>
            ) : (
              <>
                <Button variant="ghost" className="text-foreground-secondary hover:text-white" onClick={() => openAuthModal('login')}>
                  Login
                </Button>
                <Button className="bg-primary hover:bg-primary-hover text-white" onClick={() => openAuthModal('signup')}>
                  Sign Up →
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden p-2 text-foreground-secondary hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border">
          <div className="px-4 py-4 space-y-1 bg-background-secondary">
            {primaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.path) 
                    ? 'bg-primary/10 text-white border border-primary/20' 
                    : 'text-foreground-secondary hover:bg-muted hover:text-white'
                }`}
              >
                {item.name}
                {item.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-primary text-white rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
            
            <div className="h-px bg-border my-2" />
            
            {secondaryNavItems.map((item) => (
              <Link
                key={item.name}
                to={createPageUrl(item.path)}
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-3 text-sm font-medium text-foreground-muted hover:text-white transition-colors"
              >
                {item.name}
              </Link>
            ))}
            
            <div className="h-px bg-border my-2" />
            
            {isAuthenticated ? (
              <div className="flex items-center justify-between gap-2 pt-2 px-2">
                <UserPill email={user?.email} onLogout={() => { setMobileOpen(false); logout(); }} />
              </div>
            ) : (
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 border-border text-white" onClick={() => { setMobileOpen(false); openAuthModal('login'); }}>
                  Login
                </Button>
                <Button className="flex-1 bg-primary hover:bg-primary-hover text-white" onClick={() => { setMobileOpen(false); openAuthModal('signup'); }}>
                  Sign Up
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
    </>
  );
}
