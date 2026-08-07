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
import Field, { FieldRow, buttonRowOffset } from './FormField';
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

/**
 * Headline numbers for the promo dashboard.
 *
 * "Credits outstanding" is the honest one to get right: it is what you could
 * still be liable for, i.e. for each usable code, (cap - already redeemed) ×
 * credits. Codes with NO cap are unbounded — they are counted separately
 * rather than silently treated as zero, which would understate the exposure.
 */
function promoTotals(promos) {
  const t = {
    total: 0, active: 0, inactive: 0, usable: 0,
    expired: 0, usedUp: 0,
    creditsOutstanding: 0, uncappedCodes: 0, redemptions: 0,
    creditsGranted: 0,
  };
  const now = new Date();
  for (const p of promos || []) {
    t.total += 1;
    const credits = Number(p.credits) || 0;
    const used = Number(p.redeemed_count) || 0;
    t.redemptions += used;
    t.creditsGranted += used * credits;

    if (!p.active) { t.inactive += 1; continue; }
    t.active += 1;

    const expired = p.expires_at && new Date(p.expires_at) <= now;
    const cappedOut = p.max_redemptions != null && used >= p.max_redemptions;
    if (expired) t.expired += 1;
    if (cappedOut) t.usedUp += 1;
    if (expired || cappedOut) continue;

    // Genuinely redeemable right now.
    t.usable += 1;
    if (p.max_redemptions == null) t.uncappedCodes += 1;
    else t.creditsOutstanding += Math.max(0, p.max_redemptions - used) * credits;
  }
  return t;
}

