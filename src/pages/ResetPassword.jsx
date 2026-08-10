// ─── ResetPassword ───────────────────────────────────────────────────────────
// The page a customer lands on from the reset email. Public — they are, by
// definition, locked out, so it cannot sit behind a login.
//
// The API for this shipped first; without this screen the link in the email
// went nowhere, so password reset was not actually usable by anyone.
//
// THREE THINGS THIS SCREEN GETS RIGHT ON PURPOSE:
//
// 1. It never says whether the account exists. The request form always shows
//    the same confirmation. That mirrors the server (finding N11) — a screen
//    that said "no such account" would undo the protection entirely.
//
// 2. A bad or expired link is explained, with the way forward. "Invalid token"
//    tells a locked-out person nothing; "this link has expired, ask for a new
//    one" tells them what to do next.
//
// 3. The password rules are stated BEFORE they type, not after they fail.

import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const MIN_LENGTH = 8;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  // No token in the URL → they came here to ASK for a link.
  return token ? <SetNewPassword token={token} /> : <RequestLink />;
}

// ─── step 1: ask for a link ──────────────────────────────────────────────────
function RequestLink() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (res.status === 429) {
        setErr('Too many attempts. Please wait 15 minutes and try again.');
        return;
      }
      // Anything else shows the SAME confirmation. The server deliberately
      // does not reveal whether the address has an account, and this screen
      // must not undo that by behaving differently.
      setSent(true);
    } catch {
      setErr('Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <Shell title="Check your email">
        <p style={p}>
          If that address has a Voxel account, a reset link is on its way. It works once
          and expires in an hour.
        </p>
        <p style={{ ...p, marginTop: 14 }}>
          Nothing arrived after a few minutes? Look in your spam folder, or
          <button type="button" onClick={() => setSent(false)} style={linkBtn}>try another address</button>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Reset your password">
      <p style={p}>Enter the email address on your Voxel account and we will send you a link.</p>
      <form onSubmit={submit} style={{ marginTop: 22 }}>
        <label style={label} htmlFor="reset-email">Email address</label>
        <input id="reset-email" type="email" required autoFocus value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={input} />
        {err && <div style={errorBox}>{err}</div>}
        <button type="submit" disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Sending…' : 'Send the reset link'}
        </button>
      </form>
      <p style={{ ...p, fontSize: 13, marginTop: 20 }}>
        Signed up with Google or Microsoft? You have no Voxel password — sign in with that
        button instead, and reset it with them if you have forgotten it.
      </p>
    </Shell>
  );
}

// ─── step 2: set the new password ────────────────────────────────────────────
function SetNewPassword({ token }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function submit(e) {
    e.preventDefault();
    if (password.length < MIN_LENGTH || password !== confirm) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Say what to DO. "Invalid token" tells a locked-out person nothing.
        setErr(data.error || 'That reset link is invalid or has expired. Request a new one.');
        return;
      }
      setDone(true);
    } catch {
      setErr('Could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <Shell title="Password changed">
        <p style={p}>
          Your password has been updated, and you have been signed out everywhere else.
          You can sign in now.
        </p>
        <button onClick={() => navigate('/')} style={{ ...primary, marginTop: 22 }}>
          Go to Voxel
        </button>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password">
      <form onSubmit={submit}>
        <label style={label} htmlFor="new-password">New password</label>
        <input id="new-password" type="password" required autoFocus value={password}
          onChange={(e) => setPassword(e.target.value)} minLength={MIN_LENGTH}
          autoComplete="new-password" style={input} />
        {/* Stated before they type, not after they fail. */}
        <div style={{ ...hint, color: tooShort ? '#ff8f8f' : 'rgba(255,255,255,0.45)' }}>
          At least {MIN_LENGTH} characters.
        </div>

        <label style={{ ...label, marginTop: 16 }} htmlFor="confirm-password">Confirm password</label>
        <input id="confirm-password" type="password" required value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" style={input} />
        {mismatch && <div style={{ ...hint, color: '#ff8f8f' }}>The two passwords do not match.</div>}

        {err && <div style={errorBox}>{err}</div>}
        <button type="submit" disabled={busy || password.length < MIN_LENGTH || password !== confirm}
          style={{
            ...primary,
            opacity: (busy || password.length < MIN_LENGTH || password !== confirm) ? 0.5 : 1,
          }}>
          {busy ? 'Saving…' : 'Set my new password'}
        </button>
      </form>
    </Shell>
  );
}

// ─── shared shell ────────────────────────────────────────────────────────────
function Shell({ title, children }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0c', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: '"DM Sans", system-ui, sans-serif',
    }}>
      <div style={{
        width: '100%', maxWidth: 420, padding: 32,
        background: 'rgba(18,18,22,0.9)',
        border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18,
      }}>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 20, letterSpacing: '.02em' }}>
          VOXEL<span style={{ color: '#e0442c' }}>.AI</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 12px' }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

const p = { color: 'rgba(255,255,255,0.62)', fontSize: 14.5, lineHeight: 1.6, margin: 0 };
const label = { display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 };
const hint = { fontSize: 12, marginTop: 6 };
const input = {
  width: '100%', height: 42, padding: '0 13px', fontSize: 15,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10, color: '#fff', outline: 'none', fontFamily: 'inherit', colorScheme: 'dark',
};
const primary = {
  width: '100%', height: 44, marginTop: 20, border: 'none', borderRadius: 10,
  background: 'linear-gradient(90deg,#CC0000 0%,#FF2222 50%,#E01E1E 100%)',
  color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
};
const linkBtn = {
  background: 'none', border: 'none', padding: '0 0 0 4px', color: '#93c5fd',
  fontSize: 14.5, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
};
const errorBox = {
  marginTop: 14, padding: '10px 13px', borderRadius: 9, fontSize: 13,
  background: 'rgba(224,68,44,0.12)', border: '1px solid rgba(224,68,44,0.45)', color: '#ffb4a6',
};
