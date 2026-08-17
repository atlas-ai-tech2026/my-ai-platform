// ─── BulkExpiryPanel ─────────────────────────────────────────────────────────
// Close access for every existing customer account at once — what you do when
// a workshop ends and the next cohort will arrive on its own codes.
//
// WHY THIS EXISTS: on 2026-08-11 an audit found 584 of 587 accounts had no
// expiry at all and none had ever expired, because expiry could only be set
// when bulk-CREATING accounts. Meanwhile 112 people signed in that week on
// credits from finished workshops.
//
// WHAT IT DOES NOT DO — and the reason it is safe to press:
//   · deletes nothing. Not the account, not the balance, not the credit
//     history, not a single generated image or video.
//   · hides nothing. The CRM user list has no expiry filter, so every one of
//     these people stays visible here with all their data.
//   · admins are excluded ON THE SERVER, in the SQL. This button cannot lock
//     you out of the panel you would need to undo it.
//   · reversible. "Reopen access" clears the date and everyone is back.
import React, { useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import Field, { FieldRow } from './FormField';

/** Default to a week out, not today: cutting people off mid-session is a
 *  support incident, and a grace period costs nothing. */
function defaultDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export default function BulkExpiryPanel({ onDone, onError }) {
  const [date, setDate] = useState(defaultDate());
  // Promo codes whose people must KEEP working — the workshop still running.
  const [keepCodes, setKeepCodes] = useState('');
  const [keepDays, setKeepDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function apply(mode) {
    const label = mode === 'clear'
      ? 'Reopen access for ALL customer accounts?'
      : `Close access for all existing customer accounts on ${date}?`;
    if (!window.confirm(
      `${label}\n\nNothing is deleted — balances, history and generated work all stay, ` +
      `and you can reverse this at any time. Admin accounts are never affected.`
    )) return;

    setBusy(true);
    try {
      const codes = keepCodes.split(/[\s,]+/).map(c => c.trim()).filter(Boolean);
      const r = await adminApi.setBulkExpiry(
        mode === 'clear'
          ? { mode: 'clear' }
          : {
              mode: 'set', expires_at: date, scope: 'existing',
              keep_codes: codes.length ? codes : undefined,
              keep_access_days: codes.length && keepDays ? keepDays : undefined,
            });
      toast.success(
        mode === 'clear'
          ? `Access reopened for ${r.changed} account(s).`
          : `${r.changed} account(s) will lose access on ${date}.` +
            (r.kept_by_promo_code ? ` ${r.kept_by_promo_code} kept by promo code.` : '') +
            ` ${r.admins_skipped} admin account(s) untouched.`);
      onDone?.();
    } catch (e) {
      onError?.(e);
      toast.error(e?.message || 'Could not update account expiry.');
    } finally { setBusy(false); }
  }

  // COLLAPSED STATE. This used to render as bare 12px dim-grey text — no
  // border, no background, no margin — sitting flush on top of the Refund
  // Audit button. It read as a CAPTION FOR THAT BUTTON, not as something you
  // could click. The owner looked straight at it on 2026-08-17 and reported
  // the promo-code field as missing from production; the field was there all
  // along, behind a control that did not look like one.
  //
  // The most consequential action in this panel should not be the faintest
  // thing on the screen. It now matches its sibling buttons and owns its own
  // row, so it can never again be mistaken for a label belonging to them.
  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setOpen(true)} style={openBtn}>
          ⏳ Bulk account access…
        </button>
      </div>
    );
  }

  return (
    <div style={{
      marginBottom: 16, padding: '14px 16px', borderRadius: 12,
      background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14 }}>Bulk account access</div>
        <button onClick={() => setOpen(false)} style={linkBtn}>close</button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--crm-w60)', lineHeight: 1.6, marginBottom: 12 }}>
        Closes sign-in for every <strong>existing</strong> customer account. Nothing is deleted —
        balances, credit history and generated work all remain, and everyone stays visible in this
        table. <strong>Admin accounts are never affected.</strong> Reversible at any time.
      </div>

      <FieldRow>
        <Field label="Keep these promo codes working"
          info="Anyone who redeemed one of these codes is NOT expired — use this for a workshop that is still running. Paste the codes separated by spaces, commas or new lines. If a code does not exist the whole operation is refused and nothing changes, so a typo cannot expire the workshop you meant to protect.">
          <textarea rows={3} value={keepCodes} onChange={e => setKeepCodes(e.target.value)}
            placeholder="VOXEL-XXXX-XXXX, VOXEL-YYYY-YYYY"
            style={{ ...inputStyle, width: 340, resize: 'vertical' }} />
        </Field>
        <Field label="Days for those kept"
          info="How long the spared people keep access, counted from THEIR OWN redemption day — not from today. Someone who redeemed on the 3rd gets a different end date from someone who redeemed on the 9th. It only ever extends an existing window, never shortens one.">
          <input type="number" min="1" max="3650" value={keepDays}
            onChange={e => setKeepDays(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Access ends on" required
          info="The day existing customers stop being able to sign in. Defaults to a week ahead so nobody is cut off mid-session. Accounts created AFTER you press the button are not affected — they arrive on their own promo code.">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        </Field>
      </FieldRow>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={() => apply('set')} disabled={busy || !date} style={dangerBtn}>
          {busy ? 'Working…' : 'Close access on this date'}
        </button>
        <button onClick={() => apply('clear')} disabled={busy} style={ghostBtn}>
          Reopen access for everyone
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  background: 'var(--crm-w05)', border: '1px solid var(--crm-w12)', borderRadius: 8,
  padding: '8px 11px', fontSize: 13, color: 'var(--crm-ink)', outline: 'none',
  fontFamily: '"DM Sans", sans-serif',
  // colour-scheme is handled globally by crmTheme:
  //   [data-crm-theme] input { color-scheme: inherit }
  // so the native date picker already follows light/dark without help here.
};
const dangerBtn = {
  padding: '9px 16px', fontSize: 13, fontWeight: 700, borderRadius: 9,
  background: 'var(--crm-red-bg)', border: '1px solid var(--crm-red-br)',
  color: 'var(--crm-red)', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
};
const ghostBtn = {
  padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 9,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-w85)', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
};
const linkBtn = {
  background: 'none', border: 'none', color: 'var(--crm-w50)', fontSize: 12,
  cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', padding: 0,
};
// Deliberately identical to auditBtnStyle in AdminPanel.jsx: this sits beside
// Refund Audit and Download Backup, and three controls doing the same KIND of
// thing — opening something — should look alike. Clicking only opens the
// panel; every destructive step is still behind a confirm dialog inside it.
const openBtn = {
  height: 36, padding: '0 16px', borderRadius: 10, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 13, fontWeight: 600,
  fontFamily: '"DM Sans", sans-serif',
};
