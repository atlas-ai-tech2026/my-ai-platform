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
import { adminApi, getStoredUser, VOXEL_TOKEN_KEY, ApiError } from '@/lib/adminApi';

const IDLE_MS = 15 * 60 * 1000;

export default function AdminGuard({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser());
  const [checking, setChecking] = useState(false);

  // Re-decode the stored token on mount in case it expired.
  useEffect(() => { setUser(getStoredUser()); }, []);

  // Logged in as a non-admin → bounce to home so they don't even see the URL exists.
  useEffect(() => {
    if (user && user.role !== 'admin') {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  // Idle redirect (frontend-only; not a security boundary).
  const logout = useCallback(() => {
    localStorage.removeItem(VOXEL_TOKEN_KEY);
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
      <>
        {children}
        <button
          onClick={logout}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 1000,
            padding: '6px 14px', fontSize: 12, fontWeight: 600,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
            fontFamily: '"DM Sans", sans-serif',
          }}
        >Sign out</button>
      </>
    );
  }

  // Not logged in → inline login form. We don't render a hint that this is the
  // "admin panel" — just a generic "sign in" form. Anyone sniffing the URL
  // shouldn't be able to confirm by looking at the page that it's privileged.
  return <InlineLogin checking={checking} setChecking={setChecking} onLogin={(u) => setUser(u)} />;
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
      localStorage.setItem(VOXEL_TOKEN_KEY, r.token);
      const decoded = getStoredUser();
      if (!decoded || decoded.role !== 'admin') {
        // Successful login but not an admin → drop the token and tell them
        // generically that they don't have access. Don't leak whether the
        // role check vs the credentials failed.
        localStorage.removeItem(VOXEL_TOKEN_KEY);
        setErr('Sign-in successful but this account does not have access.');
        return;
      }
      onLogin(decoded);
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
      minHeight: '100vh', background: '#0a0a0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 360, padding: 32,
        background: 'rgba(18,18,22,0.8)',
        backdropFilter: 'blur(40px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18,
      }}>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Sign in</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 24 }}>
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
                color: 'rgba(255,255,255,0.45)', fontSize: 12, cursor: 'pointer',
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
            background: 'rgba(224,30,30,0.1)', border: '1px solid rgba(224,30,30,0.4)',
            borderRadius: 8, color: '#ff6666', fontSize: 12,
          }}>{err}</div>
        )}

        <button type="submit" disabled={checking} style={{
          marginTop: 16, width: '100%', height: 40,
          background: checking ? 'rgba(139,0,0,0.5)' : 'linear-gradient(90deg, #CC0000 0%, #FF2222 50%, #E01E1E 100%)',
          border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700,
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
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none',
  fontFamily: 'inherit',
};
