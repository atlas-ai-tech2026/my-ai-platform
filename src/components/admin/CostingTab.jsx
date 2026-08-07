// ─── CostingTab ──────────────────────────────────────────────────────────────
// The CRM Costing calculator: what Voxel's prices SHOULD be, given supplier
// costs and a margin target. Rebuilt from the reference prototype shipped with
// the costing brief (2026-08-06).
//
// ── IT DOES NOT CHARGE ANYBODY ─────────────────────────────────────────────
// What a customer actually pays comes from server/src/pricing.js, which finding
// C1 of the July audit made the single charging authority. Editing a cost here
// changes what this screen SAYS, never what anyone is billed. That is stated on
// the screen too, because a pricing tool that looks live but isn't — or looks
// safe but isn't — is dangerous either way.
//
// The server recomputes every derived number and returns the whole state on
// each write, so this component renders rather than calculates. That is why the
// numbers here can never disagree with the backend.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

const pct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const money = (v) => v == null ? '—' : `$${Number(v).toFixed(Number(v) < 1 ? 4 : 3)}`;
const cr = (v) => v == null ? '—' : Number(v) % 1 ? Number(v).toFixed(1) : String(Number(v));
const num = (v) => Number(v).toLocaleString('en-US');

const CATEGORY_LABEL = {
  image: 'IMAGE MODELS — per image',
  video_sec: 'VIDEO MODELS — per SECOND of output',
  video_clip: 'VIDEO MODELS — per WHOLE video (KIE bills per clip)',
  voice: 'VOICE MODELS — per 1,000 characters',
};

