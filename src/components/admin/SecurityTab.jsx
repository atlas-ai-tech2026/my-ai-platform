// ─── SecurityTab ─────────────────────────────────────────────────────────────
// N1 (recheck 2026-08-03): H5 shipped a correct TOTP implementation on the
// server — enrolment, confirmation, recovery codes, replay protection — and
// NO screen anywhere could reach it. Enabling 2FA would have locked the admin
// out of their own panel, so it stayed off and the CRM sat behind a password.
// This is the missing half.
//
// Deliberately no QR image: rendering one needs a new runtime dependency
// (the CSP blocks CDN scripts, so it would have to be bundled), and this
// repo's rule is to check whether the stdlib or an existing dep solves it
// first — H5 itself chose node:crypto over otplib for the same reason. Every
// authenticator app accepts a typed key, and on a phone the otpauth:// link
// opens the app directly, so the QR buys convenience, not capability.

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

/** Group a base32 secret into 4-character blocks so it can be typed without losing place. */
function groupSecret(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

export default function SecurityTab({ onError }) {
  const [status, setStatus] = useState(null);      // { enabled, recovery_codes_remaining }
  const [enrolling, setEnrolling] = useState(null); // { secret, otpauth_uri }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null); // shown exactly once
  const [disarming, setDisarming] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const load = useCallback(async () => {
    try {
      setStatus(await adminApi.twoFactorStatus());
    } catch (e) { onError?.(e, 'Could not read two-factor status'); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const startSetup = useCallback(async () => {
    setBusy(true);
    try {
      setEnrolling(await adminApi.twoFactorSetup());
      setCode('');
    } catch (e) { onError?.(e, 'Could not start two-factor setup'); }
    finally { setBusy(false); }
  }, [onError]);

  const confirm = useCallback(async () => {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) { toast.error('Enter the current 6-digit code'); return; }
    setBusy(true);
    try {
      const r = await adminApi.twoFactorConfirm(c);
      setRecoveryCodes(r.recovery_codes || []);
      setEnrolling(null);
      setCode('');
      await load();
      toast.success('Two-factor is on. Save your recovery codes now.');
    } catch (e) {
      // A wrong code is the normal case here (clock drift, typo) — keep the
      // enrolment open and say what to do rather than dropping to an error toast.
      toast.error(e?.body?.error || 'That code was not accepted. Try the current one.');
    } finally { setBusy(false); }
  }, [code, load]);

  const disable = useCallback(async () => {
    const c = disableCode.trim();
    if (!/^\d{6}$/.test(c)) { toast.error('Enter a current 6-digit code to turn it off'); return; }
    setBusy(true);
    try {
      await adminApi.twoFactorDisable(c);
      setDisarming(false);
      setDisableCode('');
      await load();
      toast.success('Two-factor is off.');
    } catch (e) {
      toast.error(e?.body?.error || 'That code was not accepted.');
    } finally { setBusy(false); }
  }, [disableCode, load]);

  const copy = useCallback((text, what) => {
    navigator.clipboard?.writeText(text)
      .then(() => toast.success(`${what} copied`))
      .catch(() => toast.error('Could not copy — select and copy manually'));
  }, []);

  if (!status) return <div style={muted}>Loading…</div>;

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div>
        <div style={h2}>Two-factor authentication</div>
        <div style={muted}>
          A code from your phone, on top of your password. Without it, this control
          panel — every customer record, every credit balance — is protected by the
          password alone.
        </div>
      </div>

      {/* ── current state ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: status.enabled ? 'var(--crm-green)' : '#e0442c',
          }} />
          <span style={{ color: 'var(--crm-ink)', fontWeight: 600 }}>
            {status.enabled ? 'On' : 'Off'}
          </span>
          {status.enabled && (
            <span style={{ ...muted, marginLeft: 'auto' }}>
              {status.recovery_codes_remaining} recovery codes left
            </span>
          )}
        </div>
      </div>

      {/* ── recovery codes, shown once after confirmation ── */}
      {recoveryCodes && (
        <div style={{ ...card, borderColor: 'var(--crm-green-br)' }}>
          <div style={{ color: 'var(--crm-ink)', fontWeight: 600, marginBottom: 6 }}>
            Your recovery codes
          </div>
          <div style={{ ...muted, marginBottom: 12 }}>
            Shown once and never again. Each works a single time, and they are the
            only way in if you lose your phone. Store them in two separate places —
            your password manager and somewhere offline.
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13,
            color: 'var(--crm-ink)', marginBottom: 12,
          }}>
            {recoveryCodes.map(c => <div key={c}>{c}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={() => copy(recoveryCodes.join('\n'), 'Recovery codes')}>
              Copy all
            </button>
            <button style={btnGhost} onClick={() => setRecoveryCodes(null)}>
              I have saved them
            </button>
          </div>
        </div>
      )}

      {/* ── enrolment ── */}
      {!status.enabled && !enrolling && !recoveryCodes && (
        <button style={btn} disabled={busy} onClick={startSetup}>
          {busy ? 'Starting…' : 'Turn on two-factor'}
        </button>
      )}

      {enrolling && (
        <div style={card}>
          <div style={{ color: 'var(--crm-ink)', fontWeight: 600, marginBottom: 10 }}>
            Add this key to your authenticator
          </div>
          <ol style={{ ...muted, paddingLeft: 18, margin: '0 0 14px', lineHeight: 1.8 }}>
            <li>Open your authenticator app (Google Authenticator, 1Password, Authy…).</li>
            <li>Choose “add account”, then “enter a setup key”.</li>
            <li>Paste the key below, then type the 6-digit code it shows.</li>
          </ol>

          <div style={{
            padding: '12px 14px', background: 'var(--crm-w04)',
            border: '1px solid var(--crm-w10)', borderRadius: 10,
            fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 15,
            color: 'var(--crm-ink)', letterSpacing: 1, wordBreak: 'break-all', marginBottom: 8,
          }}>
            {groupSecret(enrolling.secret)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button style={btnGhost} onClick={() => copy(enrolling.secret, 'Setup key')}>
              Copy key
            </button>
            {/* On a phone this opens the authenticator directly. */}
            <a href={enrolling.otpauth_uri} style={{ ...btnGhost, textDecoration: 'none' }}>
              Open in authenticator app
            </a>
          </div>

          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="6-digit code"
            inputMode="numeric"
            maxLength={6}
            style={{
              width: 160, height: 38, padding: '0 12px',
              background: 'var(--crm-w04)',
              border: '1px solid var(--crm-w10)', borderRadius: 10,
              color: 'var(--crm-ink)', fontSize: 16, letterSpacing: 4, outline: 'none',
              fontFamily: 'inherit', marginRight: 8,
            }}
          />
          <button style={btn} disabled={busy} onClick={confirm}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <button style={{ ...btnGhost, marginLeft: 8 }} onClick={() => { setEnrolling(null); setCode(''); }}>
            Cancel
          </button>
        </div>
      )}

      {/* ── disable ── */}
      {status.enabled && (
        disarming ? (
          <div style={card}>
            <div style={{ ...muted, marginBottom: 10 }}>
              Enter a current code to turn two-factor off. Requiring a live code here
              means a stolen session cannot quietly remove your second factor.
            </div>
            <input
              value={disableCode}
              onChange={e => setDisableCode(e.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
              maxLength={6}
              style={{
                width: 160, height: 38, padding: '0 12px',
                background: 'var(--crm-w04)',
                border: '1px solid var(--crm-w10)', borderRadius: 10,
                color: 'var(--crm-ink)', fontSize: 16, letterSpacing: 4, outline: 'none',
                fontFamily: 'inherit', marginRight: 8,
              }}
            />
            <button style={btn} disabled={busy} onClick={disable}>
              {busy ? 'Checking…' : 'Turn off'}
            </button>
            <button style={{ ...btnGhost, marginLeft: 8 }}
              onClick={() => { setDisarming(false); setDisableCode(''); }}>
              Keep it on
            </button>
          </div>
        ) : (
          <button style={btnGhost} onClick={() => setDisarming(true)}>
            Turn off two-factor
          </button>
        )
      )}
    </div>
  );
}

const h2 = { color: 'var(--crm-ink)', fontSize: 18, fontWeight: 700, marginBottom: 6 };
const muted = { color: 'var(--crm-w45)', fontSize: 13, lineHeight: 1.6 };
const card = {
  padding: 16,
  background: 'var(--crm-w03)',
  border: '1px solid var(--crm-w08)',
  borderRadius: 12,
};
const btn = {
  height: 38, padding: '0 18px',
  background: 'linear-gradient(90deg, #CC0000 0%, #FF2222 50%, #E01E1E 100%)',
  border: 'none', borderRadius: 10, color: 'var(--crm-ink)',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
};
const btnGhost = {
  height: 38, padding: '0 16px', display: 'inline-flex', alignItems: 'center',
  background: 'var(--crm-w05)',
  border: '1px solid var(--crm-w12)', borderRadius: 10,
  color: 'var(--crm-w80)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
