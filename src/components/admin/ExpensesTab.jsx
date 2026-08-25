// ─── ExpensesTab.jsx ─────────────────────────────────────────────────────────
// What this business costs to run, and how many customers cover it.
//
// Requested 2026-08-19. Costs sit across eight providers and nowhere adds them
// up, so there is no break-even figure — which makes quoting a workshop a guess.
//
// ── THREE SOURCES, EACH LABELLED ───────────────────────────────────────────
// Same discipline as the Audience tab: a number whose origin is not stated will
// be misread. TYPED is what you entered. MEASURED comes off the ledger and was
// never typed by anyone. PULLED comes from a provider's own billing API. An
// empty DigitalOcean line means nobody gave the server a way to look — it does
// NOT mean the cost was zero, and the screen says so rather than leaving a
// blank to be interpreted.

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import Field, { FieldRow, buttonRowOffset } from './FormField';
import { adminApi } from '@/lib/adminApi';

const panel = {
  border: '1px solid var(--crm-w08)', borderRadius: 12,
  padding: '14px 16px', marginBottom: 14,
};
const input = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 8, padding: '7px 10px', color: 'var(--crm-ink)', fontSize: 13,
};
const btn = {
  fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--crm-w08)', background: 'transparent', color: 'var(--crm-w60)',
};
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

const STATE_COLOUR = {
  overdue: 'var(--crm-red)', critical: 'var(--crm-red)',
  warn: 'var(--crm-amber)', soon: 'var(--crm-w60)', ok: 'var(--crm-w40)',
};

/**
 * How stale a pulled figure is, in hours. Exported so the test can pin the
 * boundary rather than guess at it.
 */
export function staleHours(iso) {
  // `new Date(null)` is the EPOCH, not an invalid date — so a missing
  // timestamp came out finite and the screen read "20690 days old". Caught by
  // the test rather than by anybody looking at it. Absent and unreadable both
  // mean the same thing here: we do not know, so treat it as stale.
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 36e5;
}

/**
 * Says WHEN, not "recently". "Pulled 3 days ago" is a fact somebody can act
 * on; "cached" is a word that makes them assume it is close enough.
 */
export function freshnessLine(iso) {
  const h = staleHours(iso);
  if (!Number.isFinite(h)) return 'DigitalOcean costs are from an earlier pull — press Refresh for today.';
  if (h < 1) return 'DigitalOcean costs pulled less than an hour ago.';
  if (h < 36) return `DigitalOcean costs pulled ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago.`;
  const d = Math.round(h / 24);
  return `⚠ DigitalOcean costs are ${d} day${d === 1 ? '' : 's'} old — press Refresh, or the provider was unreachable.`;
}

