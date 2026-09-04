// ─── BulkCreditsPanel ────────────────────────────────────────────────────────
// Giving credits to a list of people who ALREADY have accounts.
//
// Bulk has only ever CREATED accounts. Hand it a list of returning attendees
// and every one is skipped — the batch half-works, which reads as success.
// This is the other half, and it is a SEPARATE MODE on purpose.
//
// ☠ NEVER "create if missing, top up if present". One button doing two
// different things to different people means that afterwards you cannot tell
// which happened to whom — and that confusion is the whole reason the owner
// asked for these screens.
//
// ☠ AND IT SHOWS THE BILL BEFORE IT MOVES. 61 accounts × 158 credits is about
// $610. A confirm box asking "are you sure?" is not consent to that; a number
// is. Nothing is charged until the preview has been seen and the same count
// sent back.
import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function BulkCreditsPanel({ onError }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [credits, setCredits] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);

  const stale = useCallback(() => { setPlan(null); setDone(null); }, []);

  const readFile = useCallback(async (file) => {
    if (!file) return;
    try { setText(await file.text()); setFileName(file.name); stale(); }
    catch (e) { onError?.(e, 'Could not read that file'); }
  }, [onError, stale]);

  const check = useCallback(async () => {
    if (!text.trim()) { toast.error('Paste a list, or upload a file'); return; }
    if (!(Number(credits) > 0)) { toast.error('Enter how many credits each account should receive'); return; }
    setBusy(true);
    try {
      setPlan(await adminApi.bulkCreditsPreview({
        emails: text.trim(), credits: Number(credits), access_days: days || undefined,
      }));
      setDone(null);
    } catch (e) { onError?.(e, 'Could not check the list'); }
    finally { setBusy(false); }
  }, [text, credits, days, onError]);

  const apply = useCallback(async () => {
    if (!plan?.accounts) return;
    if (!reason.trim()) { toast.error('Say what these credits are for — it is what the record will show'); return; }
    if (!window.confirm(
      `${plan.sentence}\n\nCredits live for ${plan.days} days.\nReason: ${reason.trim()}\n\nGo ahead?`)) return;
    setBusy(true);
    try {
      const r = await adminApi.bulkCreditsApply({
        emails: text.trim(), credits: Number(credits), access_days: days || undefined,
        reason: reason.trim(), expect_accounts: plan.accounts,
      });
      setDone(r); setPlan(null);
      toast.success(r.sentence);
    } catch (e) { onError?.(e, 'Nothing was changed'); }
    finally { setBusy(false); }
  }, [plan, text, credits, days, reason, onError]);

  return (
    <div style={panel}>
      <div style={{ ...panelTitle, display: 'flex', alignItems: 'center', gap: 7 }}>
        Add credits to accounts that already exist
        <InfoDot label="Add credits to existing accounts"
          text={'For people who already have an account — a workshop coming back, or a customer who '
            + 'needs more. It ADDS to their balance; it never replaces it. Addresses with no account '
            + 'receive nothing and are listed separately, never skipped quietly. You see the number '
            + 'of accounts, the credits and the dollars before anything is charged.'} />
      </div>

      <textarea value={text} onChange={(e) => { setText(e.target.value); stale(); }}
        placeholder={'ahmed@company.com\nsara@company.com\n…'}
        aria-label="Accounts to credit" rows={4}
        style={{ ...input, height: 'auto', minHeight: 82, width: '100%', padding: '10px 12px',
                 fontFamily: '"JetBrains Mono", monospace', fontSize: 12.5, resize: 'vertical' }} />

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 10 }}>
        <Field label="Credits each *">
          <input type="number" min="1" value={credits} aria-label="Credits each"
            onChange={(e) => { setCredits(e.target.value); stale(); }}
            placeholder="e.g. 158" style={input} />
        </Field>
        <Field label="Access days">
          <input type="number" min="1" max="3650" value={days} aria-label="Access days"
            onChange={(e) => { setDays(e.target.value); stale(); }}
            placeholder="Blank = 30 days" style={input} />
        </Field>
        <Field label="Reason *">
          <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason"
            placeholder="e.g. SPA News Academy 5th" style={input} />
        </Field>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginTop: 6 }}>
        Blank access days means the standard 30, exactly as a promo code. The reason is what the
        Manual Credits screen and any invoice will show.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 11 }}>
        <button onClick={check} disabled={busy} style={btn}>
          {busy && !plan ? 'Checking…' : 'Check first'}
        </button>
        <label style={{ ...btn, cursor: 'pointer' }}>
          Upload file…
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain"
            onChange={(e) => readFile(e.target.files?.[0])} style={{ display: 'none' }} />
        </label>
        {fileName && <span style={{ fontSize: 12, color: 'var(--crm-w40)' }}>{fileName}</span>}
      </div>

      {plan && (
        <div style={{ marginTop: 14, border: '1px solid var(--crm-w08)', borderRadius: 10, padding: '12px 14px',
                      background: plan.accounts ? 'var(--crm-green-bg)' : 'var(--crm-amber-bg)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 7 }}>{plan.sentence}</div>
          {plan.accounts > 0 && (
            <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: 9 }}>
              <Stat k="Accounts" v={num(plan.accounts)} />
              <Stat k="Credits each" v={num(plan.credits_each)} />
              <Stat k="Total credits" v={num(plan.total_credits)} />
              <Stat k="Cost" v={`$${num(plan.total_usd)}`} accent />
              <Stat k="Credits live" v={`${plan.days} days`} />
            </div>
          )}
          {plan.no_account?.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--crm-w50)', lineHeight: 1.6, marginBottom: 9 }}>
              <b>{plan.no_account.length} will receive nothing</b> — no account:{' '}
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, wordBreak: 'break-all' }}>
                {plan.no_account.slice(0, 8).join(' · ')}
                {plan.no_account.length > 8 ? ` … and ${plan.no_account.length - 8} more` : ''}
              </span>
            </div>
          )}
          {plan.accounts > 0 && (
            <button onClick={apply} disabled={busy} style={primary}>
              {busy ? 'Adding…' : `Add ${num(plan.credits_each)} credits to ${num(plan.accounts)} account${plan.accounts === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}

      {done && (
        <div style={{ marginTop: 14, border: '1px solid var(--crm-w08)', borderRadius: 10,
                      padding: '12px 14px', background: 'var(--crm-green-bg)', fontSize: 13 }}>
          <b>{done.sentence}</b>
          <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginTop: 4 }}>
            Their credits live for {done.days} days. The entries are on Money → Manual Credits,
            recorded as bulk.
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--crm-w40)' }}>{label}</span>
      {children}
    </label>
  );
}
function Stat({ k, v, accent }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--crm-w40)' }}>{k}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: accent ? 'var(--crm-orange)' : 'var(--crm-ink)' }}>{v}</div>
    </div>
  );
}

const input = {
  height: 34, padding: '0 10px', borderRadius: 9, background: 'var(--crm-w04)',
  border: '1px solid var(--crm-w10)', color: 'var(--crm-ink)', fontSize: 12.5,
  outline: 'none', fontFamily: 'inherit', width: '100%',
};
const btn = {
  height: 34, padding: '0 12px', borderRadius: 10, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)', color: 'var(--crm-ink)',
  fontSize: 13, fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
};
const primary = {
  height: 36, padding: '0 16px', borderRadius: 9, cursor: 'pointer',
  background: '#e0442c', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
};
const panel = { background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)', borderRadius: 12, padding: 16 };
const panelTitle = { fontSize: 13, fontWeight: 600, color: 'var(--crm-w60)', marginBottom: 11 };
