// ─── OffersTab ───────────────────────────────────────────────────────────────
// Create, target and approve promotions, with live margin impact from the
// Costing engine.
//
// Structure and behaviour follow Voxel_Offers_UI_Prototype.html; the colours
// follow the CRM's dark surface (the prototype was authored light). Selects
// carry explicit option colours because unstyled `select option` renders
// black-on-black in dark mode — a reported bug the brief asks to verify.
//
// TWO THINGS THIS SCREEN MUST SAY OUT LOUD:
//   1. Email campaigns are ON HOLD — the checkbox is disabled with a badge.
//   2. "% off" and "$ off" cannot be redeemed yet, because Voxel has no
//      checkout. They are fully costed and approvable so a campaign can be
//      designed now, but a row that looks live and is not would be worse than
//      no feature at all.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '@/lib/adminApi';
import { toast } from 'sonner';
import Field, { adminInput, MissingSummary } from './FormField';

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);
const num = (v) => Number(v || 0).toLocaleString('en-US');
const todayISO = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const TYPES = [
  { key: 'pct',   label: '% discount',          icon: '%', color: '#60a5fa',
    desc: 'Percentage off the plan price — e.g. 15% off Pro.' },
  { key: 'bonus', label: 'Bonus credits',       icon: '✦', color: '#34d399',
    desc: 'Same price, extra credits. Feels big, protects price.' },
  { key: 'days',  label: 'Free days / upgrade', icon: '⏱', color: '#fb923c',
    desc: 'Extend the subscription free, or a higher plan at the same price.' },
  { key: 'fixed', label: 'Fixed amount off',    icon: '$', color: '#a78bfa',
    desc: 'A dollar amount off — e.g. $10 off plans $59 and up.' },
];
const TYPE_BY = Object.fromEntries(TYPES.map((t) => [t.key, t]));
const DEFAULT_VALUE = { pct: 15, bonus: 25, days: 14, fixed: 10 };
const VALUE_LABEL = { pct: 'Discount %', bonus: 'Bonus credits %', days: 'Free days', fixed: 'Amount off ($)' };