export default function ExpensesTab({ onError }) {
  const [data, setData] = useState(null);
  const [margin, setMargin] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', amount: '', cycle: 'monthly', category: 'infrastructure',
    renews_on: '', critical: false,
  });

  const load = useCallback(async () => {
    try { setData(await adminApi.expenses({ months: 6, margin })); }
    catch (e) { onError?.(e, 'Could not load expenses'); }
  }, [margin, onError]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async () => {
    if (!form.name.trim()) { toast.error('Give it a name'); return; }
    if (!(Number(form.amount) > 0)) { toast.error('Enter the amount'); return; }
    setSaving(true);
    try {
      await adminApi.addExpense({ ...form, amount: Number(form.amount) });
      toast.success(`${form.name} added`);
      setForm({ name: '', amount: '', cycle: 'monthly', category: 'infrastructure',
        renews_on: '', critical: false });
      load();
    } catch (e) { onError?.(e, 'Could not save'); }
    finally { setSaving(false); }
  }, [form, load, onError]);

  const cancel = useCallback(async (row) => {
    try {
      await adminApi.cancelExpense(row.id, { reopen: Boolean(row.cancelled_at) });
      load();
    } catch (e) { onError?.(e, 'Could not update'); }
  }, [load, onError]);

  const pullDO = useCallback(async () => {
    try {
      const r = await adminApi.refreshDigitalOcean();
      toast.success(`${r.pulled} DigitalOcean invoice(s) pulled`);
      load();
    } catch (e) { onError?.(e, 'Could not reach DigitalOcean billing'); }
  }, [load, onError]);

  if (!data) return <div style={{ color: 'var(--crm-w40)' }}>Adding it up…</div>;

  const r = data.runRate;
  const head = data.renewalHeadline;

  return (
    <div>
      {/* ── THE THREE NUMBERS ──────────────────────────────────────────── */}
      <div style={panel}>
        <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>Fixed, per month</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{usd(r.fixed)}</div>
            <div style={{ fontSize: 11, color: 'var(--crm-w35)' }}>what you entered</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>Suppliers, this month</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{usd(r.variable)}</div>
            <div style={{ fontSize: 11, color: 'var(--crm-w35)' }}>measured from the ledger</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>Total run rate</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{usd(r.total)}</div>
            <div style={{ fontSize: 11, color: 'var(--crm-w35)' }}>
              {r.cancelled ? `${r.cancelled} cancelled, kept in history` : 'all active'}
            </div>
          </div>

          {/* ── BREAK-EVEN ─────────────────────────────────────────────────
              Uses FIXED cost only. Variable cost rises with customers, so
              folding it in would make the answer move every time somebody
              generated an image. */}
          <div style={{ marginLeft: 'auto', minWidth: 220 }}>
            <div style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>Break-even</div>
            {data.breakEven ? (
              <>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--crm-green)' }}>
                  {data.breakEven.subscriptions} customers
                </div>
                <div style={{ fontSize: 11, color: 'var(--crm-w35)' }}>
                  cover {usd(data.breakEven.fixedMonthly)} of fixed cost at{' '}
                  {usd(data.breakEven.marginUsed)} margin each
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, color: 'var(--crm-w30)', marginTop: 4 }}>
                  needs a margin
                </div>
                <div style={{ fontSize: 11, color: 'var(--crm-w35)' }}>
                  Enter what one subscription earns you after supplier cost.
                </div>
              </>
            )}
            <input
              placeholder="margin per subscription, USD"
              value={margin} onChange={(e) => setMargin(e.target.value)}
              style={{ ...input, width: '100%', marginTop: 6, fontSize: 12 }} />
          </div>
        </div>
      </div>

      {/* ── RENEWALS ───────────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Renewals</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: STATE_COLOUR[head.state] }}>
            {head.text}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginTop: 4, lineHeight: 1.5 }}>
          Warned at 60, 30 and 7 days — before, not on the day. If the domain lapses the site
          AND every email address stop, including the address password resets are sent from.
        </div>
        {data.renewals.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--crm-w40)', marginTop: 10 }}>
            No renewal dates recorded yet. Add one to a cost below and it will be watched.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
            {data.renewals.map((x) => (
              <div key={x.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, alignItems: 'center' }}>
                <span style={{ color: STATE_COLOUR[x.state], fontWeight: 700, minWidth: 92 }}>
                  {x.daysLeft < 0 ? 'OVERDUE' : `${x.daysLeft}d`}
                </span>
                <span style={{ minWidth: 150 }}>
                  {x.name}{x.critical && <span style={{ color: 'var(--crm-red)' }}> ●</span>}
                </span>
                <span style={{ color: 'var(--crm-w40)' }}>{x.renews_on}</span>
                <span style={{ marginLeft: 'auto' }}>{usd(x.amount)} / {x.cycle}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── MONTH BY MONTH ─────────────────────────────────────────────── */}
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Month by month</div>
          <button onClick={pullDO} style={{ ...btn, marginLeft: 'auto' }}>
            ⟳ Pull DigitalOcean invoices
          </button>
        </div>
        {data.digitalocean.note && (
          <div style={{ fontSize: 11.5, color: 'var(--crm-amber)', marginTop: 6, lineHeight: 1.5 }}>
            {data.digitalocean.note}
          </div>
        )}

        {/* ── HOW OLD THESE NUMBERS ARE ──────────────────────────────────
            The server has always sent `lastFetched` and nothing rendered it,
            so a cached figure looked exactly like a fresh one. That matters
            the moment DigitalOcean's billing API is unavailable — which it
            was on 2026-08-23, returning 504 while this tab would have shown
            last week's cost as though it were today's.

            A cost you believe is current, and is not, is worse than no cost
            at all: you act on it. */}
        {data.digitalocean.lastFetched && (
          <div
            style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.5,
              color: staleHours(data.digitalocean.lastFetched) > 36 ? 'var(--crm-amber)' : 'var(--crm-w40)' }}
            data-testid="do-freshness"
          >
            {freshnessLine(data.digitalocean.lastFetched)}
          </div>
        )}
        <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
          {data.series.map((m) => (
            <div key={m.month} style={{ display: 'flex', gap: 12, fontSize: 12.5, alignItems: 'center' }}>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', minWidth: 64 }}>{m.month}</span>
              <span style={{ color: 'var(--crm-w40)', minWidth: 150 }}>
                infrastructure {usd(m.infrastructure)}
                {/* A month still running is NOT a settled bill. DigitalOcean's
                    preview rose from $43.22 to $45.60 in a day; showing it like
                    the closed months would invite reading it as final. */}
                {m.preview && (
                  <span style={{ color: 'var(--crm-amber)', fontSize: 11 }}> so far</span>
                )}
              </span>
              <span style={{ color: 'var(--crm-w40)', minWidth: 130 }}>
                suppliers {usd(m.suppliers)}
              </span>
              <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{usd(m.total)}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--crm-w35)', marginTop: 8, lineHeight: 1.5 }}>
          Two lines on purpose: a rise in <b>suppliers</b> means customers generated more, which is
          good news. A rise in <b>infrastructure</b> means a subscription changed, which is not.
          The current month is marked <b>so far</b> — DigitalOcean bills it as it accrues, so that
          figure keeps rising until the month closes.
        </div>
      </div>

      {/* ── THE LIST, AND ADDING TO IT ─────────────────────────────────── */}
      <div style={panel}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Fixed costs</div>
        <FieldRow>
          <Field label="What is it" info="The provider or subscription as you would recognise it on a bank statement — “GoDaddy — voxel-ai.ai”, “Microsoft 365”.">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="GoDaddy — voxel-ai.ai" style={{ ...input, minWidth: 220 }} />
          </Field>
          <Field label="Amount (USD)" info="What the invoice actually says, in US dollars. Everything on this tab is USD.">
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="96.00" style={{ ...input, width: 120 }} />
          </Field>
          <Field label="Cycle" info="Monthly and annual both feed the run rate — an annual cost is divided by twelve. A ONE-TIME cost is recorded but adds nothing to the monthly figure, because spreading something that will not happen again would inflate break-even.">
            <select value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })}
              style={{ ...input, width: 130 }}>
              {data.cycles.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Category" info="Groups the totals. Infrastructure, domain, tools, email — whatever names you would use yourself.">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              style={{ ...input, width: 150 }} />
          </Field>
          <Field label="Renews on" info="The next renewal date. You are warned at 60, 30 and 7 days — before it happens, not on the day.">
            <input type="date" value={form.renews_on}
              onChange={(e) => setForm({ ...form, renews_on: e.target.value })}
              style={{ ...input, width: 160 }} />
          </Field>
          <div style={buttonRowOffset}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}
              title="Tick if letting this lapse would break the platform — the domain does, because it takes every email address with it.">
              <input type="checkbox" checked={form.critical}
                onChange={(e) => setForm({ ...form, critical: e.target.checked })} />
              critical
            </label>
            <button onClick={add} disabled={saving} style={{ ...btn, color: 'var(--crm-ink)' }}>
              {saving ? 'Saving…' : '+ Add'}
            </button>
          </div>
        </FieldRow>

        <div style={{ marginTop: 12 }}>
          {data.expenses.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--crm-w40)' }}>
              Nothing entered yet. FAL and kie are measured automatically — only the fixed
              subscriptions need typing, and they change about once a year.
            </div>
          ) : data.expenses.map((x) => (
            <div key={x.id} style={{
              display: 'flex', gap: 12, alignItems: 'center', fontSize: 12.5,
              padding: '6px 0', borderTop: '1px solid var(--crm-w06)',
              opacity: x.cancelled_at ? 0.45 : 1,
            }}>
              <span style={{ minWidth: 200 }}>
                {x.name}
                {x.critical && <span style={{ color: 'var(--crm-red)' }} title="breaks the platform if it lapses"> ●</span>}
                {x.cancelled_at && <span style={{ color: 'var(--crm-w35)' }}> · cancelled</span>}
              </span>
              <span style={{ color: 'var(--crm-w40)', minWidth: 110 }}>{x.category}</span>
              <span style={{ minWidth: 110 }}>{usd(x.amount)} / {x.cycle}</span>
              <span style={{ color: 'var(--crm-w40)' }}>{x.renews_on || '—'}</span>
              <button onClick={() => cancel(x)} style={{ ...btn, marginLeft: 'auto', fontSize: 11.5 }}>
                {x.cancelled_at ? 'reopen' : 'cancel'}
              </button>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--crm-w35)', marginTop: 10, lineHeight: 1.5 }}>
          Cancelled costs are marked, never deleted — a cost that vanishes from history makes
          last quarter look wrong.
        </div>
      </div>
    </div>
  );
}
