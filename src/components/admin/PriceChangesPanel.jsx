// ─── PriceChangesPanel ───────────────────────────────────────────────────────
// Supplier price moves waiting on a decision, plus the manual sweep button.
//
// WHY THERE IS A DECISION AT ALL. The owner asked for prices to update
// automatically at 40% margin when a supplier raises theirs. This does the
// whole calculation — the row already says "12.5 → 15 credits" — but stops one
// click short of applying it, because fal states prices in prose mixing
// per-second, per-megapixel and token billing and has produced confidently
// wrong numbers twice in this project. Unattended, one bad parse multiplies a
// customer's price by ten overnight with nobody watching.
//
// So: the work is automatic, the commitment is not.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

// `scope` only changes the wording. The sweep is one job covering both
// providers and both questions — "what is new" and "what changed price" — so
// splitting it into two buttons would mean two network calls doing identical
// work and two "last checked" times that could disagree.
export default function PriceChangesPanel({ onError, onApplied, scope = 'models' }) {
  const onModels = scope === 'models';
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);      // id being resolved
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await adminApi.priceChanges('open')); }
    catch (e) { onError?.(e); setData({ changes: [] }); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await adminApi.costingSync();
      const fal = r.catalog?.found ?? 0;
      const kie = r.kie_catalog?.found ?? 0;
      toast.success(`Sync complete — fal: ${fal} · kie: ${kie} model group(s) not sold yet`);
      // A provider outage must be visible and NAMED. A "successful" sync that
      // silently checked nothing is how a stale queue looks fresh — and with
      // two providers, "the catalogue failed" is not enough to act on.
      if (r.catalog_error) toast.error(`fal catalogue: ${r.catalog_error}`);
      if (r.kie_catalog_error) toast.error(`kie catalogue: ${r.kie_catalog_error}`);
      await load();
    } catch (e) { onError?.(e); toast.error(e?.message || 'Sync failed.'); }
    finally { setSyncing(false); }
  };

  const resolve = async (id, action) => {
    setBusy(id);
    try {
      await adminApi.resolvePriceChange(id, action);
      toast.success(action === 'approve' ? 'Price updated.' : 'Change dismissed.');
      await load();
      if (action === 'approve') onApplied?.();
    } catch (e) { onError?.(e); toast.error(e?.message || 'Could not apply.'); }
    finally { setBusy(null); }
  };

  const changes = data?.changes || [];
  const pending = changes.filter((c) => c.status === 'pending');
  const suspect = changes.filter((c) => c.status === 'needs_check');

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14 }}>
          {onModels ? 'Supplier price changes' : 'Provider catalogue'}
        </div>
        <button onClick={sync} disabled={syncing} style={btn}>
          {syncing ? 'Checking…' : '⟳ Check now'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--crm-w45)' }}>
          {data?.synced_at
            ? `Last checked ${new Date(data.synced_at).toLocaleString()}`
            : 'Never checked manually — the nightly sweep runs at 00:00 UTC'}
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--crm-w55)', lineHeight: 1.6, marginBottom: 12 }}>
        {onModels ? (
          <>
            Did a supplier put its price up on a model <b>you already sell</b>? Checked nightly at
            <b> 00:00 UTC</b>, and whenever you press Check now. A <b>rise</b> is priced back to the
            40% margin and waits below for your approval; a <b>fall</b> is recorded but never lowers
            what you charge. Approving updates the costing row — it does not change what customers
            pay until that number is carried into pricing.
            <br />
            <span style={{ color: 'var(--crm-w45)' }}>
              A change needs two readings to exist: the first check records today's prices, and
              movement shows from the next one. fal publishes a price for most models; kie for only
              9 of 98 — the rest read “no published price”, never as free.
            </span>
          </>
        ) : (
          <>
            The same nightly sweep that finds these models also watches prices — price movement on
            models you <b>sell</b> is reviewed on the <b>Models</b> tab. Checked at <b>00:00 UTC</b>,
            or press Check now.
          </>
        )}
      </div>

      {data === null && <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>}

      {data && !changes.length && onModels && (
        <div style={{ color: 'var(--crm-w45)', fontSize: 13 }}>
          No supplier price changes waiting. ✅
        </div>
      )}

      {onModels && suspect.length > 0 && (
        <div style={{ ...banner, borderColor: 'var(--crm-amber-br)', background: 'var(--crm-amber-bg)', color: 'var(--crm-amber)' }}>
          ⚠️ {suspect.length} change(s) are too large to trust automatically (over 50%). A jump that
          size is usually the provider stating a different unit, not a real price move —
          <b> check the provider's page before approving</b>.
        </div>
      )}

      {onModels && [...suspect, ...pending].map((c) => (
        <div key={c.id} style={row}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ color: 'var(--crm-ink)', fontWeight: 600 }}>
              {c.model_name || c.family}
              {c.status === 'needs_check' && (
                <span style={pill}>verify</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--crm-w55)', marginTop: 2 }}>
              {c.provider.toUpperCase()} ${Number(c.old_price_usd).toFixed(4)} → $
              {Number(c.new_price_usd).toFixed(4)}{' '}
              <b style={{ color: Number(c.pct_change) > 0 ? 'var(--crm-red)' : 'var(--crm-green)' }}>
                {Number(c.pct_change) > 0 ? '↑' : '↓'}{Math.abs(Number(c.pct_change))}%
              </b>
              {' · '}detected {new Date(c.detected_at).toLocaleDateString()}
            </div>
          </div>

          <div style={{ minWidth: 150, fontSize: 13, color: 'var(--crm-ink)' }}>
            {c.old_credits != null && c.new_credits != null ? (
              <>our price <b>{c.old_credits} → {c.new_credits}</b> credits</>
            ) : <span style={{ color: 'var(--crm-w40)' }}>no price on file</span>}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => resolve(c.id, 'approve')} disabled={busy === c.id} style={approveBtn}>
              {busy === c.id ? '…' : 'Approve'}
            </button>
            <button onClick={() => resolve(c.id, 'skip')} disabled={busy === c.id} style={btn}>
              Skip
            </button>
          </div>
        </div>
      ))}

      {onModels && pending.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <button
            style={approveBtn}
            disabled={!!busy}
            onClick={async () => {
              if (!window.confirm(
                `Approve ${pending.length} price change(s)?\n\n` +
                `This updates the costing rows. Changes flagged "verify" are NOT included.`)) return;
              for (const c of pending) await resolve(c.id, 'approve');
            }}
          >
            Approve all {pending.length} (excludes flagged)
          </button>
        </div>
      )}
    </div>
  );
}

const wrap = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, padding: '14px 16px', marginBottom: 16,
  fontFamily: '"DM Sans", sans-serif',
};
const row = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '10px 0', borderTop: '1px solid var(--crm-w06)',
};
const btn = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-w85)', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
};
const approveBtn = {
  ...btn, background: 'var(--crm-green-bg)', border: '1px solid var(--crm-green-br)',
  color: 'var(--crm-green)',
};
const banner = {
  padding: '9px 12px', borderRadius: 9, fontSize: 12, lineHeight: 1.5,
  border: '1px solid', marginBottom: 10,
};
const pill = {
  marginLeft: 8, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
  background: 'var(--crm-amber-bg)', color: 'var(--crm-amber)',
  border: '1px solid var(--crm-amber-br)',
};
