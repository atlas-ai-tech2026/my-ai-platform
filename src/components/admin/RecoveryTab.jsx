// ─── RecoveryTab.jsx ─────────────────────────────────────────────────────────
// Putting back a customer's deleted work when they cannot do it themselves.
//
// ── WHEN THIS SCREEN IS OPENED ─────────────────────────────────────────────
// A customer has emailed saying they lost something. That is the only reason
// anyone comes here, and it is why the tab is called Recovery rather than
// Deleted — it is named after the job, not the contents.
//
// The customer's own "Recently deleted" handles the ordinary mistake, so this
// is for the cases that genuinely need Amr: a closed account, a bulk mistake,
// somebody who cannot find their own screen.
//
// ── SORTED BY TIME REMAINING, NOT BY WHEN IT WAS DELETED ───────────────────
// What matters is what is about to be lost for good. Two days left needs a
// decision today; twenty-nine does not. Sorting by deletion date would bury
// the urgent one under this morning's.
//
// ── AND A FAILURE MUST NEVER LOOK LIKE AN EMPTY BIN ────────────────────────
// "There is nothing to recover" and "I could not look" are indistinguishable
// to somebody reading, and only one of them is good news to give a customer
// on the phone.

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const URGENT_DAYS = 7;

/** "2 days left" · "last day" — never "0 days left", which reads as already
 *  gone while the picture is still perfectly recoverable. */
export function daysLabel(n) {
  if (n === null || n === undefined || n === '') return 'unknown';
  const d = Number(n);
  if (!Number.isFinite(d)) return 'unknown';
  if (d <= 0) return 'last day';
  return d === 1 ? '1 day left' : `${d} days left`;
}

export const isUrgent = (n) => Number.isFinite(Number(n)) && Number(n) <= URGENT_DAYS;

