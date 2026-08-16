// ─── CustomerPanel ───────────────────────────────────────────────────────────
// One person, everything about them, in the time it takes to read their email.
// Tier 2.2.
//
// The scenario: an attendee writes "my video didn't work". Answering that today
// means opening a raw ledger of charges and refunds and working out by eye
// which refund cancels which charge. All the data has always been there; it has
// never been assembled into the sentence you actually need —
// "two Omni attempts failed, both already refunded".
//
// THE HONESTY RULE HERE. Outcomes recorded since 2026-08-16 are exact. Older
// ones are inferred: a charge with no refund following it is shown as
// delivered, which really means "nothing came back", not "we know it arrived".
// Every row says which it is, because a customer support answer built on a
// guess should be visibly a guess.
import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/adminApi';

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—');

const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '—');

export default function CustomerPanel({ user, onClose, onError }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setData(null);
    try { setData(await adminApi.customerOverview(user.id)); }
    catch (e) { onError?.(e); setData({ generations: [] }); }
  }, [user, onError]);

  useEffect(() => { load(); }, [load]);

  if (!user) return null;
  const c = data?.customer;
  const t = data?.totals || {};
  const gens = data?.generations || [];
  const ws = data?.workshops || [];
  const anyInferred = gens.some((g) => g.source === 'inferred');

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 17, color: 'var(--crm-ink)' }}>{user.email}</h3>
          <button onClick={onClose} style={{ ...btn, marginLeft: 'auto' }}>Close</button>
        </div>

        {/* One line that answers "who is this and are they still active". */}
        <div style={{ fontSize: 12, color: 'var(--crm-w55)', marginBottom: 14, lineHeight: 1.6 }}>
          {ws.length > 0 ? (
            <>
              {ws[0].workshop || ws[0].organisation || 'Workshop'}
              {ws[0].workshop_date ? ` · ${dayOf(ws[0].workshop_date)}` : ''}
              {' · '}<code style={{ color: 'var(--crm-w72)' }}>{ws[0].code}</code>
              {' · joined '}{dayOf(ws[0].redeemed_at)}
            </>
          ) : 'Signed up directly — no workshop code'}
          {c?.expires_at && (
            <> {' · '}
              <b style={{ color: new Date(c.expires_at) <= new Date() ? 'var(--crm-red)' : 'var(--crm-w72)' }}>
                {new Date(c.expires_at) <= new Date()
                  ? `access ended ${dayOf(c.expires_at)}`
                  : `access until ${dayOf(c.expires_at)}`}
              </b>
            </>
          )}
          {c?.banned && <> {' · '}<b style={{ color: 'var(--crm-red)' }}>BANNED</b></>}
        </div>

        {data === null && <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>}

        {c && (
          <div style={cards}>
            <Card k="Credits left" v={Number(c.credits).toLocaleString()} />
            <Card k="Generations" v={Number(t.generations || 0).toLocaleString()}
              n={t.last_generation ? `last ${when(t.last_generation)}` : 'never generated'} />
            <Card k="Refunded" v={Number(t.refunds || 0).toLocaleString()}
              n={`${Number(t.refunded || 0).toLocaleString()} credits back`}
              tone={Number(t.refunds) ? 'warn' : 'ok'} />
            <Card k="Recent failures" v={t.recent_failure_pct !== null ? `${t.recent_failure_pct}%` : '—'}
              n={`of the last ${gens.length} shown`}
              tone={t.recent_failure_pct === null ? '' : t.recent_failure_pct > 20 ? 'crit'
                : t.recent_failure_pct > 5 ? 'warn' : 'ok'} />
          </div>
        )}

        {data && !gens.length && (
          <div style={{ ...box, color: 'var(--crm-w55)' }}>
            This person has never generated anything.
            {c && Number(c.credits) > 0 && <> They still hold {Number(c.credits).toLocaleString()} credits.</>}
          </div>
        )}

        {gens.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>{['When', 'Model', 'Charged', 'Outcome', 'Took']
                  .map((h, i) => <th key={i} style={{ ...th, textAlign: i === 2 || i === 4 ? 'right' : 'left' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {gens.map((g, i) => (
                  <tr key={i}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(g.at)}</td>
                    <td style={{ ...td, color: 'var(--crm-ink)' }}>{g.model || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{g.charged}</td>
                    <td style={td}>
                      <span style={{
                        ...pill,
                        background: g.outcome === 'failed' ? 'var(--crm-red-bg)'
                          : g.outcome === 'delivered' ? 'var(--crm-green-bg)' : 'var(--crm-w06)',
                        color: g.outcome === 'failed' ? 'var(--crm-red)'
                          : g.outcome === 'delivered' ? 'var(--crm-green)' : 'var(--crm-w55)',
                      }}>
                        {g.outcome === 'failed' ? 'failed → refunded' : g.outcome}
                      </span>
                      {/* Marks a guess as a guess. */}
                      {g.source === 'inferred' && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--crm-w40)' }}
                          title="Worked out from the ledger — outcomes were not recorded before 16 Aug 2026">
                          inferred
                        </span>
                      )}
                      {g.failure_reason && (
                        <div style={{ fontSize: 10.5, color: 'var(--crm-w45)', marginTop: 2, maxWidth: '46ch' }}>
                          {g.failure_reason.slice(0, 120)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--crm-w45)' }}>
                      {g.duration_ms ? `${(g.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {anyInferred && (
          <div style={{ fontSize: 11.5, color: 'var(--crm-w45)', marginTop: 10, lineHeight: 1.55 }}>
            Rows marked <b>inferred</b> predate outcome recording (16 Aug 2026). For those,
            “delivered” means <b>no refund followed</b> — which is not quite the same as knowing the
            customer received it. Newer rows are recorded exactly, with the time taken.
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ k, v, n, tone }) {
  const fg = tone === 'ok' ? 'var(--crm-green)' : tone === 'warn' ? 'var(--crm-amber)'
    : tone === 'crit' ? 'var(--crm-red)' : 'var(--crm-ink)';
  return (
    <div style={box}>
      <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--crm-w45)' }}>{k}</div>
      <div style={{ fontSize: 20, fontWeight: 730, marginTop: 3, color: fg }}>{v}</div>
      {n && <div style={{ fontSize: 10.5, color: 'var(--crm-w45)', marginTop: 2 }}>{n}</div>}
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, background: 'var(--crm-overlay)', zIndex: 60,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px',
  overflowY: 'auto',
};
const sheet = {
  background: 'var(--crm-surface)', border: '1px solid var(--crm-w10)', borderRadius: 14,
  padding: '18px 20px', width: 'min(900px, 100%)', fontFamily: '"DM Sans", sans-serif',
  boxShadow: 'var(--crm-shadow)',
};
const box = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 10, padding: '10px 12px', marginBottom: 12,
};
const cards = {
  display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', marginBottom: 14,
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 620 };
const th = {
  fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--crm-w45)',
  fontWeight: 600, padding: '0 10px 8px 0', borderBottom: '1px solid var(--crm-w10)',
  position: 'sticky', top: 0, background: 'var(--crm-surface)',
};
const td = { padding: '8px 10px 8px 0', borderBottom: '1px solid var(--crm-w06)', color: 'var(--crm-w85)' };
const btn = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-w85)', cursor: 'pointer', fontFamily: 'inherit',
};
const pill = { padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' };
