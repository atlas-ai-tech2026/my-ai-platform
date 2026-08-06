// ─── PromoCodesTab ───────────────────────────────────────────────────────────
// CRM promo-code generation: create reusable marketing codes (credits per
// redemption, optional global cap + expiry, one redemption per user), list
// them with live redemption counts, and toggle them on/off. Users redeem in
// their account's Promocode section via POST /api/redeem-code.
//
// 2026-08-06 additions, all admin-side only — the redemption path a customer
// uses is untouched:
//   1. DESCRIPTION on each code, so months later you can still tell who it was
//      for. Editable after creation.
//   2. EDIT the expiry after creation. Extending a lapsed code revives it
//      immediately, because redemption checks the expiry at redeem time.
//   3. SEARCH across description, code and creator.
//   4. WHO REDEEMED IT — the accounts behind the count, which the database has
//      always recorded but nothing ever displayed.
//
// Credits and the code text stay LOCKED on purpose: the granted amount is
// already written into credits_history, and printed codes are in the wild.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

/** Active / expired / used up — more useful than active-or-not now that
 *  expiry dates are something the admin manages. */
function promoStatus(p) {
  if (!p.active) return { label: 'off', color: '#f87171', bg: 'rgba(248,113,113,0.12)' };
  if (p.expires_at && new Date(p.expires_at) <= new Date()) {
    return { label: 'expired', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' };
  }
  if (p.max_redemptions != null && p.redeemed_count >= p.max_redemptions) {
    return { label: 'used up', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' };
  }
  return { label: 'active', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' };
}

/** yyyy-mm-dd for <input type="date">, in LOCAL time. Using toISOString here
 *  would shift the date by a day for anyone east or west of UTC. */
function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PromoCodesTab({ onError }) {
  const [promos, setPromos] = useState(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  // Create form
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [credits, setCredits] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // Per-row edit + expanded redemption list
  const [editingId, setEditingId] = useState(null);
  const [editDescription, setEditDescription] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [redemptions, setRedemptions] = useState({}); // promo id → rows

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
        description: description.trim() || undefined,
        credits: c,
        max_redemptions: maxRedemptions.trim() || undefined,
        expires_at: expiresAt || undefined,
      });
      toast.success(`Promo created: ${r.promo.code} (+${r.promo.credits} credits per redemption)`);
      setCode(''); setDescription(''); setCredits(''); setMaxRedemptions(''); setExpiresAt('');
      load();
    } catch (e) { onError?.(e, 'Promo creation failed'); }
    finally { setCreating(false); }
  }, [code, description, credits, maxRedemptions, expiresAt, load, onError]);

  const toggle = useCallback(async (p) => {
    try {
      await adminApi.togglePromo(p.id);
      toast.success(`${p.code} ${p.active ? 'deactivated' : 'activated'}`);
      load();
    } catch (e) { onError?.(e, 'Toggle failed'); }
  }, [load, onError]);

  const startEdit = useCallback((p) => {
    setEditingId(p.id);
    setEditDescription(p.description || '');
    setEditExpiresAt(toDateInput(p.expires_at));
  }, []);

  const saveEdit = useCallback(async (p) => {
    setSaving(true);
    try {
      // Send expires_at as null (not undefined) when cleared, so the server
      // knows the difference between "leave it alone" and "never expires".
      await adminApi.updatePromo(p.id, {
        description: editDescription.trim(),
        expires_at: editExpiresAt ? editExpiresAt : null,
      });
      const wasExpired = p.expires_at && new Date(p.expires_at) <= new Date();
      const nowLater = !editExpiresAt || new Date(editExpiresAt) > new Date();
      toast.success(wasExpired && nowLater
        ? `${p.code} updated — it works again for users`
        : `${p.code} updated`);
      setEditingId(null);
      load();
    } catch (e) { onError?.(e, 'Update failed'); }
    finally { setSaving(false); }
  }, [editDescription, editExpiresAt, load, onError]);

  const toggleRedemptions = useCallback(async (p) => {
    if (expandedId === p.id) { setExpandedId(null); return; }
    setExpandedId(p.id);
    if (redemptions[p.id]) return;                 // already fetched
    try {
      const r = await adminApi.promoRedemptions(p.id);
      setRedemptions(prev => ({ ...prev, [p.id]: r.redemptions }));
    } catch (e) { onError?.(e, 'Could not load redemptions'); }
  }, [expandedId, redemptions, onError]);

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${text}`),
      () => toast.error('Copy failed')
    );
  };

  // Search description, code AND creator — you rarely remember which one you
  // know. Filtering client-side keeps it instant; the list is capped at 500.
  const visible = useMemo(() => {
    if (!promos) return promos;
    const q = query.trim().toLowerCase();
    if (!q) return promos;
    return promos.filter(p =>
      (p.description || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      (p.created_by || '').toLowerCase().includes(q)
    );
  }, [promos, query]);

  const COLS = 8;

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
          <input placeholder="Description — who is this for?" value={description}
            onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, minWidth: 260 }} />
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

      {/* Search */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
        <input
          placeholder="Search description, code or creator…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 320px', maxWidth: 460 }}
        />
        {query && (
          <button onClick={() => setQuery('')} style={btnStyle}>Clear</button>
        )}
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
          {promos ? `${visible.length} of ${promos.length}` : ''}
        </span>
      </div>

      {/* List */}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Description', 'Code', 'Credits', 'Redemptions', 'Expires', 'Status', 'Created', ''].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {promos === null && <tr><td colSpan={COLS} style={emptyStyle}>Loading…</td></tr>}
            {promos?.length === 0 && <tr><td colSpan={COLS} style={emptyStyle}>No promo codes yet — create the first one above.</td></tr>}
            {promos?.length > 0 && visible.length === 0 && (
              <tr><td colSpan={COLS} style={emptyStyle}>No promo codes match “{query}”.</td></tr>
            )}
            {visible?.map(p => {
              const status = promoStatus(p);
              const isEditing = editingId === p.id;
              const isExpanded = expandedId === p.id;
              const rows = redemptions[p.id];
              return (
                <React.Fragment key={p.id}>
                  <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ ...tdStyle, maxWidth: 280 }}>
                      {isEditing ? (
                        <input value={editDescription} onChange={e => setEditDescription(e.target.value)}
                          placeholder="Who is this for?" autoFocus
                          style={{ ...inputStyle, width: '100%', minWidth: 200 }} />
                      ) : (
                        <span style={{ color: p.description ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                          {p.description || '—'}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer' }}
                      onClick={() => copy(p.code)} title="Click to copy">
                      {p.code}
                    </td>
                    <td style={{ ...tdStyle, color: '#4ade80', fontWeight: 600 }}>+{Number(p.credits)}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => toggleRedemptions(p)}
                        title={p.redeemed_count ? 'Show the accounts that redeemed this' : 'Nobody has redeemed this yet'}
                        style={{
                          ...btnStyle, padding: '2px 10px',
                          color: p.redeemed_count ? '#fff' : 'rgba(255,255,255,0.4)',
                        }}>
                        {p.redeemed_count}{p.max_redemptions != null ? ` / ${p.max_redemptions}` : ' / ∞'}
                        {p.redeemed_count > 0 && <span style={{ marginLeft: 6 }}>{isExpanded ? '▾' : '▸'}</span>}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <input type="date" value={editExpiresAt}
                          onChange={e => setEditExpiresAt(e.target.value)}
                          title="Blank = never expires"
                          style={{ ...inputStyle, width: 150 }} />
                      ) : (
                        p.expires_at ? new Date(p.expires_at).toLocaleDateString() : 'never'
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        color: status.color, background: status.bg,
                        padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                      }}>
                        {status.label}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: 'rgba(255,255,255,0.4)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(p)} disabled={saving} style={primaryBtnStyle}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} style={{ ...btnStyle, marginLeft: 6 }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(p)} style={btnStyle}>Edit</button>
                          <button onClick={() => toggle(p)} style={{ ...btnStyle, marginLeft: 6 }}>
                            {p.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>

                  {/* Who redeemed it — the accounts behind the count. */}
                  {isExpanded && (
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <td colSpan={COLS} style={{ padding: '12px 14px 16px' }}>
                        {!rows && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Loading…</div>}
                        {rows?.length === 0 && (
                          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                            Nobody has redeemed {p.code} yet.
                          </div>
                        )}
                        {rows?.length > 0 && (
                          <>
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 8 }}>
                              {rows.length} account{rows.length === 1 ? '' : 's'} redeemed {p.code}
                            </div>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                              gap: 6,
                            }}>
                              {rows.map(r => (
                                <div key={r.user_id} style={{
                                  display: 'flex', justifyContent: 'space-between', gap: 10,
                                  padding: '6px 10px', borderRadius: 8,
                                  background: 'rgba(255,255,255,0.04)', fontSize: 12,
                                }}>
                                  <span style={{ color: r.banned ? '#f87171' : '#fff' }}>
                                    {r.email}{r.banned ? ' (banned)' : ''}
                                  </span>
                                  <span style={{ color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                                    {new Date(r.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputStyle = {
  height: 36, padding: '0 12px', background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
  color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit',
};
const btnStyle = {
  height: 32, padding: '0 12px', background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
  color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
const primaryBtnStyle = {
  height: 36, padding: '0 18px', background: '#e0442c', border: 'none',
  borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const panelStyle = {
  padding: 16, background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
};
const panelTitleStyle = { fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 12 };
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.03)',
  whiteSpace: 'nowrap',
};
const tdStyle = { padding: '10px 14px', color: 'rgba(255,255,255,0.85)' };
const emptyStyle = { padding: '24px 14px', textAlign: 'center', color: 'rgba(255,255,255,0.35)' };
