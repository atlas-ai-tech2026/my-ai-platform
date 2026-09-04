// ─── BackfillPanel ───────────────────────────────────────────────────────────
// Labelling the credit rows written before the ledger recorded WHO put them
// there. Shown at the top of Manual Credits until there is nothing left to
// label, then it disappears on its own.
//
// ☠ PREVIEW FIRST, ALWAYS. This touches every historical credit row — the
// ledger behind $9,605 in one workshop alone. So it shows counts, money AND
// real example rows, because a count cannot be checked and three rows can.
// The owner reads "312 manual, $9,605" with three examples underneath and can
// say "no, those are not manual" BEFORE anything is written.
//
// And it will not write against a picture that moved: apply sends back the
// exact row total the preview showed, and the server refuses if the ledger has
// changed since.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = (usd) => '$' + Number(usd || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TONE = {
  manual: 'var(--crm-green)', bulk: 'var(--crm-blue)', promo: 'var(--crm-purple)',
  gift: 'var(--crm-pink)', system: 'var(--crm-w50)', unclassified: 'var(--crm-amber)',
};

export default function BackfillPanel({ onError, onApplied }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const look = useCallback(async () => {
    try { setPreview(await adminApi.creditBackfillPreview()); }
    catch (e) { onError?.(e, 'Could not build the preview'); }
  }, [onError]);

  useEffect(() => { look(); }, [look]);

  const apply = useCallback(async () => {
    if (!preview) return;
    if (!window.confirm(
      `Label ${num(preview.would_write)} credit rows?\n\n${preview.sentence}\n\n`
      + 'This records where each row came from. It does not change any balance.')) return;
    setBusy(true);
    try {
      const r = await adminApi.creditBackfillApply(preview.total_rows);
      setDone(r);
      toast.success(r.sentence);
      await look();
      onApplied?.();
    } catch (e) { onError?.(e, 'Nothing was changed'); }
    finally { setBusy(false); }
  }, [preview, look, onApplied]);

  // Nothing left to label — the panel has done its job and gets out of the way.
  if (!preview || preview.total_rows === 0) {
    return done ? (
      <div style={{ ...box, background: 'var(--crm-green-bg)', marginBottom: 14 }}>
        <b>{done.sentence}</b>
      </div>
    ) : null;
  }

  return (
    <div style={{ ...box, marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 5 }}>
        {num(preview.total_rows)} older credit rows do not say where they came from
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--crm-w50)', lineHeight: 1.6, marginBottom: 11 }}>
        They were written before the ledger recorded that. Below is what each would become —
        look at the examples before you approve. <b>No balance changes</b>; this only records
        where each entry came from.
      </div>

      <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(228px, 1fr))', marginBottom: 12 }}>
        {preview.groups.map((g) => (
          <div key={g.source} style={{
            border: '1px solid var(--crm-w08)', borderRadius: 9, padding: '10px 12px',
            background: g.source === 'unclassified' ? 'var(--crm-amber-bg)' : 'var(--crm-w03)',
          }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: TONE[g.source] || 'var(--crm-w60)' }}>
              {num(g.rows)} → {g.source}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--crm-w45)', marginBottom: 6 }}>
              {num(g.credits)} credits · {money(g.usd)}
            </div>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, lineHeight: 1.7,
              color: 'var(--crm-w50)', wordBreak: 'break-all',
            }}>
              {g.examples.map((e, i) => (
                <div key={i}>{e.email} · {e.action} {num(e.amount)} · {e.reason || '(no reason)'}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {preview.unclassified > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--crm-w50)', marginBottom: 11, lineHeight: 1.6 }}>
          <b>{num(preview.unclassified)} rows will be left alone.</b> We cannot tell what they were,
          and guessing would put unknown money into a total you would read as fact.
        </div>
      )}

      <button onClick={apply} disabled={busy} style={primary}>
        {busy ? 'Labelling…' : `Label ${num(preview.would_write)} rows`}
      </button>
    </div>
  );
}

const box = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, padding: 15,
};
const primary = {
  height: 36, padding: '0 16px', borderRadius: 9, cursor: 'pointer',
  background: '#e0442c', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
  fontFamily: 'inherit',
};