export default function CostingTab({ onError }) {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('models');
  const [basis, setBasis] = useState('max');
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState(null);
  // Plan edits are local until approved — mirrors the server's draft table.
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await adminApi.costingState();
      setState(s);
      setDraft(null);
    } catch (e) { onError?.(e, 'Could not load costing'); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  /** Every mutation returns the full recomputed state — no local arithmetic. */
  const apply = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      const s = await fn();
      setState(s);
      if (successMsg) toast.success(successMsg);
      return s;
    } catch (e) {
      onError?.(e, 'Update failed');
      await load();      // never leave the screen showing an unsaved value
      return null;
    } finally { setBusy(false); }
  }, [onError, load]);

  const saveModel = useCallback((id, body) =>
    apply(() => adminApi.costingModel(id, body)), [apply]);

  const saveSetting = useCallback((body) =>
    apply(() => adminApi.costingSettings(body)), [apply]);

  const loadAudit = useCallback(async () => {
    try {
      const r = await adminApi.costingAudit(200);
      setAudit(r.audit);
    } catch (e) { onError?.(e, 'Could not load the audit trail'); }
  }, [onError]);

  useEffect(() => { if (tab === 'audit' && audit === null) loadAudit(); }, [tab, audit, loadAudit]);

  // ── plan draft handling ───────────────────────────────────────────
  const workingPlans = draft ?? state?.plans ?? [];
  const draftDirty = useMemo(() => {
    if (!draft || !state) return false;
    return draft.some((d, i) => {
      const p = state.plans[i];
      return d.name !== p.name
        || Number(d.price_usd) !== Number(p.price_usd)
        || (d.credits_override ?? null) !== (p.credits_override ?? null);
    });
  }, [draft, state]);

  const editPlan = useCallback((i, field, value) => {
    setDraft((cur) => {
      const base = cur ?? state.plans.map((p) => ({ ...p }));
      const next = base.map((p) => ({ ...p }));
      if (field === 'name') next[i].name = value;
      if (field === 'price_usd') next[i].price_usd = value;
      if (field === 'credits_override') next[i].credits_override = value;
      return next;
    });
  }, [state]);

  const dismissCatalog = useCallback(async (id, dismissed) => {
    setBusy(true);
    try {
      setState(await adminApi.costingDismissCatalog(id, dismissed));
    } catch (e) { onError?.(e, 'Could not update that model'); }
    finally { setBusy(false); }
  }, [onError]);

  const approvePlans = useCallback(async () => {
    setBusy(true);
    try {
      await adminApi.costingSaveDraft(draft.map((p) => ({
        id: p.id, name: p.name, price_usd: p.price_usd,
        credits_override: p.credits_override,
      })));
      const s = await adminApi.costingApprove();
      setState(s); setDraft(null);
      toast.success(`Approved ${s.approved} plan change${s.approved === 1 ? '' : 's'}`);
    } catch (e) { onError?.(e, 'Approval failed'); }
    finally { setBusy(false); }
  }, [draft, onError]);

  if (!state) return <div style={muted}>Loading costing…</div>;

  const S = state.settings;
  const worst = Math.min(...state.worst_margin_per_plan.filter((x) => x != null));
  // Explicit null check: an unknown margin is NOT "below target", it is unknown.
  const belowCount = state.models.filter(
    (m) => m.margin_vs_basis != null && m.margin_vs_basis < m.target - 1e-6
  ).length;

  return (
    <div>
      {/* The single most important thing on this screen. */}
      <div style={{
        padding: '10px 14px', marginBottom: 14, borderRadius: 10, fontSize: 13,
        background: 'var(--crm-blue-bg)', border: '1px solid var(--crm-blue-br)',
        color: 'var(--crm-w85)',
      }}>
        <b>This is a calculator.</b> It works out what prices should be from supplier costs.
        Editing anything here does <b>not</b> change what customers are charged — that still
        comes from the live pricing table until you deliberately carry a number across.
      </div>

      {/* Headline numbers */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Stat label="Worst-case margin" value={pct(worst)}
          note={worst >= S.margin_target - 1e-6 ? 'every plan clears its target' : 'BELOW TARGET'}
          color={worst >= S.margin_target - 1e-6 ? 'var(--crm-green)' : 'var(--crm-red)'} />
        <Stat label="Margin target" value={pct(S.margin_target)} note="of sale price" />
        <Stat label="Credit value" value={`$${Number(S.credit_value).toFixed(6)}`} note="$19 plan ÷ 300 credits" />
        <Stat label="Models costed" value={num(state.models.length)}
          note={`${state.models.filter((m) => m.fal_cost == null).length} KIE-only rows`} />
        <Stat label="Awaiting cost" value={num(state.models.filter((m) => m.needs_cost).length)}
          note="margin unknown until filled"
          color={state.models.some((m) => m.needs_cost) ? 'var(--crm-amber)' : 'var(--crm-green)'} />
        <Stat label="Below target" value={num(belowCount)}
          note={belowCount ? 'needs re-pricing' : 'none'}
          color={belowCount ? 'var(--crm-red)' : 'var(--crm-green)'} />
      </div>

      {/* Global controls */}
      <div style={{ ...panel, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="Margin target — all models (%)">
          <input type="number" step="1" min="1" max="94" defaultValue={(S.margin_target * 100).toFixed(0)}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && Math.abs(v / 100 - S.margin_target) > 1e-9) {
                saveSetting({ margin_target: v });
              }
            }} style={input} />
        </Field>
        <Field label="Credit value ($ per credit)">
          <input type="number" step="0.000001" min="0.000001" defaultValue={Number(S.credit_value).toFixed(6)}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && Math.abs(v - S.credit_value) > 1e-12) {
                saveSetting({ credit_value: v });
              }
            }} style={input} />
        </Field>
        <div style={{ ...muted, flex: 1, minWidth: 220 }}>
          Blue cells are editable. Every change is recorded in the audit trail with your name.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--crm-w10)', marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          ['models', 'Model Credits'],
          ['plans', 'Plans'],
          ['profit', 'Profit Check'],
          ['new', `New Models${state.catalog?.length ? ` (${state.catalog.length})` : ''}`],
          ['coverage', `Coverage${state.coverage.uncosted_total ? ` (${state.coverage.uncosted_total})` : ''}`],
          ['audit', 'Audit'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            border: 'none', background: 'none', padding: '9px 14px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 14,
            color: tab === id ? 'var(--crm-ink)' : 'var(--crm-w45)',
            fontWeight: tab === id ? 700 : 500,
            borderBottom: tab === id ? '2px solid #e0442c' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'models' && (
        <ModelsTable state={state} busy={busy} onSave={saveModel} />
      )}

      {tab === 'plans' && (
        <PlansTable state={state} plans={workingPlans} dirty={draftDirty} busy={busy}
          onEdit={editPlan}
          onApprove={approvePlans}
          onDiscard={() => setDraft(null)} />
      )}

      {tab === 'profit' && (
        <ProfitTable state={state} basis={basis} setBasis={setBasis} />
      )}

      {tab === 'new' && (
        <NewModels rows={state.catalog || []} busy={busy}
          onDismiss={dismissCatalog} settings={S} />
      )}

      {tab === 'coverage' && <Coverage report={state.coverage} />}

      {tab === 'audit' && <AuditList rows={audit} onRefresh={() => { setAudit(null); loadAudit(); }} />}
    </div>
  );
}

