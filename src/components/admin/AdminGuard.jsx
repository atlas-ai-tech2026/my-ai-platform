// ─── AdminGuard ──────────────────────────────────────────────────────────────
//
// Wraps the admin panel route. Three responsibilities:
//
//   1. If no token, render an inline login form (admin emails only — server
//      enforces role; we let any user attempt login but redirect non-admins).
//   2. If logged in but not role='admin', redirect to "/".
//   3. Once mounted with an admin token: idle-redirect after 15 min of
//      inactivity (mouse/keyboard) — pure UX defense, real security comes
//      from the server's 30-min admin JWT expiry.

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi, ApiError } from '@/lib/adminApi';
import { CrmThemeProvider, ThemeToggle } from './crmTheme';

const IDLE_MS = 15 * 60 * 1000;

export default function AdminGuard({ children }) {
  const navigate = useNavigate();
  // N3: the session is an httpOnly cookie this code cannot read, so identity
  // comes from the SERVER. `undefined` = still asking, `null` = signed out.
  const [user, setUser] = useState(undefined);
  const [checking, setChecking] = useState(false);

  // Re-decode the stored token on mount in case it expired.
  useEffect(() => {
    let cancelled = false;
    adminApi.me()
      .then((r) => { if (!cancelled) setUser(r?.user ?? r ?? null); })
      .catch(() => { if (!cancelled) setUser(null); });
    return () => { cancelled = true; };
  }, []);

  // Logged in as a non-admin → bounce to home so they don't even see the URL exists.
  useEffect(() => {
    if (user && user.role !== 'admin') {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  // Idle redirect (frontend-only; not a security boundary).
  const logout = useCallback(() => {
    adminApi.logout().catch(() => {});
    setUser(null);
    navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    let timer = setTimeout(logout, IDLE_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(logout, IDLE_MS); };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [user, logout]);

  // Logged in + admin → render the panel.
  if (user && user.role === 'admin') {
    return (
      <CrmThemeProvider>
        {children}
        {/* One cluster. The theme toggle used to live in AdminPanel's header
            while this button was position:fixed at the same corner — they
            overlapped each other. Keeping both here makes that impossible.

            ── AND IT MUST NOT BE position:fixed ────────────────────────────
            Fixed, it stayed at top-right while the page scrolled underneath —
            landing exactly on the FINE / ACT NOW / THIS WEEK labels at the
            right edge of every SOP row. On a status screen those labels ARE
            the information, so this covered the one thing the page exists to
            say. Worse, the background was var(--crm-w06) — six percent white —
            so the row's text showed straight through the button and the two
            were unreadable together.

            `absolute` resolves against the initial containing block here, so
            the cluster sits at the top of the DOCUMENT and scrolls away with
            everything else. Reported by Amr on 2026-09-02 from the production
            panel; visible in every screenshot of the SOP tab once scrolled.

            The background is opaque for the same reason: a control that
            overlaps content, even for the moment before it scrolls off, must
            hide what is under it rather than blend with it. */}
        <div style={{
          position: 'absolute', top: 16, right: 16, zIndex: 1000,
          display: 'flex', gap: 8, alignItems: 'center',
          background: 'var(--crm-page)', padding: 4, borderRadius: 10,
        }}>
          <ThemeToggle />
          <button
            onClick={logout}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              // Opaque: this sits over content until it scrolls away, and a
              // translucent button on top of a row makes both unreadable.
              background: 'var(--crm-surface)',
              border: '1px solid var(--crm-w12)',
              borderRadius: 8, color: 'var(--crm-w80)', cursor: 'pointer',
              fontFamily: '"DM Sans", sans-serif',
            }}
          >Sign out</button>
        </div>
      </CrmThemeProvider>
    );
  }

  // Not logged in → inline login form. We don't render a hint that this is the
  // "admin panel" — just a generic "sign in" form. Anyone sniffing the URL
  // shouldn't be able to confirm by looking at the page that it's privileged.
  // The provider DEFINES the --crm-* variables the styles below read. It must
  // wrap the login form too — that was the (real) half of the first diagnosis.
  return (
    <CrmThemeProvider>
      <InlineLogin checking={checking} setChecking={setChecking} onLogin={(u) => setUser(u)} />
    </CrmThemeProvider>
  );
}

function InlineLogin({ checking, setChecking, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setChecking(true);
    try {
      const r = await adminApi.login(email.trim().toLowerCase(), password);
      // N3: the token in this response is deliberately NOT stored — for an
      // admin the server also set the httpOnly cookie, which is the session.
      const decoded = r?.user ?? null;
      if (!decoded || decoded.role !== 'admin') {
        // Successful login but not an admin → drop the token and tell them
        // generically that they don't have access. Don't leak whether the
        // role check vs the credentials failed.
        adminApi.logout().catch(() => {});
        setErr('Sign-in successful but this account does not have access.');
        return;
      }
      onLogin(decoded);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setErr('Too many attempts. Try again later.');
      } else {
        setErr('Invalid email or password.');
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--crm-page)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 360, padding: 32,
        background: 'var(--crm-surface)',
        backdropFilter: 'blur(40px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
        border: '1px solid var(--crm-w08)', borderRadius: 18,
      }}>
        <div style={{ color: 'var(--crm-ink)', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Sign in</div>
        <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 24 }}>
          Use your account credentials.
        </div>

        <input
          type="email" required autoFocus value={email}
          onChange={e => setEmail(e.target.value)} placeholder="Email"
          style={inputStyle}
        />
        <input
          type="password" required value={password}
          onChange={e => setPassword(e.target.value)} placeholder="Password" minLength={8}
          style={{ ...inputStyle, marginTop: 10 }}
        />

        {err && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            background: 'var(--crm-red-bg)', border: '1px solid var(--crm-red-br)',
            borderRadius: 8, color: 'var(--crm-red)', fontSize: 12,
          }}>{err}</div>
        )}

        <button type="submit" disabled={checking} style={{
          marginTop: 16, width: '100%', height: 40,
          background: checking ? 'rgba(139,0,0,0.5)' : 'linear-gradient(90deg, #CC0000 0%, #FF2222 50%, #E01E1E 100%)',
          border: 'none', borderRadius: 10, color: 'var(--crm-ink)', fontSize: 14, fontWeight: 700,
          cursor: checking ? 'wait' : 'pointer',
        }}>
          {checking ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const inputStyle = {
  width: '100%', height: 38, padding: '0 12px',
  background: 'var(--crm-w04)',
  border: '1px solid var(--crm-w08)',
  borderRadius: 10, color: 'var(--crm-ink)', fontSize: 14, outline: 'none',
  fontFamily: 'inherit',
};
