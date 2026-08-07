// ─── CreditsModal ────────────────────────────────────────────────────────────
// Reused for grant / revoke / ban / unban — the action and labels switch but
// the modal shape (amount + reason + confirm) is the same. Reason is REQUIRED
// because every change writes to credits_history forever.
import React, { useState, useEffect } from 'react';
import Field from './FormField';

export default function CreditsModal({ user, action, onClose, onSubmit }) {
  const [amount, setAmount] = useState('10');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => { setAmount('10'); setReason(''); setTried(false); }, [user, action]);

  const isCredit = action === 'grant' || action === 'revoke';
  const isBan = action === 'ban' || action === 'unban';

  async function handleSubmit(e) {
    e.preventDefault();
    setTried(true);
    // Reason is required for a credit change (it goes in the ledger forever)
    // and optional for a ban, which is what the label and the server both say.
    //
    // This used to be an unconditional `if (!reason.trim()) return;` while the
    // Ban button stayed ENABLED — so pressing Ban with no reason silently did
    // nothing at all: no request, no error, no feedback. Found 2026-08-07.
    if (isCredit && !reason.trim()) return;
    if (isCredit && !(Number(amount) >= 0)) return;
    setSubmitting(true);
    try { await onSubmit({ amount: Number(amount), reason: reason.trim() }); }
    finally { setSubmitting(false); }
  }

  const missingAmount = isCredit && tried && !(Number(amount) >= 0);
  const missingReason = isCredit && tried && !reason.trim();

  const titles = {
    grant:  `Add credits to ${user.email}`,
    revoke: `Remove credits from ${user.email}`,
    ban:    `Ban ${user.email}`,
    unban:  `Unban ${user.email}`,
  };
  const accents = { grant: 'var(--crm-green)', revoke: 'var(--crm-amber)', ban: 'var(--crm-red)', unban: 'var(--crm-green)' };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} style={modalStyle}>
        <div style={{ color: 'var(--crm-ink)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          {titles[action]}
        </div>
        <div style={{ color: 'var(--crm-w40)', fontSize: 12, marginBottom: 18 }}>
          Current balance: {Number(user.credits).toFixed(2)} credits.
          {isCredit && ' This change will be visible in the user\'s history forever.'}
        </div>

        {isCredit && (
          <Field label="AMOUNT" required invalid={missingAmount}
            message="Enter how many credits"
            info={action === 'grant'
              ? 'How many credits to ADD to this account. Decimals are allowed (0.5 is half a credit). The balance above goes up by this amount.'
              : 'How many credits to REMOVE from this account. Decimals are allowed. It cannot take the balance below zero.'}>
            <input
              type="number" required min="0" step="0.01" value={amount}
              aria-required="true" aria-invalid={missingAmount}
              onChange={e => setAmount(e.target.value)}
              style={{ ...inputStyle, ...(missingAmount ? invalidStyle : null) }} autoFocus
            />
          </Field>
        )}

        <Field
          label="REASON"
          required={isCredit}
          invalid={missingReason}
          message="Enter a reason — it is stored in the credit history forever"
          style={{ marginTop: isCredit ? 12 : 0 }}
          info={isCredit
            ? 'Why you are making this change. It is written to the credit history permanently and cannot be edited later, so write something you would still understand in six months — e.g. “goodwill after failed render”.'
            : 'Optional. A short note explaining the ban, kept in the admin audit log. You can leave it empty.'}>
          <textarea
            required={isCredit}
            aria-required={isCredit}
            aria-invalid={missingReason}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={isBan ? 'Reason (logged in audit)' : 'Why? Logged forever in credit history.'}
            rows={3} style={{
              ...inputStyle, resize: 'vertical', minHeight: 70, paddingTop: 10,
              ...(missingReason ? invalidStyle : null),
            }}
          />
        </Field>

        <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button type="submit" disabled={submitting || (isCredit && !reason.trim())} style={{
            ...confirmBtnStyle,
            background: accents[action],
            color: '#000',
            opacity: submitting ? 0.6 : 1,
            cursor: submitting ? 'wait' : 'pointer',
          }}>
            {submitting ? 'Working…' : titles[action].split(' ')[0]}
          </button>
        </div>
      </form>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'var(--crm-overlay)',
  backdropFilter: 'blur(8px)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 999,
  fontFamily: '"DM Sans", sans-serif',
};
const modalStyle = {
  width: 420, padding: 24,
  background: 'var(--crm-surface)',
  border: '1px solid var(--crm-w10)', borderRadius: 16,
};
const inputStyle = {
  width: '100%', height: 38, padding: '0 12px',
  background: 'var(--crm-w04)', border: '1px solid var(--crm-w08)',
  borderRadius: 10, color: 'var(--crm-ink)', fontSize: 14, outline: 'none',
  fontFamily: 'inherit',
};
const invalidStyle = {
  border: '1px solid var(--crm-red)',
  background: 'var(--crm-red-bg)',
};
const cancelBtnStyle = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  borderRadius: 9, color: 'var(--crm-ink)', cursor: 'pointer',
};
const confirmBtnStyle = {
  padding: '8px 16px', fontSize: 13, fontWeight: 700,
  border: 'none', borderRadius: 9,
};
