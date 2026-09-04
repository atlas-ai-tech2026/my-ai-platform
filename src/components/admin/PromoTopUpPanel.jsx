// ─── PromoTopUpPanel ─────────────────────────────────────────────────────────
// Raising a code's value, and levelling up everyone who already used it.
//
// Owner, 2026-09-04: "They told me, please, we need to keep it with the same
// promo code, and I need to increase the credit with the same promo code and
// account." Saying "no, take a second code" is a bad answer to a paying
// customer — and it is how four codes ended up named "SPA News Academy 5th".
//
// ☠ IT SPENDS REAL MONEY. 59 people × 92 credits is about $344. So the bill is
// stated in words before anything moves, and applying sends back the headcount
// the preview showed: if someone redeemed in between they already received the
// NEW value, and topping them up as well would pay them twice.
import React, { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function PromoTopUpPanel({ promo, onError, onDone }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (!(Number(next) > 0)) { toast.error('Enter the new value for this code'); return; }
    setBusy(true);
    try { setPlan(await adminApi.promoTopUpPreview(promo.id, Number(next))); }
    catch (e) { onError?.(e, 'Could not work out what this would do'); }
    finally { setBusy(false); }
  }, [next, promo.id, onError]);

  const apply = useCallback(async () => {
    if (!plan?.ok) return;
    if (!window.confirm(`${plan.sentence}\n\nGo ahead?`)) return;
    setBusy(true);
    try {
      const r = await adminApi.promoTopUpApply(promo.id, plan.to, plan.people);
      toast.success(r.sentence);
      setPlan(null); setNext(''); setOpen(false);
      onDone?.();
    } catch (e) { onError?.(e, 'Nothing was changed'); }
    finally { setBusy(false); }
  }, [plan, promo.id, onError, onDone]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={btn}
        title={`Raise ${promo.code} above its current ${promo.credits} credits, and give everyone who already redeemed the difference`}>
        ↑ Raise the value
      </button>
    );
  }

  return (
    <div style={{ border: '1px solid var(--crm-w08)', borderRadius: 10, padding: '12px 14px',
                  background: 'var(--crm-w03)', marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        Raise {promo.code} — it is worth {num(promo.credits)} credits now
      </div>
      <div style={{ fontSize: 12, color: 'var(--crm-w50)', lineHeight: 1.6, marginBottom: 10 }}>
        Everyone who has <b>already redeemed</b> receives the difference, and anyone redeeming from
        now on gets the new value. No new code, and they do nothing — the credits simply arrive.
        The credits live as long as this code&rsquo;s access days.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em',
                         textTransform: 'uppercase', color: 'var(--crm-w40)',
                         display: 'flex', alignItems: 'center', gap: 6 }}>
            New value
            <InfoDot label="New value"
              text={'What one redemption of this code should be worth from now on. Everyone who '
                + 'has ALREADY redeemed receives the difference — not the whole new figure, which '
                + 'would pay them twice. Anyone redeeming later simply gets the new value, so '
                + 'nobody ends up with more or less than anybody else. It can only go UP: credits '
                + 'people have already spent cannot be taken back, so lowering a code is refused '
                + 'rather than half-performed. The credits given out live as long as this '
                + 'code\u2019s own access days.'} />
          </span>
          <input type="number" min="1" value={next} aria-label={`New value for ${promo.code}`}
            onChange={(e) => { setNext(e.target.value); setPlan(null); }}
            placeholder={`more than ${promo.credits}`}
            style={{ ...inputStyle, width: 160 }} />
        </label>
        <button onClick={check} disabled={busy} style={btn}>
          {busy && !plan ? 'Checking…' : 'Check first'}
        </button>
        <button onClick={() => { setOpen(false); setPlan(null); setNext(''); }} style={btn}>Cancel</button>
      </div>

      {plan && (
        <div style={{
          marginTop: 11, padding: '10px 12px', borderRadius: 9,
          background: plan.ok ? 'var(--crm-green-bg)' : 'var(--crm-amber-bg)',
          fontSize: 12.5, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, marginBottom: plan.ok ? 8 : 0 }}>{plan.sentence}</div>
          {plan.ok && (
            <>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 9 }}>
                <Stat k="People" v={num(plan.people)} />
                <Stat k="Each receives" v={`+${num(plan.each)}`} />
                <Stat k="Total credits" v={num(plan.total_credits)} />
                <Stat k="Cost" v={`$${num(plan.total_usd)}`} accent />
              </div>
              <button onClick={apply} disabled={busy} style={primaryBtnStyle}>
                {busy ? 'Raising…' : `Raise to ${num(plan.to)} and give ${num(plan.people)} ${plan.people === 1 ? 'person' : 'people'} +${num(plan.each)}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, accent }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                    textTransform: 'uppercase', color: 'var(--crm-w40)' }}>{k}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent ? 'var(--crm-orange)' : 'var(--crm-ink)' }}>{v}</div>
    </div>
  );
}

const inputStyle = {
  height: 34, padding: '0 10px', borderRadius: 9, background: 'var(--crm-w04)',
  border: '1px solid var(--crm-w10)', color: 'var(--crm-ink)', fontSize: 12.5,
  outline: 'none', fontFamily: 'inherit',
};
const btn = {
  height: 32, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)', color: 'var(--crm-ink)',
  fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
};
const primaryBtnStyle = {
  height: 34, padding: '0 14px', borderRadius: 9, cursor: 'pointer',
  background: '#e0442c', border: 'none', color: '#fff', fontSize: 12.5, fontWeight: 700,
  fontFamily: 'inherit',
};
