// ─── WorkshopsPanel ──────────────────────────────────────────────────────────
// Money in against money out, per workshop. Tier 1.2.
//
// Distinct from this tab's "Profit Check" screen, which asks a pricing
// question — "if a customer spent a whole plan on one model, what margin would
// that be?" This asks a bookkeeping one: we invoiced $845, the attendees burned
// N credits, did we make money?
//
// The panel could not answer that before because the revenue half of the
// business has never existed in the database. Supplier cost is known to the
// cent; what each workshop was invoiced lived only in documents on a laptop.
//
// THE RULE THIS SCREEN IS BUILT AROUND: 32 of 82 active models have no supplier
// cost on file. Where too little of a cohort's spend can be costed, the margin
// cell says WHY rather than showing a number — because a flattering wrong
// margin is the number that would set the next workshop's price.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

const money = (n, cur = 'USD') =>
  n === null || n === undefined ? '—'
    : `${cur === 'USD' ? '$' : `${cur} `}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BLANK = {
  organisation_id: '', title: '', workshop_date: '', seats: '', promo_code: '',
  invoiced_amount: '', currency: 'USD', invoice_ref: '', invoice_status: 'issued', notes: '',
};

export default function WorkshopsPanel({ onError }) {
  const [data, setData] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [form, setForm] = useState(null);         // null = closed
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, o] = await Promise.all([adminApi.workshops(), adminApi.organisations()]);
      setData(w);
      setOrgs(o.organisations || []);
    } catch (e) { onError?.(e); setData({ workshops: [], summary: null, unlinked_codes: [] }); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      let orgId = form.organisation_id;
      // Typing a new organisation name creates it — one less screen to visit
      // for what is nearly always a one-line record.
      if (form.new_org?.trim()) {
        const created = await adminApi.organisationCreate({ name: form.new_org.trim() });
        orgId = created.id;
      }
      const body = { ...form, organisation_id: orgId || null };
      delete body.new_org;
      if (form.id) await adminApi.workshopUpdate(form.id, body);
      else await adminApi.workshopCreate(body);
      toast.success(form.id ? 'Workshop updated.' : 'Workshop recorded.');
      setForm(null);
      await load();
    } catch (e) { onError?.(e); toast.error(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const remove = async (w) => {
    if (!window.confirm(`Delete "${w.title || w.promo_code}"?\n\nThis removes the invoice record only. No customer, credit or generation is touched.`)) return;
    try { await adminApi.workshopDelete(w.id); toast.success('Removed.'); await load(); }
    catch (e) { onError?.(e); toast.error(e?.message || 'Could not delete.'); }
  };

  const rows = data?.workshops || [];
  const s = data?.summary;
  const unlinked = data?.unlinked_codes || [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--crm-w55)', maxWidth: '72ch', lineHeight: 1.6 }}>
          What each workshop was <b>invoiced</b>, against what its attendees actually cost us with
          the suppliers. The promo code is the link — it identifies who attended, which is what
          makes their supplier cost attributable at all.
        </div>
        <button onClick={() => setForm({ ...BLANK })} style={{ ...btn, marginLeft: 'auto' }}>
          + Record a workshop
        </button>
      </div>

      {s && rows.length > 0 && (
        <div style={cards}>
          <Card k="Invoiced" v={money(s.invoiced_usd)} n={`${s.workshops} workshop(s)`} />
          <Card k="Supplier cost" v={money(s.supplier_cost_usd)} n="fal + kie, attributed" />
          <Card k="Gross profit" v={money(s.gross_profit_usd)}
            n={s.margin_pct !== null ? `${s.margin_pct}% margin` : ''}
            tone={s.margin_pct === null ? '' : s.margin_pct >= 40 ? 'ok' : s.margin_pct >= 20 ? 'warn' : 'crit'} />
          {/* The headline is only as good as its worst row, and says so. */}
          <Card k="Fully costed" v={s.stated_of} n={s.complete ? 'every row' : 'the rest are estimates'}
            tone={s.complete ? 'ok' : 'warn'} />
        </div>
      )}

      {data && !rows.length && (
        <div style={{ ...box, color: 'var(--crm-w55)' }}>
          No workshops recorded yet. Add one and this becomes a real P&L —
          <b> what you invoiced against what it cost</b>.
          {unlinked.length > 0 && <> Your promo codes below are the fastest place to start.</>}
        </div>
      )}

      {/* ── the table ── */}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>{['Workshop', 'Date', 'Seats', 'Attendees', 'Invoiced', 'Supplier cost', 'Margin', 'Status', '']
                .map((h, i) => <th key={i} style={{ ...th, textAlign: i >= 2 && i <= 6 ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td style={td}>
                    <div style={{ color: 'var(--crm-ink)', fontWeight: 600 }}>{w.title || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--crm-w45)' }}>
                      {w.organisation || 'no organisation'}{w.promo_code ? ` · ${w.promo_code}` : ' · no code linked'}
                    </div>
                  </td>
                  <td style={td}>{w.workshop_date ? String(w.workshop_date).slice(0, 10) : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{w.seats ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {w.attendees ?? '—'}
                    {w.seats && w.attendees !== null && w.attendees !== w.seats && (
                      <div style={{ fontSize: 10.5, color: 'var(--crm-amber)' }}>
                        {w.attendees < w.seats ? `${w.seats - w.attendees} never signed in` : `${w.attendees - w.seats} over`}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{money(w.invoiced_usd, w.currency)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {money(w.supplier_cost_usd)}
                    {w.costed_pct !== null && w.costed_pct < 100 && (
                      <div style={{ fontSize: 10.5, color: 'var(--crm-amber)' }}>
                        {w.costed_pct}% costed
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {w.margin_pct !== null ? (
                      <span style={{
                        ...pill,
                        background: w.margin_pct >= 40 ? 'var(--crm-green-bg)' : w.margin_pct >= 20 ? 'var(--crm-amber-bg)' : 'var(--crm-red-bg)',
                        color: w.margin_pct >= 40 ? 'var(--crm-green)' : w.margin_pct >= 20 ? 'var(--crm-amber)' : 'var(--crm-red)',
                      }}>{w.margin_pct}%</span>
                    ) : (
                      // Never a dash on its own — an empty cell reads as zero.
                      <span style={{ fontSize: 11, color: 'var(--crm-w40)' }} title={w.unstated_because}>
                        can’t say yet
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{
                      ...pill,
                      background: w.invoice_status === 'paid' ? 'var(--crm-green-bg)' : 'var(--crm-w06)',
                      color: w.invoice_status === 'paid' ? 'var(--crm-green)' : 'var(--crm-w55)',
                    }}>{w.invoice_status}</span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={miniBtn} onClick={() => setForm({
                      ...BLANK, ...w,
                      workshop_date: w.workshop_date ? String(w.workshop_date).slice(0, 10) : '',
                      organisation_id: w.organisation_id || '',
                    })}>Edit</button>
                    <button style={miniBtn} onClick={() => remove(w)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Why any margin is missing, stated once rather than per row. */}
      {rows.some((w) => w.margin_pct === null) && (
        <div style={{ ...box, borderColor: 'var(--crm-amber-br)', background: 'var(--crm-amber-bg)', color: 'var(--crm-amber)' }}>
          <b>Some margins can’t be stated yet.</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
            {rows.filter((w) => w.margin_pct === null).map((w) => (
              <li key={w.id}>{w.title || w.promo_code}: {w.unstated_because}</li>
            ))}
          </ul>
          <div style={{ marginTop: 6, fontSize: 11.5 }}>
            A margin computed from partly-costed spend looks better than the truth, and it is the
            number that would set your next price. Filling the missing supplier costs on the
            <b> Model Credits</b> screen closes this.
          </div>
        </div>
      )}

      {/* ── codes with no workshop recorded ── */}
      {unlinked.length > 0 && (
        <details style={{ marginTop: 18 }} open={!rows.length}>
          <summary style={{ cursor: 'pointer', color: 'var(--crm-w72)', fontSize: 13, fontWeight: 600 }}>
            Promo codes with attendees but no workshop recorded ({unlinked.length})
          </summary>
          <div style={{ ...box, marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--crm-w55)', marginBottom: 8 }}>
              These cohorts exist and have spent money with your suppliers. Recording the invoice
              against one turns it into a P&amp;L row.
            </div>
            {unlinked.map((c) => (
              <div key={c.code} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', flexWrap: 'wrap' }}>
                <code style={{ color: 'var(--crm-ink)', fontSize: 12.5 }}>{c.code}</code>
                <span style={{ fontSize: 11.5, color: 'var(--crm-w45)' }}>
                  {c.attendees} attendee(s) · first redeemed {c.first_redeemed}
                </span>
                <button style={{ ...miniBtn, marginLeft: 'auto' }}
                  onClick={() => setForm({ ...BLANK, promo_code: c.code, seats: c.attendees, workshop_date: c.first_redeemed })}>
                  Record this one
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── the form ── */}
      {form && (
        <div style={{ ...box, marginTop: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--crm-ink)', marginBottom: 10 }}>
            {form.id ? 'Edit workshop' : 'Record a workshop'}
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            <F label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })}
               placeholder="Riyadh · August" />
            <div>
              <label style={lbl}>Organisation</label>
              <select style={inp} value={form.organisation_id}
                onChange={(e) => setForm({ ...form, organisation_id: e.target.value })}>
                <option value="">— none —</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <input style={{ ...inp, marginTop: 6 }} placeholder="…or type a new one"
                value={form.new_org || ''} onChange={(e) => setForm({ ...form, new_org: e.target.value })} />
            </div>
            <F label="Date" type="date" value={form.workshop_date}
               onChange={(v) => setForm({ ...form, workshop_date: v })} />
            <F label="Seats booked" type="number" value={form.seats}
               onChange={(v) => setForm({ ...form, seats: v })} />
            <F label="Promo code" value={form.promo_code}
               onChange={(v) => setForm({ ...form, promo_code: v.toUpperCase() })}
               placeholder="VOXEL-XXXX-XXXX"
               hint="This is what links the invoice to who attended — and therefore to what they cost." />
            <F label="Amount invoiced" type="number" value={form.invoiced_amount}
               onChange={(v) => setForm({ ...form, invoiced_amount: v })} placeholder="845.00" />
            <div>
              <label style={lbl}>Currency</label>
              <select style={inp} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {['USD', 'KWD', 'SAR', 'AED', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <F label="Invoice reference" value={form.invoice_ref}
               onChange={(v) => setForm({ ...form, invoice_ref: v })} placeholder="INV-2026-014" />
            <div>
              <label style={lbl}>Status</label>
              <select style={inp} value={form.invoice_status}
                onChange={(e) => setForm({ ...form, invoice_status: e.target.value })}>
                <option value="draft">draft</option>
                <option value="issued">issued</option>
                <option value="paid">paid</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={saving} style={{ ...btn, background: 'var(--crm-green-bg)', borderColor: 'var(--crm-green-br)', color: 'var(--crm-green)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setForm(null)} style={btn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ k, v, n, tone }) {
  const fg = tone === 'ok' ? 'var(--crm-green)' : tone === 'warn' ? 'var(--crm-amber)'
    : tone === 'crit' ? 'var(--crm-red)' : 'var(--crm-ink)';
  return (
    <div style={box}>
      <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--crm-w45)' }}>{k}</div>
      <div style={{ fontSize: 22, fontWeight: 730, marginTop: 4, color: fg }}>{v}</div>
      {n && <div style={{ fontSize: 11, color: 'var(--crm-w45)', marginTop: 2 }}>{n}</div>}
    </div>
  );
}

function F({ label, value, onChange, type = 'text', placeholder, hint }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input style={inp} type={type} value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <div style={{ fontSize: 10.5, color: 'var(--crm-w40)', marginTop: 4, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

const box = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 10, padding: '12px 14px', marginBottom: 12,
};
const cards = {
  display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', marginBottom: 14,
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 };
const th = {
  fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--crm-w45)',
  fontWeight: 600, padding: '0 10px 8px 0', borderBottom: '1px solid var(--crm-w10)',
};
const td = { padding: '10px 10px 10px 0', borderBottom: '1px solid var(--crm-w06)', color: 'var(--crm-w85)' };
const btn = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-w85)', cursor: 'pointer', fontFamily: 'inherit',
};
const miniBtn = { ...btn, padding: '4px 9px', fontSize: 11, marginRight: 5 };
const pill = { padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 };
const lbl = { display: 'block', fontSize: 11.5, color: 'var(--crm-w55)', marginBottom: 4, fontWeight: 600 };
const inp = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-ink)', fontFamily: 'inherit',
};
