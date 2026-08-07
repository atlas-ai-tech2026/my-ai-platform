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
import { CrmThemeProvider } from './crmTheme';

const IDLE_MS = 15 * 60 * 1000;

export default function AdminGuard({ children }) {
  const navigate = useNavigate();
  // N3: the session is an httpOnly cookie this code cannot read, so identity
  // comes from the server rather than from decoding a localStorage token.
  // `undefined` = still asking, `null` = signed out, object = signed in.
  const [user, setUser] = useState(undefined);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminApi.me()
      .then(r => { if (!cancelled) setUser(r?.user ?? r ?? null); })
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
    // N17: the UI used to drop only its own copy, leaving the httpOnly admin
    // cookie valid for up to 30 minutes — on a shared machine the next person
    // inherited a live session. Clear it server-side, then leave.
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

  // Still asking the server who we are — render nothing rather than flashing
  // the sign-in form at an already-signed-in admin.
  //
  // MUST stay below every hook. Placing this above useCallback/useEffect meant
  // the first render (user === undefined) ran five hooks and the next ran
  // seven, which is React error #310 — it crashed the whole panel to a black
  // screen. Hooks cannot be skipped by an early return.
  //
  // EVERY return path below is wrapped in CrmThemeProvider. The provider is
  // what DEFINES the --crm-* variables this screen's styles read; when it
  // lived inside AdminPanel, the LOGIN screen rendered outside it, every
  // colour resolved to nothing, and a signed-out admin got an invisible form
  // on a dark page — the production black screen of 2026-08-07.
  if (user === undefined) return <CrmThemeProvider>{null}</CrmThemeProvider>;

  // Logged in + admin → render the panel.
  if (user && user.role === 'admin') {
    return (
      <CrmThemeProvider>
        {children}
        <button
          onClick={logout}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 1000,
            padding: '6px 14px', fontSize: 12, fontWeight: 600,
            background: 'var(--crm-w06)',
            border: '1px solid var(--crm-w12)',
            borderRadius: 8, color: 'var(--crm-w80)', cursor: 'pointer',
            fontFamily: '"DM Sans", sans-serif',
          }}
        >Sign out</button>
      </CrmThemeProvider>
    );
  }

  // Not logged in → inline login form. We don't render a hint that this is the
  // "admin panel" — just a generic "sign in" form. Anyone sniffing the URL
  // shouldn't be able to confirm by looking at the page that it's privileged.
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
  // N1: second-factor step. `needsCode` flips on once the server says the
  // account has 2FA enabled; the password fields stay mounted (and disabled)
  // so the same submit can resend them with the code.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setChecking(true);
    try {
      const trimmed = code.trim();
      const r = await adminApi.login(email.trim().toLowerCase(), password,
        !needsCode || !trimmed ? {}
          : useRecovery ? { recoveryCode: trimmed } : { totpCode: trimmed });
      // N3: the token in this response is deliberately NOT stored. For an
      // admin the server also set the httpOnly session cookie, which is what
      // authenticates every later call — nothing readable by page JavaScript.
      if (r?.user?.role !== 'admin') {
        // Signed in but not an admin. Say so generically: don't reveal
        // whether it was the credentials or the role that failed.
        await adminApi.logout().catch(() => {});
        setErr('Sign-in successful but this account does not have access.');
        return;
      }
      onLogin(r.user);
    } catch (e) {
      // N1: a 401 carrying totp_required means the password was accepted and
      // only the second factor is missing or wrong. Showing "Invalid email or
      // password" here (the old behaviour) is what made 2FA look broken.
      if (e instanceof ApiError && e.status === 401 && e.body?.totp_required) {
        setNeedsCode(true);
        setCode('');
        setErr(needsCode ? (e.body.error || 'That code was not accepted.') : '');
      } else if (e instanceof ApiError && e.status === 429) {
        setErr('Too many attempts. Try again in 15 minutes.');
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
          type="email" required autoFocus={!needsCode} value={email}
          onChange={e => setEmail(e.target.value)} placeholder="Email"
          disabled={needsCode}
          style={{ ...inputStyle, opacity: needsCode ? 0.5 : 1 }}
        />
        <input
          type="password" required value={password}
          onChange={e => setPassword(e.target.value)} placeholder="Password" minLength={8}
          disabled={needsCode}
          style={{ ...inputStyle, marginTop: 10, opacity: needsCode ? 0.5 : 1 }}
        />

        {needsCode && (
          <>
            <input
              type="text" required autoFocus value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={useRecovery ? 'Recovery code' : '6-digit code'}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              // Recovery codes are grouped like ABCD-EFGH; TOTP is 6 digits.
              maxLength={useRecovery ? 32 : 6}
              style={{ ...inputStyle, marginTop: 10, letterSpacing: useRecovery ? 1 : 4, fontSize: 16 }}
            />
            <button
              type="button"
              onClick={() => { setUseRecovery(v => !v); setCode(''); setErr(''); }}
              style={{
                marginTop: 8, background: 'none', border: 'none', padding: 0,
                color: 'var(--crm-w45)', fontSize: 12, cursor: 'pointer',
                fontFamily: 'inherit', textDecoration: 'underline',
              }}
            >
              {useRecovery ? 'Use an authenticator code instead' : 'Lost your phone? Use a recovery code'}
            </button>
          </>
        )}

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
          {checking ? 'Signing in…' : needsCode ? 'Verify' : 'Sign in'}
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
