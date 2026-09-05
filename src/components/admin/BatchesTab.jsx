// ─── BatchesTab ──────────────────────────────────────────────────────────────
// One row per thing you did, not per person. The invoice view.
//
// Owner, 2026-09-04: "After the workshop I go manually to the promo codes and
// take the name, the number of credits, the promo code, the number of accounts
// that used it, then put it manually on the invoice. This will take headache."
//
// It did. The ledger holds one row per PERSON, so a 71-person top-up meant
// reading 71 rows and adding them up by hand, in a screen built for a
// different question. This answers his question directly: what did we hand
// out, to how many people, on what day, and what is it worth.
//
// ☠ MANUAL GRANTS WERE OFF BY DEFAULT, AND ARE NOW ON.
// He first asked for the old hand-grants to be left out — "this is behaviour
// and action, we will not do it again" — so they were excluded, with a line
// saying what that left out. Then he looked at them: fourteen pages, almost
// all of it SPA, SPA 2 and SPA 4, and he wanted each one collected into a
// single line with its total. Off by default hid the very rows he needed.
//
// They are four tidy rows now instead of seventeen messy ones, so they belong
// in the total. The type buttons still turn them off in one click, and when
// they are off the screen still says what is being left out — because $9,605
// quietly missing from a money total is the failure this project keeps
// finding.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = (u) => '$' + Number(u || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// What the date column does NOT show, for anyone who wants it.
//
// A promo row is dated by the day the CODE was generated — the date Amr
// invoices on — so the day people actually redeemed is a different fact and is
// kept here rather than thrown away. Everything else is dated by its first
// ledger day, and only says anything when a batch spanned more than one.
const dateNote = (b) => {
  const parts = [];
  if (b.issued) {
    parts.push(`Code generated ${dayText(b.date)}`);
    if (b.first_used && b.first_used !== b.date) parts.push(`first redeemed ${dayText(b.first_used)}`);
  }
  if (b.days > 1) parts.push(`handed out over ${b.days} days, to ${dayText(b.date_to)}`);
  return parts.length ? `${parts.join(' · ')}.` : '';
};