/* ── Model Credits ─────────────────────────────────────────────────── */
function ModelsTable({ state, busy, onSave }) {
  const S = state.settings;
  let lastCat = null;
  return (
    <>
      <div style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>{['Model', 'Variant', 'Res', 'KIE cost', 'FAL cost', 'Basis', 'Target %',
                 'Credits', 'Sale $', 'Margin vs basis', 'Margin vs KIE',
                 ...state.plans.map((p) => `${p.name} $${p.price_usd}`)]
              .map((h, i) => <th key={i} style={{ ...th, textAlign: i < 3 ? 'left' : 'right' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {state.models.map((m) => {
              const header = m.category !== lastCat ? (lastCat = m.category) : null;
              const below = m.margin_vs_basis != null && m.margin_vs_basis < m.target - 1e-6;
              // Amber row = found in production, no supplier cost recorded yet.
              // Its margin is UNKNOWN, which must never be mistaken for fine.
              const needsCost = m.needs_cost;
              return (
                <React.Fragment key={m.id}>
                  {header && (
                    <tr><td colSpan={11 + state.plans.length} style={catRow}>{CATEGORY_LABEL[m.category]}</td></tr>
                  )}
                  <tr style={{
                    borderTop: '1px solid var(--crm-w06)',
                    ...(needsCost ? { background: 'var(--crm-amber-bg)' } : {}),
                  }}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                      {m.model_name}
                      {needsCost && (
                        <span title="Charged in production, but no supplier cost recorded — margin unknown"
                          style={{
                            marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                            padding: '1px 6px', borderRadius: 999, verticalAlign: 'middle',
                            background: 'var(--crm-amber-bg)', color: 'var(--crm-amber)',
                          }}>COST NEEDED</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--crm-w55)' }}>{m.variant}</td>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--crm-w55)' }}>{m.resolution ?? '—'}</td>
                    <td style={td}><Cell value={m.kie_cost ?? ''} disabled={busy}
                      placeholder="add cost"
                      onCommit={(v) => onSave(m.id, { kie_cost: v })} /></td>
                    <td style={td}>{m.fal_cost == null
                      ? <span style={{ ...muted, fontSize: 12 }}>KIE only</span>
                      : <Cell value={m.fal_cost} disabled={busy} onCommit={(v) => onSave(m.id, { fal_cost: v })} />}</td>
                    <td style={td}>{money(m.basis)}</td>
                    <td style={td}>
                      <Cell value={(m.target * 100).toFixed(0)} width={48} disabled={busy}
                        overridden={m.margin_override != null}
                        onCommit={(v) => onSave(m.id, { margin_override: v })} />
                      {m.margin_override != null && (
                        <Reset label={`all ${(S.margin_target * 100).toFixed(0)}`}
                          onClick={() => onSave(m.id, { margin_override: null })} />
                      )}
                    </td>
                    <td style={td}>
                      <Cell value={cr(m.credits)} width={56} disabled={busy}
                        overridden={m.credits_override != null}
                        onCommit={(v) => onSave(m.id, { credits_override: v })} />
                      {m.credits_override != null && (
                        <Reset label={`auto ${cr(m.auto_credits)}`}
                          onClick={() => onSave(m.id, { credits_override: null })} />
                      )}
                    </td>
                    <td style={td}>{money(m.sale)}</td>
                    <td style={{ ...td, ...(below ? belowStyle : m.margin_vs_basis >= 0.5 ? { color: 'var(--crm-green)' } : {}) }}>
                      {m.margin_vs_basis == null
                        ? <span style={{ color: 'var(--crm-amber)' }}>unknown</span>
                        : <>{below ? '▼ ' : ''}{pct(m.margin_vs_basis)}</>}
                    </td>
                    <td style={{ ...td, color: 'var(--crm-w55)' }}>
                      {m.margin_vs_kie == null ? <span style={{ color: 'var(--crm-amber)' }}>unknown</span> : pct(m.margin_vs_kie)}
                    </td>
                    {m.qty_per_plan.map((q, i) => (
                      <td key={i} style={{ ...td, color: 'var(--crm-w45)' }}>{num(q)}</td>
                    ))}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={note}>
        Credits = cost ÷ (1 − target), rounded <b>up</b> to the next half credit — rounding up is
        what keeps the realised margin from landing under target. <b>Target %</b> follows the global
        value until you type a different number for a row (amber); “all” returns it. A hand-typed
        credits value is likewise an override; “auto” returns it to the formula.
      </p>
    </>
  );
}

/* ── Plans ─────────────────────────────────────────────────────────── */
function PlansTable({ state, plans, dirty, busy, onEdit, onApprove, onDiscard }) {
  const S = state.settings;
  return (
    <>
      <div style={{ ...tableWrap, maxWidth: 860 }}>
        <table style={table}>
          <thead><tr>{['Plan name', 'Price (USD)', 'Credits included', '$ per credit', 'Status']
            .map((h, i) => <th key={i} style={{ ...th, textAlign: i === 0 || i === 4 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
          <tbody>
            {plans.map((p, i) => {
              const published = state.plans[i];
              const credits = p.credits_override ?? Math.round(Number(p.price_usd) / S.credit_value);
              const perCredit = Number(p.price_usd) / credits;
              // >1% under the anchor is a real discount, not rounding noise —
              // and it silently shrinks the margin on every model.
              const cheap = perCredit < S.credit_value * 0.99;
              const changed = p.name !== published.name
                || Number(p.price_usd) !== Number(published.price_usd)
                || (p.credits_override ?? null) !== (published.credits_override ?? null);
              return (
                <tr key={p.id} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <Cell value={p.name} width={110} align="left" disabled={busy}
                      onCommit={(v) => onEdit(i, 'name', v)} raw />
                  </td>
                  <td style={td}>
                    <Cell value={p.price_usd} width={80} disabled={busy}
                      onCommit={(v) => onEdit(i, 'price_usd', v)} />
                  </td>
                  <td style={td}>
                    <Cell value={num(credits)} width={78} disabled={busy}
                      overridden={p.credits_override != null}
                      onCommit={(v) => onEdit(i, 'credits_override', v)} />
                    {p.credits_override != null && (
                      <Reset label={`auto ${num(Math.round(Number(p.price_usd) / S.credit_value))}`}
                        onClick={() => onEdit(i, 'credits_override', null)} />
                    )}
                  </td>
                  <td style={{ ...td, ...(cheap ? belowStyle : {}) }}>
                    ${perCredit.toFixed(5)}{cheap ? ' ▼' : ''}
                  </td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    {changed
                      ? <span style={{ color: 'var(--crm-amber)', fontWeight: 600 }}>● draft — not approved</span>
                      : <span style={muted}>published</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {dirty ? (
          <>
            <button style={primaryBtn} disabled={busy} onClick={onApprove}>
              {busy ? 'Approving…' : 'Submit & approve changes'}
            </button>
            <button style={btn} onClick={onDiscard}>Discard draft</button>
            <span style={muted}>Nothing moves until you approve.</span>
          </>
        ) : (
          <span style={muted}>No pending changes — what you see is what is approved.</span>
        )}
      </div>
      <p style={note}>
        Credits follow price ÷ credit value automatically; a hand-typed number is an override. If an
        override makes a plan’s $-per-credit cheaper than the global credit value, that plan’s margins
        shrink on every model — the cell turns red and Profit Check shows which models fall below target.
      </p>
    </>
  );
}

/* ── Profit Check ──────────────────────────────────────────────────── */
function ProfitTable({ state, basis, setBasis }) {
  const rows = state.profit[basis];
  const byId = new Map(rows.map((r) => [r.id, r]));
  let lastCat = null;
  const worstPerPlan = state.plans.map((_, pi) => {
    let w = Infinity;
    for (const r of rows) if (r.margins) w = Math.min(w, r.margins[pi]);
    return w === Infinity ? null : w;
  });
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={muted}>Margin if a customer spends an <b>entire plan on one model</b>, costed against:</span>
        <div style={{ display: 'inline-flex', border: '1px solid var(--crm-w12)', borderRadius: 8, overflow: 'hidden' }}>
          {[['max', 'Safe — MAX(KIE, FAL)'], ['kie', 'KIE only'], ['fal', 'FAL only']].map(([id, label]) => (
            <button key={id} onClick={() => setBasis(id)} style={{
              border: 'none', borderRadius: 0, padding: '6px 13px', fontSize: 12.5, cursor: 'pointer',
              fontFamily: 'inherit',
              background: basis === id ? '#e0442c' : 'transparent',
              color: basis === id ? 'var(--crm-ink)' : 'var(--crm-w60)',
              fontWeight: basis === id ? 600 : 500,
            }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={tableWrap}>
        <table style={table}>
          <thead><tr>{['Model', 'Variant', 'Res', 'Cost used', 'Credits',
            ...state.plans.map((p) => `${p.name} $${p.price_usd}`)]
            .map((h, i) => <th key={i} style={{ ...th, textAlign: i < 3 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
          <tbody>
            <tr>
              <td colSpan={5} style={{ ...td, textAlign: 'left', fontWeight: 700 }}>WORST model in each plan →</td>
              {worstPerPlan.map((w, i) => (
                <td key={i} style={{ ...td, fontWeight: 700, ...(w != null && w < state.settings.margin_target - 1e-6 ? belowStyle : {}) }}>
                  {pct(w)}
                </td>
              ))}
            </tr>
            {state.models.map((m) => {
              const header = m.category !== lastCat ? (lastCat = m.category) : null;
              const r = byId.get(m.id);
              return (
                <React.Fragment key={m.id}>
                  {header && <tr><td colSpan={5 + state.plans.length} style={catRow}>{CATEGORY_LABEL[m.category]}</td></tr>}
                  <tr style={{ borderTop: '1px solid var(--crm-w06)' }}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{m.model_name}</td>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--crm-w55)' }}>{m.variant}</td>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--crm-w55)' }}>{m.resolution}</td>
                    <td style={td}>{money(r?.cost)}</td>
                    <td style={td}>{cr(m.credits)}</td>
                    {state.plans.map((_, i) => {
                      if (!r?.margins) return <td key={i} style={{ ...td, color: 'var(--crm-w30)' }}>—</td>;
                      const mg = r.margins[i];
                      const below = mg < m.target - 1e-6;
                      return (
                        <td key={i} style={{ ...td, ...(below ? belowStyle : mg >= 0.5 ? { color: 'var(--crm-green)' } : {}) }}>
                          {below ? '▼ ' : ''}{pct(mg)}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Coverage ──────────────────────────────────────────────────────── */
// ─── New Models ──────────────────────────────────────────────────────────────
// What a provider offers that the website does not sell yet — the onboarding
// queue, in its own VIOLET so it can never be mistaken for the amber
// "COST NEEDED" rows. The two mean different things and must not look alike:
//   amber  = we sell this, but no supplier cost is recorded → margin unknown
//   violet = we do NOT sell this yet → nothing to have a margin on
const VIOLET = 'var(--crm-violet)';
const VIOLET_BG = 'var(--crm-violet-bg)';
const VIOLET_LINE = 'var(--crm-violet-br)';

function NewModels({ rows, busy, onDismiss, settings }) {
  const [showDismissed, setShowDismissed] = useState(false);
  const priced = rows.filter((r) => r.price_usd != null);

  // What we WOULD charge, if the provider price is known. Uses the same credit
  // value the rest of the screen uses, so the number is comparable — but it is
  // an indication only: nothing here is sold yet.
  const indicativeCredits = (r) => {
    if (r.price_usd == null || !settings) return null;
    const target = Number(settings.margin_target);
    const cv = Number(settings.credit_value);
    if (!(target > 0 && target < 1) || !(cv > 0)) return null;
    return Math.ceil((r.price_usd / (1 - target)) / cv * 2 - 1e-9) / 2;
  };

  return (
    <div>
      <div style={{
        padding: '10px 14px', marginBottom: 14, borderRadius: 10, fontSize: 13,
        background: VIOLET_BG, border: `1px solid ${VIOLET_LINE}`, color: 'var(--crm-w85)',
      }}>
        <b>Models the provider offers that the website does not sell yet.</b> Checked daily
        against fal.ai's public catalogue. Nothing here is charged to anyone — before a model
        joins the table above it needs to be added to the site, connected to a provider, given
        a cost and given a credit value.
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Stat label="Available, not sold" value={num(rows.length)} note="found at the provider" color={VIOLET} />
        <Stat label="With a provider price" value={num(priced.length)}
          note={`${rows.length - priced.length} price unknown`} />
      </div>

      {!rows.length ? (
        <div style={{ ...panel, ...muted }}>
          Nothing new. Either the daily check has not run yet, or every model the provider
          offers is already on the website.
        </div>
      ) : (
        <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Model</th>
                <th style={{ ...th, textAlign: 'left' }}>Maker</th>
                <th style={{ ...th, textAlign: 'left' }}>Type</th>
                <th style={th}>Provider cost</th>
                <th style={th}>Credits (indicative)</th>
                <th style={{ ...th, textAlign: 'left' }}>Appeared</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cr = indicativeCredits(r);
                return (
                  <tr key={r.id} style={{
                    borderTop: '1px solid var(--crm-w06)',
                    background: VIOLET_BG,
                  }}>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--crm-ink)', fontWeight: 600 }}>
                      {r.family}
                      <span style={{
                        marginLeft: 8, padding: '1px 6px', borderRadius: 5, fontSize: 10,
                        fontWeight: 700, letterSpacing: 0.4,
                        background: 'var(--crm-violet-bg)', color: VIOLET,
                      }}>NEW</span>
                      {r.endpoints > 1 && (
                        <span style={{ ...muted, marginLeft: 8, fontSize: 11 }}>
                          {r.endpoints} variants
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'left' }}>{r.lab || '—'}</td>
                    <td style={{ ...td, textAlign: 'left' }}>{r.category || '—'}</td>
                    <td style={td}>
                      {r.price_usd == null
                        // Never render 0. The provider states a price we refuse
                        // to parse (token or per-megapixel billing) — saying
                        // "unknown" is honest; saying $0 is not.
                        ? <span style={{ ...muted }}>unknown</span>
                        : <>{money(r.price_usd)}<span style={{ ...muted, fontSize: 11 }}> /{r.price_unit}</span></>}
                    </td>
                    <td style={td}>{cr == null ? <span style={muted}>—</span> : cr.toFixed(1)}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      {r.first_seen ? String(r.first_seen).slice(0, 10) : '—'}
                    </td>
                    <td style={td}>
                      <button disabled={busy} onClick={() => onDismiss(r.id, true)} style={{
                        border: '1px solid var(--crm-w14)', background: 'none',
                        color: 'var(--crm-w60)', borderRadius: 7, padding: '4px 10px',
                        fontSize: 11.5, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                      }}>Hide</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ ...muted, marginTop: 10, fontSize: 12.5 }}>
        Matching is by name, so a model you already sell under a different name can appear
        here — press <b>Hide</b> and it will not come back. Only fal.ai is checked
        automatically: kie.ai publishes no catalogue API, so kie costs still come from the
        recorded table and from what you enter.
      </p>
    </div>
  );
}

function Coverage({ report }) {
  return (
    <div>
      <div style={{ display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Stat label="Charged in production" value={num(report.live_total)} note="models customers can use" />
        <Stat label="Costed here" value={num(report.costed_total)} note="margin is known" color="var(--crm-green)" />
        <Stat label="Not costed" value={num(report.uncosted_total)} note="margin is UNKNOWN"
          color={report.uncosted_total ? 'var(--crm-amber)' : 'var(--crm-green)'} />
      </div>
      <div style={{ ...panel, marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--crm-w80)' }}>{report.note}</p>
        {report.uncosted_total > 0 && (
          <p style={{ ...muted, marginTop: 8, marginBottom: 0 }}>
            These are charged today, but no supplier cost is recorded for them here — so this
            calculator cannot tell you whether they are profitable. To include them, add their
            KIE and FAL costs.
          </p>
        )}
      </div>
      {report.uncosted_total > 0 && (
        <div style={{ ...panel }}>
          <div style={{ ...muted, marginBottom: 8, fontWeight: 600 }}>Models without a recorded cost</div>
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {report.uncosted.map((id) => (
              <div key={id} style={{
                padding: '5px 10px', borderRadius: 7, fontSize: 12.5,
                background: 'var(--crm-amber-bg)', color: 'var(--crm-w85)',
              }}>{id}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Audit ─────────────────────────────────────────────────────────── */
function AuditList({ rows, onRefresh }) {
  if (rows === null) return <div style={muted}>Loading…</div>;
  if (!rows.length) return <div style={{ ...panel, ...muted }}>Nothing has been changed yet.</div>;
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <button style={btn} onClick={onRefresh}>Refresh</button>
      </div>
      <div style={tableWrap}>
        <table style={table}>
          <thead><tr>{['When', 'What', 'Field', 'From', 'To', 'By', 'Note']
            .map((h, i) => <th key={i} style={{ ...th, textAlign: 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--crm-w06)' }}>
                <td style={{ ...td, textAlign: 'left', color: 'var(--crm-w50)' }}>
                  {new Date(r.changed_at).toLocaleString()}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>{r.entity}</td>
                <td style={{ ...td, textAlign: 'left' }}>{r.field}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--crm-w50)' }}>{r.old_value ?? '—'}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--crm-green)' }}>{r.new_value ?? '—'}</td>
                <td style={{ ...td, textAlign: 'left' }}>{r.changed_by}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--crm-w50)' }}>{r.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── small pieces ──────────────────────────────────────────────────── */
function Cell({ value, onCommit, width = 74, overridden, disabled, align = 'right', raw, placeholder }) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => { setV(String(value ?? '')); }, [value]);
  return (
    <input
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      // Commit on blur, not on every keystroke: each commit is a server round
      // trip AND an audit row, so per-character saves would flood both.
      onBlur={() => { if (String(value ?? '') !== v) onCommit(raw ? v : v.replace(/,/g, '')); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{
        width, textAlign: align, padding: '3px 6px', borderRadius: 6, fontFamily: 'inherit',
        fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600,
        background: 'var(--crm-blue-bg)', color: 'var(--crm-blue)',
        border: overridden ? '1px solid var(--crm-amber)' : '1px solid transparent',
      }}
    />
  );
}

const Reset = ({ label, onClick }) => (
  <span onClick={onClick} style={{
    color: 'var(--crm-w45)', fontSize: 11, cursor: 'pointer',
    marginLeft: 4, textDecoration: 'underline',
  }}>{label}</span>
);

function Stat({ label, value, note, color }) {
  return (
    <div style={panel}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--crm-w40)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, color: color || 'var(--crm-ink)',
        fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note ? <div style={{ fontSize: 12, color: 'var(--crm-w40)', marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <div style={{ ...muted, fontSize: 11.5, marginBottom: 3 }}>{label}</div>
    {children}
  </div>
);

const muted = { color: 'var(--crm-w45)', fontSize: 13 };
const panel = { padding: 14, background: 'var(--crm-w03)',
  border: '1px solid var(--crm-w08)', borderRadius: 12 };
const tableWrap = { overflowX: 'auto', border: '1px solid var(--crm-w08)', borderRadius: 12 };
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' };
const th = { padding: '9px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--crm-w40)', background: 'var(--crm-w03)',
  whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const td = { padding: '7px 10px', textAlign: 'right', color: 'var(--crm-w85)', whiteSpace: 'nowrap' };
const catRow = { padding: '7px 10px', textAlign: 'left', background: 'var(--crm-w05)',
  color: 'var(--crm-w55)', fontWeight: 700, fontSize: 12, letterSpacing: '0.02em' };
const belowStyle = { background: 'var(--crm-red-bg)', color: 'var(--crm-red)', fontWeight: 700 };
const note = { ...muted, marginTop: 10, maxWidth: '90ch', lineHeight: 1.6 };
const input = { height: 34, padding: '0 10px', width: 130, borderRadius: 8, fontFamily: 'inherit',
  background: 'var(--crm-blue-bg)', color: 'var(--crm-blue)', fontWeight: 600, fontSize: 13,
  border: '1px solid var(--crm-w12)', fontVariantNumeric: 'tabular-nums' };
const btn = { height: 32, padding: '0 12px', background: 'var(--crm-w06)',
  border: '1px solid var(--crm-w12)', borderRadius: 8, color: 'var(--crm-w85)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const primaryBtn = { height: 36, padding: '0 18px', background: '#e0442c', border: 'none',
  borderRadius: 8, color: 'var(--crm-ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
