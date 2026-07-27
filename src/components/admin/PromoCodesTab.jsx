// ─── PromoCodesTab ───────────────────────────────────────────────────────────
// CRM promo-code generation: create reusable marketing codes (credits per
// redemption, optional global cap + expiry, one redemption per user), list
// them with live redemption counts, and toggle them on/off. Users redeem in
// their account's Promocode section via POST /api/redeem-code.

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

export default function PromoCodesTab({ onError }) {
  const [promos, setPromos] = useState(null);
  const [creating, setCreating] = useState(false);

  // Create form
  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await adminApi.listPromos();
      setPromos(r.promos);
    } catch (e) { onError?.(e, 'Promo list failed'); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    const c = Number(credits);
    if (!Number.isFinite(c) || c <= 0) { toast.error('Enter the credits each redemption grants'); return; }
    setCreating(true);
    try {
      const r = await adminApi.createPromo({
        code: code.trim() || undefined,           // blank = auto-generate VOXEL-XXXX-XXXX
        credits: c,
        max_redemptions: maxRedemptions.trim() || undefined,
        expires_at: expiresAt || undefined,
      });
      toast.success(`Promo created: ${r.promo.code} (+${r.promo.credits} credits per redemption)`);
      setCode(''); setCredits(''); setMaxRedemptions(''); setExpiresAt('');
      load();
    } catch (e) { onError?.(e, 'Promo creation failed'); }
    finally { setCreating(false); }
  }, [code, credits, maxRedemptions, expiresAt, load, onError]);

  const toggle = useCallback(async (p) => {
    try {
      await adminApi.togglePromo(p.id);
      toast.success(`${p.code} ${p.active ? 'deactivated' : 'activated'}`);
      load();
    } catch (e) { onError?.(e, 'Toggle failed'); }
  }, [load, onError]);

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${text}`),
      () => toast.error('Copy failed')
    );
  };

  return (
    <div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 16 }}>
        Reusable marketing codes. Each user can redeem a code once; the optional
        “max redemptions” caps total uses across all users. Users enter codes in
        their account’s Promocode section.
      </div>

      {/* Create form */}
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Create promo code</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Code (blank = auto-generate)" value={code}
            onChange={e => setCode(e.target.value.toUpperCase())} style={{ ...inputStyle, minWidth: 210 }} />
          <input placeholder="Credits per redemption *" type="number" min="0.5" step="0.5" value={credits}
            onChange={e => setCredits(e.target.value)} style={{ ...inputStyle, width: 180 }} />
          <input placeholder="Max redemptions (blank = ∞)" type="number" min="1" value={maxRedemptions}
            onChange={e => setMaxRedemptions(e.target.value)} style={{ ...inputStyle, width: 200 }} />
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
            style={inputStyle} title="Expiry (blank = never)" />
          <button onClick={create} disabled={creating} style={primaryBtnStyle}>
            {creating ? 'Creating…' : '+ Create promo'}
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Code', 'Credits', 'Redemptions', 'Expires', 'Status', 'Created', ''].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {promos === null && <tr><td colSpan={7} style={emptyStyle}>Loading…</td></tr>}
            {promos?.length === 0 && <tr><td colSpan={7} style={emptyStyle}>No promo codes yet — create the first one above.</td></tr>}
            {promos?.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer' }}
                  onClick={() => copy(p.code)} title="Click to copy">
                  {p.code}
                </td>
                <td style={{ ...tdStyle, color: '#4ade80', fontWeight: 600 }}>+{Number(p.credits)}</td>
                <td style={tdStyle}>
                  {p.redeemed_count}{p.max_redemptions != null ? ` / ${p.max_redemptions}` : ' / ∞'}
                </td>
                <td style={tdStyle}>{p.expires_at ? new Date(p.expires_at).toLocaleDateString() : 'never'}</td>
                <td style={tdStyle}>
                  <span style={{
                    color: p.active ? '#4ade80' : '#f87171',
                    background: p.active ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                    padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  }}>
                    {p.active ? 'active' : 'off'}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.4)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                <td style={tdStyle}>
                  <button onClick={() => toggle(p)} style={btnStyle}>
                    {p.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
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