export default function RecoveryTab({ onError }) {
  const [filter, setFilter] = useState({ email: '', text: '', days: '' });
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [recoveryDays, setRecoveryDays] = useState(30);

  const load = useCallback(async (f) => {
    setItems(null); setErr(null); setSel([]);
    try {
      const r = await adminApi.recoveryList(f);
      setItems(r.items || []);
      if (r.recovery_days) setRecoveryDays(r.recovery_days);
    } catch (e) {
      // NOT an empty list. Those are different facts.
      setErr(e?.message || 'Could not read what is recoverable.');
      onError?.(e, 'Could not load Recovery');
    }
  }, [onError]);

  useEffect(() => { load(filter); /* eslint-disable-next-line */ }, []);

  const restore = async () => {
    if (!sel.length) return;
    setBusy(true);
    try {
      const r = await adminApi.recoveryRestore(sel);
      const back = r.restored || 0;
      // Asking for 40 and getting 38 is a fact somebody on a support call
      // needs — a flat "done" would hide it.
      toast.success(back === sel.length
        ? `${back} restored`
        : `${back} of ${sel.length} restored — the rest had passed ${recoveryDays} days.`);
      await load(filter);
    } catch (e) {
      toast.error(e?.message || 'Could not restore.');
    } finally { setBusy(false); }
  };

  const toggle = (id) => setSel((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          value={filter.email} placeholder="Account email"
          onChange={(e) => setFilter((f) => ({ ...f, email: e.target.value }))}
          style={{ ...inp, flex: '1 1 220px' }} aria-label="Account email"
        />
        <input
          value={filter.text} placeholder="Search prompt or model"
          onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
          style={{ ...inp, flex: '1 1 180px' }} aria-label="Search prompt or model"
        />
        <select
          value={filter.days} onChange={(e) => setFilter((f) => ({ ...f, days: e.target.value }))}
          style={inp} aria-label="Deleted when"
        >
          <option value="">Deleted any time</option>
          <option value="1">Deleted today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button onClick={() => load(filter)} disabled={busy} style={btn}>Search</button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        paddingBottom: 10, borderBottom: '1px solid var(--crm-w08)', marginBottom: 10,
      }}>
        <span style={{ fontSize: 13, color: 'var(--crm-w55)' }}>
          {items === null && !err ? 'Looking…'
            : err ? '—'
            : `${items.length} recoverable`}
        </span>
        <span style={{ fontSize: 12, color: 'var(--crm-w40)' }}>soonest to be lost first</span>
        <InfoDot
          label="Recovery"
          text={`A customer deletes a picture and it stays here for ${recoveryDays} days before it is `
            + 'destroyed. Their own "Recently deleted" screen handles the ordinary mistake — this is '
            + 'for the cases that need you: a closed account, a bulk mistake, somebody who cannot '
            + 'find it. Restoring puts the row back in their history exactly as it was.'}
        />
        <button
          onClick={restore} disabled={!sel.length || busy}
          style={{ ...btn, marginLeft: 'auto', opacity: sel.length && !busy ? 1 : 0.45 }}
        >
          {busy ? 'Restoring…' : sel.length ? `Restore ${sel.length}` : 'Restore'}
        </button>
      </div>

      {err && (
        <Note tone="bad">
          {err} — <strong>nothing has been lost</strong>. This screen only reads; it cannot delete
          anything. Try Search again.
        </Note>
      )}

      {!err && items?.length === 0 && (
        <Note>
          Nothing deleted matches. Anything past {recoveryDays} days is already gone for good and
          cannot be brought back by anyone.
        </Note>
      )}

      {items?.map((it) => {
        const on = sel.includes(it.id);
        const urgent = isUrgent(it.days_left);
        return (
          <div
            key={it.id} onClick={() => !busy && toggle(it.id)}
            style={{
              display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px',
              borderRadius: 10, marginBottom: 6, cursor: busy ? 'default' : 'pointer',
              border: `1px solid ${on ? 'var(--crm-blue)' : 'var(--crm-w08)'}`,
              background: on ? 'var(--crm-blue-bg)' : 'var(--crm-w03)',
            }}
          >
            <span aria-hidden="true" style={{
              width: 20, height: 20, flex: 'none', borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // A blue tick on the blue tint, rather than white on a blue
              // fill: no colour literal, so it follows light and dark without
              // a special case. The first attempt hard-coded white and the
              // theme test caught it.
              background: on ? 'var(--crm-blue-bg)' : 'transparent',
              border: `1px solid ${on ? 'var(--crm-blue)' : 'var(--crm-w20)'}`,
              color: 'var(--crm-blue)', fontSize: 12, fontWeight: 700,
            }}>{on ? '✓' : ''}</span>

            {(it.thumb_url || it.result_url) && (
              <img
                src={it.thumb_url || it.result_url} alt="" loading="lazy" decoding="async"
                style={{ width: 40, height: 40, flex: 'none', borderRadius: 7, objectFit: 'cover' }}
              />
            )}

            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: 'block', fontSize: 13, color: 'var(--crm-ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{it.prompt || 'No prompt'}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--crm-w40)' }}>
                {it.model || it.type || 'Image'} · {it.email}
              </span>
            </span>

            <span style={{
              flex: 'none', fontSize: 12, padding: '3px 9px', borderRadius: 999,
              background: urgent ? 'var(--crm-red-bg)' : 'var(--crm-w06)',
              color: urgent ? 'var(--crm-red)' : 'var(--crm-w55)',
            }}>{daysLabel(it.days_left)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Note({ children, tone }) {
  return (
    <div style={{
      padding: '13px 15px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
      color: tone === 'bad' ? 'var(--crm-red)' : 'var(--crm-w55)',
      background: tone === 'bad' ? 'var(--crm-red-bg)' : 'var(--crm-w03)',
      border: `1px solid ${tone === 'bad' ? 'var(--crm-red-br)' : 'var(--crm-w08)'}`,
    }}>{children}</div>
  );
}

const inp = {
  height: 32, borderRadius: 8, padding: '0 10px', fontSize: 12.5, fontFamily: 'inherit',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)', color: 'var(--crm-ink)',
};
const btn = {
  height: 32, padding: '0 14px', borderRadius: 9, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
};