const dayText = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined,
  { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const TYPE_TONE = {
  'Promo code': 'var(--crm-purple)',
  'Promo top-up': 'var(--crm-purple)',
  'Bulk top-up': 'var(--crm-blue)',
  'Bulk - new accounts': 'var(--crm-blue)',
  'Gift card': 'var(--crm-pink)',
  'Manual grant': 'var(--crm-green)',
};

/** The four kinds a person can filter by, in the words the table uses. */
const SOURCES = [
  { id: 'promo', label: 'Promo codes' },
  { id: 'bulk', label: 'Bulk' },
  { id: 'gift', label: 'Gift cards' },
  { id: 'manual', label: 'Manual grants' },
];

export default function BatchesTab({ onError }) {
  const [q, setQ] = useState({ q: '', from: '', to: '' });
  // ☠ ALL FOUR ON. Manual grants were off at first — the owner had said "we
  // will not do it again, don't include it". Then he looked: fourteen pages of
  // them, almost all SPA, SPA 2 and SPA 4, and he wanted each collected into
  // one line with its total. Off by default hid the very rows he needed. They
  // are four tidy rows now, not seventeen messy ones, so they belong in the
  // total — and the type buttons still turn them off in one click.
  const [picked, setPicked] = useState(() => new Set(['promo', 'bulk', 'gift', 'manual']));
  const [data, setData] = useState(null);
  const [hiddenManual, setHiddenManual] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const sources = [...picked].join(',');
      const r = await adminApi.creditBatches({ ...q, sources });
      setData(r);
      // What the filter is keeping out, so the number on screen is never a
      // silent partial answer.
      if (!picked.has('manual')) {
        const all = await adminApi.creditBatches({ ...q, sources: 'manual' });
        setHiddenManual(all.totals);
      } else setHiddenManual(null);
    } catch (e) { onError?.(e, 'Could not load the batches'); }
    finally { setBusy(false); }
  }, [q, picked, onError]);

  useEffect(() => { load(); }, [load]);

  // ☠ MARKING A BATCH NOT-BILLABLE NEVER TOUCHES THE LEDGER.
  // Amr, 2026-09-05: "If there is something we need to do to remove it from
  // the table, because it's not logical. I just want the actual data which I
  // have." He means "dahi test" and "radwan from senyar agency ( test )" must
  // not sit inside a figure he invoices from — NOT that those people should
  // lose their credits. So the row stays, struck out, and leaves the total.
  const setExcluded = async (b, excluded) => {
    try {
      await adminApi.excludeBatch(b.key, excluded, b.name);
      toast.success(excluded
        ? `"${b.name}" is out of the total.`
        : `"${b.name}" is back in the total.`);
      load();
    } catch (e) { onError?.(e, 'Could not save that'); }
  };

  const toggle = (id) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const batches = data?.batches || [];
  const totals = data?.totals;

  const exportCsv = useCallback(() => {
    if (!batches.length) { toast.error('Nothing to export'); return; }
    // ☠ THE EXPORTED TOTAL IS THE BILLABLE TOTAL. A file that adds up test
    // grants is worse than no file — it becomes an invoice.
    const head = ['Name', 'Type', 'Promo code', 'First date', 'Last date', 'Days',
      'Accounts', 'Entries', 'Credits', 'Value USD', 'On the invoice'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(',')].concat(batches.map((b) => [
      b.name, b.type, b.code || '', b.date, b.date_to || b.date, b.days || 1,
      b.accounts, b.entries, b.credits, b.usd, b.excluded ? 'NO' : 'yes',
    ].map(esc).join(',')));
    lines.push('');
    lines.push([esc('TOTAL (on the invoice)'), '', '', '', '', '',
      esc(totals.accounts), '', esc(totals.credits), esc(totals.usd), ''].join(','));
    if (totals.excluded) {
      lines.push([esc(`${totals.excluded} batch(es) left out of that total`),
        '', '', '', '', '', '', '', esc(totals.excluded_credits), '', esc('NO')].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `voxel-batches-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [batches, totals]);

  const set = (k) => (e) => setQ((p) => ({ ...p, [k]: e.target.value }));

  const [showUnredeemed, setShowUnredeemed] = useState(false);
  const unredeemed = data?.promo_codes?.unredeemed ?? [];
  const promoTotal = data?.promo_codes?.total ?? 0;

  const spellingNote = useMemo(
    () => batches.filter((b) => b.spellings > 1), [batches]);

  return (
    <div>
      <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        Every batch of credits you have handed out — one row per thing you did, not per person.
        Promo codes, Bulk, gift cards and hand-typed grants, with the accounts and the totals for
        each. Built for copying onto an invoice. <b>Additions only</b>: customer spending and
        refunds are not here, and neither are credits taken back.
      </div>

      <div style={{ ...panel, marginBottom: 14 }}>
        <div style={{ ...panelTitle, display: 'flex', alignItems: 'center', gap: 7 }}>
          Filters
          <InfoDot label="Filters"
            text={'Search matches the words typed when the credits were given — a workshop name, '
              + 'or a promo code. Dates are inclusive. The type buttons decide which kinds are '
              + 'counted, and the totals follow them: turn one off and it leaves the total, which '
              + 'is why the line underneath says what is being left out.'} />
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 11 }}>
          <Field label="Search name or code">
            <input value={q.q} onChange={set('q')} aria-label="Search name or code"
              placeholder="e.g. SPA News Academy" style={input} />
          </Field>
          <Field label="From">
            <input type="date" value={q.from} onChange={set('from')} aria-label="From" style={input} />
          </Field>
          <Field label="To">
            <input type="date" value={q.to} onChange={set('to')} aria-label="To" style={input} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em',
                         textTransform: 'uppercase', color: 'var(--crm-w40)' }}>Type</span>
          {SOURCES.map((s) => (
            <button key={s.id} onClick={() => toggle(s.id)}
              aria-pressed={picked.has(s.id)}
              style={{
                ...chip,
                background: picked.has(s.id) ? 'var(--crm-w10)' : 'transparent',
                color: picked.has(s.id) ? 'var(--crm-ink)' : 'var(--crm-w40)',
                borderColor: picked.has(s.id) ? 'var(--crm-w20)' : 'var(--crm-w08)',
              }}>
              {picked.has(s.id) ? '✓ ' : ''}{s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ☠ WHAT THE FILTER IS KEEPING OUT, said out loud. A money total that
          quietly covers less than the reader assumes is the failure this
          project keeps finding — including twice on these very screens. */}
      {hiddenManual?.batches > 0 && (
        <div style={{
          background: 'var(--crm-amber-bg)', border: '1px solid var(--crm-w08)', borderRadius: 10,
          padding: '10px 13px', marginBottom: 14, fontSize: 12.5, lineHeight: 1.6,
        }}>
          <b>Not counted above:</b> {num(hiddenManual.batches)} hand-typed grant
          {hiddenManual.batches === 1 ? '' : 's'} worth {num(hiddenManual.credits)} credits
          ({money(hiddenManual.usd)}) — the old way of doing it.{' '}
          <button onClick={() => toggle('manual')} style={linkBtn}>Include them</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 14 }}>
        <Stat k="Batches" v={totals ? num(totals.batches) : '—'} n="matching the filters" />
        <Stat k="Accounts" v={totals ? num(totals.accounts) : '—'} n="added together per batch" />
        <Stat k="Credits" v={totals ? num(totals.credits) : '—'} n="handed out" />
        <Stat k="Value" v={totals ? money(totals.usd) : '—'}
          n={data?.credit_value ? `at $${data.credit_value}/credit` : 'rate unavailable'}
          accent />
      </div>

      {/* The exclusion must never itself become a silence. Money quietly
          missing from a money total is this project's oldest bug; the cure for
          it cannot be a second, quieter version of it. */}
      {totals?.excluded > 0 && (
        <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginBottom: 11, lineHeight: 1.6 }}>
          {totals.excluded} batch{totals.excluded === 1 ? ' is' : 'es are'} marked not-billable and
          {totals.excluded === 1 ? ' is' : ' are'} left out of these totals
          — {num(totals.excluded_credits)} credits. {totals.excluded === 1 ? 'It is' : 'They are'}
          {' '}struck out below; the credits themselves were not touched.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 11, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={exportCsv} disabled={!batches.length} style={btn}>⬇ Excel / CSV</button>
        <span style={{ fontSize: 12, color: 'var(--crm-w40)' }}>
          {busy ? 'Loading…' : `${num(batches.length)} batch${batches.length === 1 ? '' : 'es'}`}
        </span>
      </div>

      {spellingNote.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginBottom: 11, lineHeight: 1.6 }}>
          {/* The spellings themselves used to be listed here, which made one
              run-on line the width of the page. They live on the row that
              absorbed them now — hover "typed N ways" — so the detail is a
              hand's reach away instead of shouted at the top. */}
          {spellingNote.length} batch{spellingNote.length === 1 ? ' was' : 'es were'} named more than
          one way and {spellingNote.length === 1 ? 'has' : 'have'} been counted together.
          {' '}Hover a name marked <em>typed N ways</em> to see the spellings.
        </div>
      )}

      {/* ☠ WHY 27 CODES DO NOT MAKE 27 LINES.
          A promo code writes to the ledger only when somebody redeems it, so a
          code nobody used has no batch — right, since nothing was handed out,
          but silently right. Amr counted 27 on the Promo Codes screen, counted
          the rows here, and had no way to find the difference. Empty rows are
          not the fix: "0 accounts · $0.00" on an invoice screen is noise and
          is something that could be invoiced by mistake. Naming the gap is. */}
      {picked.has('promo') && unredeemed.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginBottom: 11, lineHeight: 1.6 }}>
          {promoTotal} promo code{promoTotal === 1 ? '' : 's'} exist
          {promoTotal === 1 ? 's' : ''}; {unredeemed.length} of them
          {unredeemed.length === 1 ? ' has' : ' have'} never been redeemed, so
          {unredeemed.length === 1 ? ' it is' : ' they are'} not listed — nothing was handed out.
          {' '}
          <button
            type="button"
            onClick={() => setShowUnredeemed((v) => !v)}
            style={linkBtn}
          >
            {showUnredeemed ? 'hide' : 'show which'}
          </button>
          {showUnredeemed && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {unredeemed.map((c) => (
                <li key={c.code} style={{ marginBottom: 2 }}>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5 }}>
                    {c.code}
                  </span>
                  {c.description ? ` — ${c.description}` : ''}
                  {c.active ? '' : ' · deactivated'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--crm-w08)', borderRadius: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
          <thead>
            <tr>
              {['Name', 'Type', 'Promo code', 'Dates', 'Accounts', 'Credits', 'Value', ''].map((h, i) => (
                <th key={h || `act${i}`} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data === null && <tr><td colSpan={8} style={{ ...td, color: 'var(--crm-w40)' }}>Loading…</td></tr>}
            {data && batches.length === 0 && (
              <tr><td colSpan={8} style={{ ...td, color: 'var(--crm-w40)' }}>
                No batches match these filters.
              </td></tr>
            )}
            {batches.map((b) => (
              <tr key={b.key} style={b.excluded ? { opacity: 0.45 } : undefined}>
                <td style={{ ...td, fontWeight: 600,
                             textDecoration: b.excluded ? 'line-through' : 'none' }}>
                  {b.name}
                  {b.spellings > 1 && (
                    <span
                      title={`Counted together: ${(b.spelt || []).join('  /  ')}`}
                      style={{ fontSize: 11, color: 'var(--crm-w40)', fontWeight: 400,
                               cursor: 'help', borderBottom: '1px dotted var(--crm-w20)' }}
                    >
                      {' '}· typed {b.spellings} ways
                    </span>
                  )}
                </td>
                <td style={td}>
                  <span style={{
                    display: 'inline-block', whiteSpace: 'nowrap', padding: '2px 9px',
                    borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                    color: TYPE_TONE[b.type] || 'var(--crm-w60)', background: 'var(--crm-w05)',
                  }}>{b.type}</span>
                </td>
                <td style={{ ...td, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5,
                             color: b.code ? 'var(--crm-w60)' : 'var(--crm-w30)' }}>
                  {b.code || '—'}
                </td>
                {/* ☠ ONE DATE, THE FIRST DAY — NOT A RANGE.
                    Amr, 2026-09-05: "The grant codes are created on different
                    times, and I will put it in one column. Put SPA one the
                    first day only, and anything that's on a different time or
                    different day, all of them, because it's only for one
                    session. And do the same for everything."
                    He is right and I had this backwards. A workshop is one
                    session; that its credits were typed in over two afternoons
                    is an artefact of how the typing went, not a fact about the
                    workshop, and putting it in the column made every long
                    batch a two-line cell. The span is not thrown away — it is
                    on hover, the same place the spellings went. */}
                <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--crm-w60)' }}>
                  {dateNote(b) ? (
                    <span
                      title={dateNote(b)}
                      style={{ cursor: 'help', borderBottom: '1px dotted var(--crm-w20)' }}
                    >
                      {dayText(b.date)}
                    </span>
                  ) : dayText(b.date)}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600,
                             fontVariantNumeric: 'tabular-nums' }}>{num(b.accounts)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700,
                             fontVariantNumeric: 'tabular-nums' }}>{num(b.credits)}</td>
                {/* Orange is this panel's money accent, not a warning — but a
                    whole column of it competes with the Value tile above and
                    makes 29 ordinary rows look urgent. The accent stays on the
                    total, where the eye should land. */}
                <td style={{ ...td, textAlign: 'right', fontWeight: 600,
                             fontVariantNumeric: 'tabular-nums' }}>
                  {money(b.usd)}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => setExcluded(b, !b.excluded)}
                    style={linkBtn}
                    title={b.excluded
                      ? 'Put this batch back into the total'
                      : 'Leave this batch out of the total. The credits are not touched.'}
                  >
                    {b.excluded ? 'Bill for it' : "Don't bill"}
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

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em',
                     textTransform: 'uppercase', color: 'var(--crm-w40)' }}>{label}</span>
      {children}
    </label>
  );
}
function Stat({ k, v, n, accent }) {
  return (
    <div style={{ ...panel, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
                     textTransform: 'uppercase', color: 'var(--crm-w40)' }}>{k}</span>
      <span style={{ fontSize: 22, fontWeight: 700,
                     color: accent ? 'var(--crm-orange)' : 'var(--crm-ink)' }}>{v}</span>
      <span style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>{n}</span>
    </div>
  );
}

const input = {
  height: 34, padding: '0 10px', borderRadius: 9, background: 'var(--crm-w04)',
  border: '1px solid var(--crm-w10)', color: 'var(--crm-ink)', fontSize: 12.5,
  outline: 'none', fontFamily: 'inherit', width: '100%',
};
const btn = {
  height: 32, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)', color: 'var(--crm-ink)',
  fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
};
const chip = {
  height: 28, padding: '0 11px', borderRadius: 999, cursor: 'pointer',
  border: '1px solid var(--crm-w08)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
};
const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
  color: 'var(--crm-orange)', textDecoration: 'underline', fontWeight: 600,
};
const panel = { background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)', borderRadius: 12, padding: 14 };
const panelTitle = { fontSize: 13, fontWeight: 600, color: 'var(--crm-w60)', marginBottom: 11 };
const th = {
  textAlign: 'left', padding: '10px 13px', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--crm-w40)',
  background: 'var(--crm-w03)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--crm-w08)',
};
const td = { padding: '10px 13px', color: 'var(--crm-w85)', borderBottom: '1px solid var(--crm-w05)' };