export default function OffersTab({ onError }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('list');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try { setData(await adminApi.offersList()); }
    catch (e) { onError?.(e, 'Could not load offers'); }
  }, [onError]);
  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (r?.offers) setData((d) => ({ ...d, ...r })); if (okMsg) toast.success(okMsg); return r; }
    catch (e) { onError?.(e, 'That did not work'); return null; }
    finally { setBusy(false); }
  }, [onError]);

  if (!data) return <div style={muted}>Loading offers…</div>;

  const offers = data.offers || [];
  const S = data.settings || {};
  const active = offers.filter((o) => o.effective_status === 'active').length;
  const scheduled = offers.filter((o) => o.effective_status === 'scheduled').length;
  const uses = offers.reduce((s, o) => s + Number(o.uses || 0), 0);

  return (
    <div>
      <div style={{
        padding: '10px 14px', marginBottom: 14, borderRadius: 10, fontSize: 13,
        background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.35)',
        color: 'var(--crm-w85)',
      }}>
        <b>Offers use the Costing engine's margin target.</b> Approving an offer records it and
        writes the audit trail — it does not itself take money or grant credits.
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Stat label="Active offers" value={num(active)} note="running now" color="#4ade80" />
        <Stat label="Scheduled" value={num(scheduled)} note="starting soon" color="#60a5fa" />
        <Stat label="Redemptions" value={num(uses)} note="all time" />
        <Stat label="Margin floor" value={pct(S.margin_floor)} note="offers below need approval" color="#fbbf24" />
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--crm-w10)', marginBottom: 12 }}>
        {[['list', 'Offers'], ['create', '＋ Create offer']].map(([id, label]) => (
          <button key={id} onClick={() => { setView(id); setDetail(null); }} style={{
            border: 'none', background: 'none', padding: '9px 14px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 14,
            color: view === id ? 'var(--crm-ink)' : 'var(--crm-w45)',
            fontWeight: view === id ? 700 : 500,
            borderBottom: view === id ? '2px solid #e0442c' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>

      {view === 'list' && !detail && (
        <OffersList offers={offers} busy={busy}
          onPause={(id) => act(() => adminApi.offerPause(id), 'Offer paused')}
          onResume={(id) => act(() => adminApi.offerResume(id), 'Offer resumed')}
          onApprove={(id, bf) => act(() => adminApi.offerApprove(id, bf), 'Offer approved')}
          onOpen={async (id) => {
            const r = await act(() => adminApi.offerStats(id));
            if (r) setDetail(r);
          }} />
      )}

      {view === 'list' && detail && <OfferDetail data={detail} onBack={() => setDetail(null)} />}

      {view === 'create' && (
        <CreateOffer data={data} busy={busy} onError={onError}
          onSaved={async (r, approved) => {
            if (r?.offers) setData((d) => ({ ...d, ...r }));
            toast.success(approved ? 'Offer created and approved' : 'Draft saved');
            setView('list');
            await load();
          }} />
      )}
    </div>
  );
}

// ─── list ────────────────────────────────────────────────────────────────────
function OffersList({ offers, busy, onPause, onResume, onApprove, onOpen }) {
  if (!offers.length) {
    return <div style={{ ...panel, ...muted }}>No offers yet. Use “＋ Create offer” to build one.</div>;
  }
  const unit = { pct: '% off', bonus: '% bonus credits', days: ' free days', fixed: '$ off' };
  return (
    <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            {['Offer', 'Type', 'Applies to', 'Audience', 'Delivery', 'Period', 'Renewals'].map((h) => (
              <th key={h} style={{ ...th, textAlign: 'left' }}>{h}</th>
            ))}
            <th style={th}>Uses</th>
            <th style={{ ...th, textAlign: 'left' }}>Status</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const t = TYPE_BY[o.type] || {};
            const st = o.effective_status;
            return (
              <tr key={o.id} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                <td style={{ ...td, textAlign: 'left' }}>
                  <button onClick={() => onOpen(o.id)} style={linkBtn}>{o.name}</button>
                  {o.requires_checkout && (
                    <span title="Voxel has no checkout yet, so this offer cannot be redeemed"
                      style={badge('#fbbf24')}>NEEDS CHECKOUT</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 20, height: 20, borderRadius: 6, marginRight: 7, fontSize: 12,
                    background: `${t.color}22`, color: t.color,
                  }}>{t.icon}</span>
                  {Number(o.value)}{unit[o.type]}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>{(o.plan_ids || []).length} plan(s)</td>
                <td style={{ ...td, textAlign: 'left' }}>
                  {o.audience_mode === 'all' ? 'Everyone'
                    : o.audience_mode === 'picked' ? `Hand-picked (${o.picked_count})`
                    : 'Segment'}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>
                  {[o.delivery_code && (o.code ? `Code ${o.code}` : 'Code'),
                    o.delivery_auto && 'Auto',
                    o.delivery_email && 'Email (on hold)'].filter(Boolean).join(' + ') || '—'}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>
                  {String(o.starts_at).slice(0, 10)} → {String(o.ends_at).slice(0, 10)}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>
                  {o.renewal_rule === 'months' ? `First ${o.renewal_months} months`
                    : o.renewal_rule === 'forever' ? 'Lifetime' : 'First payment'}
                </td>
                <td style={td}>{num(o.uses)}</td>
                <td style={{ ...td, textAlign: 'left' }}><StatusPill status={st} /></td>
                <td style={td}>
                  {st === 'draft' && (
                    <button disabled={busy} style={smallBtn} onClick={() => onApprove(o.id, false)}>Approve</button>
                  )}
                  {st === 'active' && (
                    <button disabled={busy} style={smallBtn} onClick={() => onPause(o.id)}>Pause</button>
                  )}
                  {st === 'paused' && (
                    <button disabled={busy} style={smallBtn} onClick={() => onResume(o.id)}>Resume</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }) {
  const c = {
    active:    ['rgba(74,222,128,0.15)', '#4ade80'],
    scheduled: ['rgba(96,165,250,0.15)', '#60a5fa'],
    draft:     ['rgba(251,191,36,0.15)', '#fbbf24'],
    paused:    ['var(--crm-w08)', 'var(--crm-w50)'],
    expired:   ['var(--crm-w08)', 'var(--crm-w50)'],
  }[status] || ['var(--crm-w08)', 'var(--crm-w50)'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 11px 3px 8px',
      borderRadius: 20, fontSize: 11.5, fontWeight: 650, background: c[0], color: c[1],
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
      {status}
    </span>
  );
}

// ─── create ──────────────────────────────────────────────────────────────────
function CreateOffer({ data, busy, onSaved, onError }) {
  const plans = data.plans || [];
  const S = data.settings || {};
  const [name, setName] = useState('');
  const [type, setType] = useState('pct');
  const [value, setValue] = useState(DEFAULT_VALUE.pct);
  const [planIds, setPlanIds] = useState(plans.map((p) => p.id));
  const [aud, setAud] = useState('all');
  const [seg, setSeg] = useState({});
  const [segPreview, setSegPreview] = useState(null);
  const [picked, setPicked] = useState([]);
  const [pickQuery, setPickQuery] = useState('');
  const [pickResults, setPickResults] = useState([]);
  const [dCode, setDCode] = useState(true);
  const [dAuto, setDAuto] = useState(false);
  const [code, setCode] = useState('');
  const [starts, setStarts] = useState(todayISO());
  const [ends, setEnds] = useState(plusDays(10));
  const [renew, setRenew] = useState('first');
  const [renewN, setRenewN] = useState(3);
  const [perClient, setPerClient] = useState(1);
  const [maxTotal, setMaxTotal] = useState('');
  const [impact, setImpact] = useState(null);
  const [errs, setErrs] = useState([]);
  const [confirmBelow, setConfirmBelow] = useState(false);
  // Required boxes turn red only after Submit & approve has been pressed.
  // "Save as draft" deliberately never validates — a draft is a scratchpad.
  const [tried, setTried] = useState(false);

  // Mirrors localErrors() below, per box, so the red border and the error list
  // can never disagree about what is missing.
  const missing = {
    name: !name.trim(),
    // The server requires a positive value (offers-engine validateForApproval)
    // but the client never checked it — an offer with value 0 was rejected only
    // after the round trip, with no box highlighted.
    value: !(Number(value) > 0),
    code: dCode && !code.trim(),
  };
  const miss = tried ? missing : { name: false, value: false, code: false };

  // Margin impact is computed by the SERVER so the number the owner approves
  // is the number the approval gate will use — a second implementation here
  // could disagree with it, and the disagreement would only show at approval.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminApi.offerMarginImpact({ type, value, plan_ids: planIds });
        if (!cancelled) setImpact(r);
      } catch { if (!cancelled) setImpact(null); }
    })();
    return () => { cancelled = true; };
  }, [type, value, planIds]);

  // Debounced: every keystroke in a filter would otherwise be a table scan.
  useEffect(() => {
    if (aud !== 'segment') { setSegPreview(null); return; }
    const t = setTimeout(async () => {
      try { setSegPreview(await adminApi.offerSegmentPreview(seg)); }
      catch (e) { onError?.(e, 'Could not preview that segment'); }
    }, 400);
    return () => clearTimeout(t);
  }, [aud, seg, onError]);

  useEffect(() => {
    if (aud !== 'picked') return;
    const t = setTimeout(async () => {
      if (!pickQuery.trim()) { setPickResults([]); return; }
      try { const r = await adminApi.searchUsers(pickQuery.trim()); setPickResults(r?.users || r || []); }
      catch { setPickResults([]); }
    }, 350);
    return () => clearTimeout(t);
  }, [aud, pickQuery]);

  const selectedPlans = useMemo(
    () => plans.filter((p) => planIds.includes(p.id)), [plans, planIds]);

  const belowFloor = impact?.violates_floor;

  function body() {
    return {
      name, type, value, plan_ids: planIds, audience_mode: aud,
      segment_json: aud === 'segment' ? seg : null,
      picked_client_ids: aud === 'picked' ? picked.map((p) => p.id) : [],
      renewal_rule: renew, renewal_months: renew === 'months' ? renewN : null,
      delivery_code: dCode, delivery_auto: dAuto, delivery_email: false,
      starts_at: starts, ends_at: ends,
      max_per_client: perClient, max_total: maxTotal === '' ? null : Number(maxTotal),
      code: dCode ? code.trim().toUpperCase() : '',
    };
  }

  /**
   * Problems with no single box to point at — the per-box ones are in
   * `missing` above and are shown as red borders instead of listed here.
   */
  function localErrors() {
    const e = [];
    if (!planIds.length) e.push('select at least one plan');
    if (!dCode && !dAuto) e.push('choose at least one delivery channel');
    if (aud === 'picked' && !picked.length) e.push('pick at least one client');
    if (aud === 'segment' && segPreview?.count === 0) e.push('segment matches 0 clients');
    if (ends < starts) e.push('the end date is before the start date');
    return e;
  }

  async function save(approve) {
    // A draft is a scratchpad — never validated, so work in progress can
    // always be saved. Only approval has to be complete.
    if (approve) setTried(true);
    const e = approve ? localErrors() : [];
    const boxesMissing = approve && Object.values(missing).some(Boolean);
    if (e.length || boxesMissing) { setErrs(e); return; }
    setErrs([]);
    try {
      const created = await adminApi.offerCreate(body());
      if (!approve) return onSaved(created, false);
      const r = await adminApi.offerApprove(created.offer.id, belowFloor && confirmBelow);
      onSaved(r, true);
    } catch (err) {
      if (err?.body?.errors) setErrs(err.body.errors);
      else onError?.(err, 'Could not save the offer');
    }
  }

  return (
    <div>
      {/* 1 — what */}
      <Card step="1" title="What is the offer?" why="Choose the type, the value, and which plans it applies to.">
        <Field label="Offer name" required invalid={miss.name}
          message="Give the offer a name"
          info="Your own name for this campaign, shown in the offers list and the audit trail. Customers do not see it. Something you will recognise later — “National Day 15%” beats “offer 2”.">
          <input value={name} onChange={(e) => setName(e.target.value)}
            aria-required="true" aria-invalid={miss.name}
            placeholder="e.g. National Day 15%" style={{ ...adminInput(miss.name), width: 280 }} />
        </Field>
        <div style={{ display: 'grid', gap: 10, marginTop: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))' }}>
          {TYPES.map((t) => {
            const sel = type === t.key;
            return (
              <button key={t.key} type="button"
                onClick={() => { setType(t.key); setValue(DEFAULT_VALUE[t.key]); }}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                  fontFamily: 'inherit', position: 'relative',
                  background: sel ? `${t.color}14` : 'var(--crm-w03)',
                  border: `1.5px solid ${sel ? t.color : 'var(--crm-w10)'}`,
                }}>
                {sel && <span style={{
                  position: 'absolute', top: 9, right: 10, width: 19, height: 19, borderRadius: '50%',
                  background: t.color, color: '#0b0b0b', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✓</span>}
                <div style={{
                  width: 34, height: 34, borderRadius: 9, marginBottom: 7, fontSize: 17,
                  background: `${t.color}22`, color: t.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{t.icon}</div>
                <div style={{ fontWeight: 650, color: 'var(--crm-ink)' }}>
                  {t.label}
                  {(t.key === 'pct' || t.key === 'fixed') && <span style={badge('#fbbf24')}>NEEDS CHECKOUT</span>}
                </div>
                <div style={{ color: 'var(--crm-w55)', fontSize: 12, marginTop: 2 }}>{t.desc}</div>
              </button>
            );
          })}
        </div>

        {(type === 'pct' || type === 'fixed') && (
          <div style={{ ...noteBox('#fbbf24'), marginTop: 12 }}>
            <b>This offer cannot be redeemed yet.</b> Voxel has no checkout, so there is no price
            to reduce. You can design, cost and approve it now — it will start working the day a
            payment flow exists. Bonus credits and free days work today.
          </div>
        )}

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}>
          <Field label={VALUE_LABEL[type]} required invalid={miss.value}
            message="Enter a value above zero"
            info={{
              pct: 'The percentage taken off the plan price. 15 means the client pays 85% of the normal price.',
              bonus: 'Extra credits as a percentage of the plan’s normal allowance. 25 means a 300-credit plan gives 375.',
              days: 'How many days of the plan the client gets free. The price does not change — this is a cost to you, shown in step 5.',
              fixed: 'A flat dollar amount off the plan price. It cannot be more than the price itself.',
            }[type]}>
            <input type="number" min="1" value={value}
              aria-required="true" aria-invalid={miss.value}
              onChange={(e) => setValue(Number(e.target.value))}
              style={{ ...adminInput(miss.value), width: 110 }} />
          </Field>
          <Field label="Applies to plans">
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <Chip sel={planIds.length === plans.length}
                onClick={() => setPlanIds(planIds.length === plans.length ? [] : plans.map((p) => p.id))}>
                All plans
              </Chip>
              {plans.map((p) => (
                <Chip key={p.id} sel={planIds.includes(p.id)}
                  onClick={() => setPlanIds((ids) =>
                    ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id])}>
                  {p.name} ${p.price_usd}
                </Chip>
              ))}
            </div>
          </Field>
        </div>
      </Card>

      {/* 2 — who */}
      <Card step="2" title="Who gets it?" why="Everyone, a filtered segment, or hand-picked clients — with a live preview of who matches.">
        <div style={{ marginBottom: 11, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[['all', 'Everyone (public)'], ['segment', 'Filtered segment'], ['picked', 'Hand-picked clients']]
            .map(([v, l]) => (
              <label key={v} style={radio}>
                <input type="radio" name="aud" value={v} checked={aud === v}
                  onChange={() => setAud(v)} /> {l}
              </label>
            ))}
        </div>

        {aud === 'segment' && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
            <Field label="On plan">
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {plans.map((p) => (
                  <Chip key={p.id} sel={(seg.plans || []).includes(p.name)}
                    onClick={() => setSeg((s) => {
                      const cur = s.plans || [];
                      return { ...s, plans: cur.includes(p.name) ? cur.filter((x) => x !== p.name) : [...cur, p.name] };
                    })}>{p.name}</Chip>
                ))}
              </div>
            </Field>
            {[['months_min', 'Months subscribed ≥'], ['usage_min', 'Credits used / month ≥'],
              ['inactive_min', 'Inactive ≥ days'], ['remaining_lt', 'Credits remaining < %']].map(([k, l]) => (
              <Field key={k} label={l}>
                <input type="number" min="0" placeholder="any" style={{ ...input, width: 110 }}
                  value={seg[k] ?? ''}
                  onChange={(e) => setSeg((s) => ({ ...s, [k]: e.target.value === '' ? null : Number(e.target.value) }))} />
              </Field>
            ))}
          </div>
        )}

        {aud === 'picked' && (
          <div>
            <Field label="Search clients">
              <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)}
                placeholder="email…" style={{ ...input, width: 280 }} />
            </Field>
            <div style={{ maxHeight: 230, overflow: 'auto', border: '1px solid var(--crm-w08)',
              borderRadius: 9, marginTop: 8 }}>
              {pickResults.map((u) => {
                const on = picked.some((p) => p.id === u.id);
                return (
                  <label key={u.id} style={{
                    display: 'flex', gap: 9, padding: '6px 11px', alignItems: 'center',
                    borderBottom: '1px solid var(--crm-w06)', cursor: 'pointer', fontSize: 12.5,
                  }}>
                    <input type="checkbox" checked={on} onChange={() => setPicked((ps) =>
                      on ? ps.filter((p) => p.id !== u.id) : [...ps, u])} />
                    <b style={{ color: 'var(--crm-ink)' }}>{u.email}</b>
                    <span style={muted}>· {u.package || 'no plan'} · {num(u.credits)} cr</span>
                  </label>
                );
              })}
              {!pickResults.length && <div style={{ ...muted, padding: 11 }}>Search by email to add clients.</div>}
            </div>
            <div style={{ marginTop: 8, ...muted }}>{picked.length} selected</div>
          </div>
        )}

        <div style={{ marginTop: 11 }}>
          <span style={{ fontSize: 16, fontWeight: 650, color: 'var(--crm-ink)' }}>
            {aud === 'all' ? '—' : aud === 'picked' ? picked.length : (segPreview?.count ?? '…')}
          </span>{' '}
          <span style={muted}>
            {aud === 'all' ? 'every active client will see this offer (public)' : 'clients match'}
          </span>
        </div>

        {aud === 'segment' && segPreview?.sample?.length > 0 && (
          <div style={{ ...panel, padding: 0, marginTop: 9, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
              <thead><tr>
                {['Client', 'Plan', 'Credits', 'Last seen'].map((h) => (
                  <th key={h} style={{ ...th, textAlign: 'left' }}>{h}</th>))}
              </tr></thead>
              <tbody>
                {segPreview.sample.map((u) => (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                    <td style={{ ...td, textAlign: 'left' }}>{u.email}</td>
                    <td style={{ ...td, textAlign: 'left' }}>{u.package || '—'}</td>
                    <td style={{ ...td, textAlign: 'left' }}>{num(u.credits)}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      {u.last_login_at ? String(u.last_login_at).slice(0, 10) : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 3 — delivery */}
      <Card step="3" title="How does it reach them?" why="A code for public campaigns, auto-apply for targeted clients.">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={radio}>
            <input type="checkbox" checked={dCode} onChange={(e) => setDCode(e.target.checked)} /> Promo code
          </label>
          {dCode && (
            <Field label="Promo code" required invalid={miss.code}
              info="The code a customer types at checkout to claim this offer. Uppercase letters, numbers, hyphen or underscore, 3–30 characters. Press Generate to build one from the offer name, or type your own. It must be unique across all offers.">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  aria-required="true" aria-invalid={miss.code}
                  placeholder="VOXEL15"
                  style={{ ...adminInput(miss.code), width: 150, textTransform: 'uppercase' }} />
                <button type="button" style={smallBtn} onClick={() => {
                  const base = (name.trim().replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'VOXEL').toUpperCase();
                  setCode(`${base}${value}`);
                }}>Generate</button>
              </div>
            </Field>
          )}
          <label style={radio}>
            <input type="checkbox" checked={dAuto} onChange={(e) => setDAuto(e.target.checked)} /> Auto-applied to the audience
          </label>
          {/* ON HOLD — no mail server. Disabled rather than hidden so the plan
              for it stays visible, exactly as the prototype does. */}
          <label style={{ ...radio, opacity: 0.55, cursor: 'not-allowed' }}>
            <input type="checkbox" disabled /> Email campaign to the audience
            <span style={badge('#fbbf24')}>ON HOLD</span>
          </label>
        </div>
        <div style={{ ...muted, marginTop: 6, fontSize: 12 }}>
          Email campaigns are on hold until the email server is configured — the option activates then.
        </div>
      </Card>

      {/* 4 — when */}
      <Card step="4" title="When, and for how long?" why="Schedule the campaign window and what happens on renewals.">
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Starts">
            <input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} style={{ ...input, width: 165 }} />
          </Field>
          <Field label="Ends">
            <input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} style={{ ...input, width: 165 }} />
          </Field>
          <Field label="On renewals">
            <select value={renew} onChange={(e) => setRenew(e.target.value)} style={{ ...input, width: 190 }}>
              <option style={opt} value="first">First payment only</option>
              <option style={opt} value="months">First N months</option>
              <option style={opt} value="forever">Lifetime of subscription</option>
            </select>
          </Field>
          {renew === 'months' && (
            <Field label="N months">
              <input type="number" min="1" value={renewN}
                onChange={(e) => setRenewN(Number(e.target.value))} style={{ ...input, width: 90 }} />
            </Field>
          )}
          <Field label="Max uses per client">
            <input type="number" min="1" value={perClient}
              onChange={(e) => setPerClient(Number(e.target.value))} style={{ ...input, width: 110 }} />
          </Field>
          <Field label="Max total uses">
            <input type="number" min="1" placeholder="∞" value={maxTotal}
              onChange={(e) => setMaxTotal(e.target.value)} style={{ ...input, width: 110 }} />
          </Field>
        </div>
        <div style={{ ...muted, marginTop: 8, fontSize: 12 }}>
          One offer per subscription at a time — offers never stack; the best one for the client wins.
        </div>
      </Card>

      {/* 5 — margin */}
      <Card step="5" title="Margin impact — from the Costing engine"
        why={`Plans are priced at a ${pct(S.margin_target)} margin (cost = ${pct(1 - Number(S.margin_target))} of price, worst-case vs suppliers). This is what the offer does to it.`}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <Field label="Margin floor (%)">
            <input type="number" min="0" max="60" defaultValue={(Number(S.margin_floor) * 100).toFixed(0)}
              style={{ ...input, width: 90 }}
              onBlur={async (e) => {
                const v = Number(e.target.value) / 100;
                if (Number.isFinite(v) && Math.abs(v - Number(S.margin_floor)) > 1e-9) {
                  try { await adminApi.offerSettings({ margin_floor: v }); toast.success('Margin floor updated'); }
                  catch (err) { onError?.(err, 'Could not update the floor'); }
                }
              }} />
          </Field>
        </div>

        {!selectedPlans.length ? (
          <div style={muted}>Select at least one plan.</div>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(impact?.impact || []).map((r) => (
              <div key={r.plan_id} style={{
                border: `1px solid ${r.below_floor ? 'rgba(248,113,113,0.5)' : 'var(--crm-w10)'}`,
                background: r.below_floor ? 'rgba(248,113,113,0.08)' : 'var(--crm-w03)',
                borderRadius: 11, padding: '10px 14px 12px', minWidth: 178,
              }}>
                <div style={{ fontWeight: 650, fontSize: 12.5, color: 'var(--crm-ink)' }}>
                  {r.plan_name} ${r.price_usd}
                  {r.new_price != null && <> → ${r.new_price.toFixed(2)}</>}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, margin: '1px 0 2px',
                  color: r.below_floor ? '#f87171' : 'var(--crm-ink)' }}>
                  {type === 'days'
                    ? `~${money(r.estimated_cost)}`
                    : <>{pct(r.margin_before)} → {r.margin_after == null ? '—' : pct(r.margin_after)}</>}
                </div>
                <div style={{ ...muted, fontSize: 11.5 }}>
                  {type === 'days' ? `est. cost per client (${value} free days)`
                    : r.below_floor ? `▼ below ${pct(S.margin_floor)} floor` : 'margin with offer'}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          {belowFloor ? (
            <div style={noteBox('#f87171')}>
              <div style={{ color: '#f87171', fontWeight: 650 }}>
                ▼ This offer pushes at least one plan below your {pct(S.margin_floor)} margin floor.
              </div>
              <label style={{ ...radio, marginTop: 8 }}>
                <input type="checkbox" checked={confirmBelow}
                  onChange={(e) => setConfirmBelow(e.target.checked)} />
                Approve below the floor anyway — I accept the reduced margin
              </label>
              <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>
                This confirmation is recorded in the audit trail against your name.
              </div>
            </div>
          ) : type !== 'days' && impact ? (
            <span style={{ color: '#4ade80', fontWeight: 600 }}>
              ✓ All selected plans stay above the {pct(S.margin_floor)} margin floor.
            </span>
          ) : null}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy || (belowFloor && !confirmBelow)} onClick={() => save(true)}
          style={{
            ...smallBtn, padding: '9px 18px', fontSize: 14, fontWeight: 700, color: 'var(--crm-ink)',
            border: 'none', borderRadius: 10,
            background: (busy || (belowFloor && !confirmBelow))
              ? 'rgba(139,0,0,0.4)'
              : 'linear-gradient(90deg,#CC0000 0%,#FF2222 50%,#E01E1E 100%)',
            cursor: (belowFloor && !confirmBelow) ? 'not-allowed' : 'pointer',
          }}>Submit &amp; approve</button>
        <button disabled={busy} onClick={() => save(false)} style={{ ...smallBtn, padding: '9px 16px', fontSize: 13.5 }}>
          Save as draft
        </button>
      </div>
      {tried && (
        <MissingSummary count={Object.values(missing).filter(Boolean).length} extra={errs} />
      )}
      <div style={{ ...muted, marginTop: 10, fontSize: 12 }}>
        Boxes marked <span style={{ color: '#f87171', fontWeight: 700 }}>*</span> must be filled ·
        press <b>ⓘ</b> beside any box to see what it expects.
        Approval writes the audit log and activates on the start date.
      </div>
    </div>
  );
}

// ─── detail ──────────────────────────────────────────────────────────────────
function OfferDetail({ data, onBack }) {
  const o = data.offer, s = data.stats;
  return (
    <div>
      <button onClick={onBack} style={{ ...smallBtn, marginBottom: 12 }}>← All offers</button>
      <div style={{ display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Stat label="Redemptions" value={num(s.redemptions)} note={o.name} />
        <Stat label="Discount given" value={money(s.discount_given)} note="total" />
        <Stat label="Credits granted" value={num(s.credits_granted)} note="bonus credits" />
        <Stat label="Status" value={o.effective_status} note={`${String(o.starts_at).slice(0, 10)} → ${String(o.ends_at).slice(0, 10)}`} />
      </div>
      {o.requires_checkout && (
        <div style={{ ...noteBox('#fbbf24'), marginBottom: 14 }}>
          This offer type needs a checkout to be redeemed, which Voxel does not have yet — so its
          redemption count will stay at zero for now.
        </div>
      )}
      <SimpleTable title="Redemptions" empty="Nobody has redeemed this offer yet."
        head={['Client', 'Saved', 'Bonus credits', 'When']}
        rows={(data.redemptions || []).map((r) => [
          r.email, money(r.amount_saved), num(r.bonus_credits_granted), String(r.redeemed_at).slice(0, 10)])} />
      <SimpleTable title="Audit trail" empty="No audit entries."
        head={['When', 'Field', 'From', 'To', 'By']}
        rows={(data.audit || []).map((a) => [
          String(a.changed_at).slice(0, 16).replace('T', ' '), a.field,
          a.old_value ?? '—', a.new_value ?? '—', a.changed_by])} />
    </div>
  );
}

function SimpleTable({ title, head, rows, empty }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...muted, marginBottom: 6, fontWeight: 600 }}>{title}</div>
      {!rows.length ? <div style={{ ...panel, ...muted }}>{empty}</div> : (
        <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead><tr>{head.map((h) => <th key={h} style={{ ...th, textAlign: 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                  {r.map((c, j) => <td key={j} style={{ ...td, textAlign: 'left' }}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── bits ────────────────────────────────────────────────────────────────────
function Card({ step, title, why, children }) {
  return (
    <div style={{ ...panel, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--crm-ink)' }}>
        <span style={{
          width: 26, height: 26, borderRadius: 8, background: '#e0442c', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13.5, fontWeight: 700, flex: 'none',
        }}>{step}</span>
        {title}
      </h3>
      <div style={{ ...muted, fontSize: 12, margin: '2px 0 14px 36px' }}>{why}</div>
      <div style={{ marginLeft: 36 }}>{children}</div>
    </div>
  );
}
function Chip({ sel, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      border: `1.5px solid ${sel ? '#e0442c' : 'var(--crm-w12)'}`,
      background: sel ? '#e0442c' : 'transparent',
      color: sel ? 'var(--crm-ink)' : 'var(--crm-w70)',
      borderRadius: 16, padding: '4px 13px', cursor: 'pointer',
      fontSize: 12.5, fontFamily: 'inherit', fontWeight: sel ? 600 : 500,
    }}>{children}</button>
  );
}
function Stat({ label, value, note, color }) {
  return (
    <div style={panel}>
      <div style={{ color: 'var(--crm-w45)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: color || 'var(--crm-ink)', lineHeight: 1.15 }}>{value}</div>
      {note && <div style={{ color: 'var(--crm-w50)', fontSize: 11.5 }}>{note}</div>}
    </div>
  );
}
const badge = (c) => ({
  marginLeft: 8, padding: '1.5px 7px', borderRadius: 5, fontSize: 10,
  fontWeight: 700, letterSpacing: '.03em', background: `${c}22`, color: c,
  verticalAlign: 1, whiteSpace: 'nowrap',
});
const noteBox = (c) => ({
  padding: '10px 13px', borderRadius: 10, fontSize: 12.5,
  background: `${c}14`, border: `1px solid ${c}55`, color: 'var(--crm-w85)',
});
const muted = { color: 'var(--crm-w45)', fontSize: 13 };
const panel = {
  padding: 14, background: 'var(--crm-w03)',
  border: '1px solid var(--crm-w08)', borderRadius: 12,
};
const th = {
  padding: '9px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '.03em', color: 'var(--crm-w45)', textAlign: 'right', whiteSpace: 'nowrap',
};
const td = { padding: '7px 10px', textAlign: 'right', color: 'var(--crm-w85)', whiteSpace: 'nowrap' };
const input = adminInput();
// A <select> inherits the page's dark background but its <option> list is
// painted by the OS. Without an explicit pair the dropdown renders black text
// on a black sheet in dark mode — the bug the brief asks to verify.
const opt = { background: 'var(--crm-tooltip-bg)', color: 'var(--crm-ink)' };
const radio = { display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer',
  color: 'var(--crm-w80)', fontSize: 13 };
const smallBtn = {
  border: '1px solid var(--crm-w14)', background: 'var(--crm-w04)',
  color: 'var(--crm-w80)', borderRadius: 8, padding: '5px 12px',
  fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
};
const linkBtn = {
  background: 'none', border: 'none', padding: 0, color: 'var(--crm-ink)', fontWeight: 600,
  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
  textUnderlineOffset: 3, textDecorationColor: 'var(--crm-w30)',
};
