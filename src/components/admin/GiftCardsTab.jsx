// ─── GiftCardsTab ────────────────────────────────────────────────────────────
// CRM gift-card generation: batch-create single-use voucher codes (each
// redeemable exactly once by any user), list them with redemption status,
// and export a batch's codes to CSV for distribution. Users redeem in their
// account via the same redeem box as promo codes.

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

export default function GiftCardsTab({ onError }) {
  const [cards, setCards] = useState(null);
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [lastBatch, setLastBatch] = useState(null); // codes from the most recent generation

  // Generate form
  const [count, setCount] = useState('10');
  const [credits, setCredits] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await adminApi.listGiftCards(status);
      setCards(r.cards);
    } catch (e) { onError?.(e, 'Gift card list failed'); }
  }, [status, onError]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async () => {
    const c = Number(credits);
    const n = parseInt(count, 10);
    if (!Number.isFinite(c) || c <= 0) { toast.error('Enter the credit value per card'); return; }
    if (!Number.isFinite(n) || n < 1 || n > 500) { toast.error('Count must be 1-500'); return; }
    setCreating(true);
    try {
      const r = await adminApi.createGiftCards({
        count: n, credits: c,
        note: note.trim() || undefined,
        expires_at: expiresAt || undefined,
      });
      setLastBatch(r.cards);
      toast.success(`Generated ${r.cards.length} gift card(s) × ${c} credits`);
      load();
    } catch (e) { onError?.(e, 'Gift card generation failed'); }
    finally { setCreating(false); }
  }, [count, credits, note, expiresAt, load, onError]);

  const exportBatchCsv = useCallback((rows, label) => {
    if (!rows?.length) return;
    const csv = [
      ['code', 'credits', 'note', 'expires_at', 'redeemed_by', 'redeemed_at'].join(','),
      ...rows.map(g => [
        g.code, g.credits, `"${(g.note || '').replace(/"/g, '""')}"`,
        g.expires_at || '', g.redeemed_by_email || '', g.redeemed_at || '',
      ].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `voxel-gift-cards-${label}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${text}`),
      () => toast.error('Copy failed')
    );
  };

  return (
    <div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 16 }}>
        Single-use voucher codes — each card is redeemable exactly once, by any
        user, from the redeem box in their account. Generate a batch, export the
        codes, hand them out.
      </div>

      {/* Generate form */}
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Generate gift cards</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="How many" type="number" min="1" max="500" value={count}
            onChange={e => setCount(e.target.value)} style={{ ...inputStyle, width: 110 }} />
          <input placeholder="Credits per card *" type="number" min="0.5" step="0.5" value={credits}
            onChange={e => setCredits(e.target.value)} style={{ ...inputStyle, width: 160 }} />
          <input placeholder="Note (e.g. July giveaway)" value={note}
            onChange={e => setNote(e.target.value)} style={{ ...inputStyle, minWidth: 200 }} />
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
            style={inputStyle} title="Expiry (blank = never)" />
          <button onClick={generate} disabled={creating} style={primaryBtnStyle}>
            {creating ? 'Generating…' : '🎁 Generate'}
          </button>
        </div>
        {lastBatch?.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)' }}>
            <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Latest batch — {lastBatch.length} card(s)</span>
              <button onClick={() => exportBatchCsv(lastBatch, 'batch')} style={btnStyle}>⬇ Export batch CSV</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {lastBatch.map(g => (
                <code key={g.id} onClick={() => copy(g.code)} title="Click to copy"
                  style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                  {g.code}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* List */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0 10px' }}>
        <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
          <option value="all">All cards</option>
          <option value="unused">Unused</option>
          <option value="redeemed">Redeemed</option>
        </select>
        <button onClick={load} style={btnStyle}>⟳ Refresh</button>
        <button onClick={() => exportBatchCsv(cards, status)} disabled={!cards?.length} style={btnStyle}>⬇ Export view CSV</button>
        {cards && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            {cards.filter(c => !c.redeemed_by).length} unused · {cards.filter(c => c.redeemed_by).length} redeemed
          </span>
        )}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Code', 'Credits', 'Status', 'Note', 'Expires', 'Created'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cards === null && <tr><td colSpan={6} style={emptyStyle}>Loading…</td></tr>}
            {cards?.length === 0 && <tr><td colSpan={6} style={emptyStyle}>No gift cards {status !== 'all' ? `(${status})` : ''} yet.</td></tr>}
            {cards?.map(g => (
              <tr key={g.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer' }}
                  onClick={() => copy(g.code)} title="Click to copy">
                  {g.code}
                </td>
                <td style={{ ...tdStyle, color: '#4ade80', fontWeight: 600 }}>+{Number(g.credits)}</td>
                <td style={tdStyle}>
                  {g.redeemed_by ? (
                    <span title={g.redeemed_at ? new Date(g.redeemed_at).toLocaleString() : ''}
                      style={{ color: '#c084fc', background: 'rgba(192,132,252,0.12)', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                      redeemed · {g.redeemed_by_email || `user #${g.redeemed_by}`}
                    </span>
                  ) : (
                    <span style={{ color: '#4ade80', background: 'rgba(74,222,128,0.12)', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                      unused
                    </span>
                  )}
                </td>
                <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.55)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.note || '—'}</td>
                <td style={tdStyle}>{g.expires_at ? new Date(g.expires_at).toLocaleDateString() : 'never'}</td>
                <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.4)' }}>{new Date(g.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputStyle = {
  height: 36, padding: '0 12px', borderRadius: 10,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', colorScheme: 'dark',
};
const btnStyle = {
  height: 32, padding: '0 12px', borderRadius: 10, cursor: 'pointer',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
};
const primaryBtnStyle = {
  height: 36, padding: '0 16px', borderRadius: 10, cursor: 'pointer',
  background: '#e0442c', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
  fontFamily: 'inherit',
};
const panelStyle = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12, padding: 16,
};
const panelTitleStyle = { fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 12 };
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600,
  color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.03)', whiteSpace: 'nowrap',
};
const tdStyle = { padding: '10px 14px', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' };
const emptyStyle = { padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.35)' };