const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PromoCodesTab({ onError }) {
  const [promos, setPromos] = useState(null);
  const [creating, setCreating] = useState(false);
  // Required boxes go red only after a create attempt, not while typing.
  const [tried, setTried] = useState(false);
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

  const missCredits = tried && !(Number(credits) > 0);

  const create = useCallback(async () => {
    setTried(true);
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

  // Always over ALL codes, never the filtered view — a dashboard that changed
  // as you typed a search would be misleading.
  const totals = useMemo(() => promoTotals(promos), [promos]);

  const COLS = 8;

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 16 }}>
        Reusable marketing codes. Each user can redeem a code once; the optional
        “max redemptions” caps total uses across all users. Users enter codes in
        their account’s Promocode section.
      </div>

      {/* Dashboard */}
      <div style={{
        display: 'grid', gap: 10, marginBottom: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
      }}>
        <Stat label="Promo codes created" value={promos ? fmt(totals.total) : '—'}
          note={promos ? `${fmt(totals.redemptions)} redemptions so far` : ''} />
        <Stat label="Active" value={promos ? fmt(totals.active) : '—'}
          note={promos ? `${fmt(totals.inactive)} deactivated` : ''} color="#4ade80" />
        <Stat label="Usable right now" value={promos ? fmt(totals.usable) : '—'}
          note={promos
            ? [totals.expired ? `${totals.expired} expired` : null,
               totals.usedUp ? `${totals.usedUp} used up` : null]
              .filter(Boolean).join(' · ') || 'none expired or used up'
            : ''}
          color="#60a5fa" />
        <Stat label="Credits outstanding" value={promos ? fmt(totals.creditsOutstanding) : '—'}
          note={promos
            ? (totals.uncappedCodes
                ? `+ ${totals.uncappedCodes} code${totals.uncappedCodes === 1 ? '' : 's'} with no limit`
                : 'across usable codes')
            : ''}
          color="#fbbf24" />
      </div>

      {/* Create form */}
      <div style={panelStyle}>
        <div style={panelTitleStyle}>Create promo code</div>
        {/* Every box carries a permanent label, an ⓘ explaining what goes in
            it, and a red * when it is required. Before this the form was
            placeholder-only — and a placeholder vanishes the moment you type,
            so there was nothing left to tell you what a box was for. */}
        <FieldRow>
          <Field label="Description"
            info="A private note for you — who this code is for, or why you made it. Customers never see it. It is what you will search on later, so “Ramadan campaign — Instagram” beats “promo 3”.">
            <input placeholder="Who is this for?" value={description}
              onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, minWidth: 260 }} />
          </Field>
          <Field label="Code"
            info="The code the customer types to redeem. Leave it empty and one is generated for you. Letters, numbers and hyphens only, 4–64 characters.">
            <input placeholder="Blank = auto-generate" value={code}
              onChange={e => setCode(e.target.value.toUpperCase())} style={{ ...inputStyle, minWidth: 210 }} />
          </Field>
          <Field label="Credits per redemption" required invalid={missCredits}
            message="Enter how many credits each redemption grants"
            info="How many credits land in an account each time someone redeems this code. Must be above zero. This is the only box you have to fill.">
            <input placeholder="e.g. 50" type="number" min="0.5" step="0.5" value={credits}
              aria-required="true" aria-invalid={missCredits}
              onChange={e => setCredits(e.target.value)}
              style={{ ...inputStyle, width: 180, ...(missCredits ? invalidStyle : null) }} />
          </Field>
          <Field label="Max redemptions"
            info="How many times the code may be used in total, across all customers. Leave it empty for unlimited use.">
            <input placeholder="Blank = unlimited" type="number" min="1" value={maxRedemptions}
              onChange={e => setMaxRedemptions(e.target.value)} style={{ ...inputStyle, width: 200 }} />
          </Field>
          <Field label="Expires"
            info="The last day the code works. Leave it empty and it never expires. You can change this later from the table below.">
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
              style={inputStyle} />
          </Field>
          <div style={buttonRowOffset}>
            <button onClick={create} disabled={creating} style={primaryBtnStyle}>
              {creating ? 'Creating…' : '+ Create promo'}
            </button>
          </div>
        </FieldRow>
        <div style={{ color: 'var(--crm-w40)', fontSize: 11.5, marginTop: 10 }}>
          Boxes marked <span style={{ color: '#f87171', fontWeight: 700 }}>*</span> must be filled ·
          press <b>ⓘ</b> beside a box to see exactly what it expects.
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
        <span style={{ color: 'var(--crm-w40)', fontSize: 12 }}>
          {promos ? `${visible.length} of ${promos.length}` : ''}
        </span>
      </div>

      {/* List */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--crm-w08)', borderRadius: 12, marginTop: 12 }}>
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
                  <tr style={{ borderTop: '1px solid var(--crm-w06)' }}>
                    <td style={{ ...tdStyle, maxWidth: 280 }}>
                      {isEditing ? (
                        <input value={editDescription} onChange={e => setEditDescription(e.target.value)}
                          placeholder="Who is this for?" autoFocus
                          style={{ ...inputStyle, width: '100%', minWidth: 200 }} />
                      ) : (
                        <span style={{ color: p.description ? 'var(--crm-ink)' : 'var(--crm-w30)' }}>
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
                          color: p.redeemed_count ? 'var(--crm-ink)' : 'var(--crm-w40)',
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
                    <td style={{ ...tdStyle, color: 'var(--crm-w40)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
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
                    <tr style={{ background: 'var(--crm-w03)' }}>
                      <td colSpan={COLS} style={{ padding: '12px 14px 16px' }}>
                        {!rows && <div style={{ color: 'var(--crm-w40)', fontSize: 12 }}>Loading…</div>}
                        {rows?.length === 0 && (
                          <div style={{ color: 'var(--crm-w40)', fontSize: 12 }}>
                            Nobody has redeemed {p.code} yet.
                          </div>
                        )}
                        {rows?.length > 0 && (
                          <>
                            <div style={{ color: 'var(--crm-w50)', fontSize: 12, marginBottom: 8 }}>
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
                                  background: 'var(--crm-w04)', fontSize: 12,
                                }}>
                                  <span style={{ color: r.banned ? '#f87171' : 'var(--crm-ink)' }}>
                                    {r.email}{r.banned ? ' (banned)' : ''}
                                  </span>
                                  <span style={{ color: 'var(--crm-w40)', whiteSpace: 'nowrap' }}>
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

function Stat({ label, value, note, color }) {
  return (
    <div style={{
      padding: '14px 16px', background: 'var(--crm-w03)',
      border: '1px solid var(--crm-w08)', borderRadius: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--crm-w40)', marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 700, lineHeight: 1.1,
        color: color || 'var(--crm-ink)', fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      {note ? (
        <div style={{ fontSize: 12, color: 'var(--crm-w40)', marginTop: 4 }}>{note}</div>
      ) : null}
    </div>
  );
}

const invalidStyle = { border: '1px solid #f87171', background: 'rgba(248,113,113,0.08)' };
const inputStyle = {
  height: 36, padding: '0 12px', background: 'var(--crm-w04)',
  border: '1px solid var(--crm-w10)', borderRadius: 8,
  color: 'var(--crm-ink)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
};
const btnStyle = {
  height: 32, padding: '0 12px', background: 'var(--crm-w06)',
  border: '1px solid var(--crm-w12)', borderRadius: 8,
  color: 'var(--crm-w85)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
const primaryBtnStyle = {
  height: 36, padding: '0 18px', background: '#e0442c', border: 'none',
  borderRadius: 8, color: 'var(--crm-ink)', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const panelStyle = {
  padding: 16, background: 'var(--crm-w03)',
  border: '1px solid var(--crm-w08)', borderRadius: 12,
};
const panelTitleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--crm-w60)', marginBottom: 12 };
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--crm-w40)', background: 'var(--crm-w03)',
  whiteSpace: 'nowrap',
};
const tdStyle = { padding: '10px 14px', color: 'var(--crm-w85)' };
const emptyStyle = { padding: '24px 14px', textAlign: 'center', color: 'var(--crm-w35)' };
