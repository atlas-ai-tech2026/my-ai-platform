// ─── CreditsModal ────────────────────────────────────────────────────────────
// Reused for grant / revoke / ban / unban — the action and labels switch but
// the modal shape (amount + reason + confirm) is the same. Reason is REQUIRED
// because every change writes to credits_history forever.
import React, { useState, useEffect } from 'react';

export default function CreditsModal({ user, action, onClose, onSubmit }) {
  const [amount, setAmount] = useState('10');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setAmount('10'); setReason(''); }, [user, action]);

  const isCredit = action === 'grant' || action === 'revoke';
  const isBan = action === 'ban' || action === 'unban';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    try { await onSubmit({ amount: Number(amount), reason: reason.trim() }); }
    finally { setSubmitting(false); }
  }

  const titles = {
    grant:  `Add credits to ${user.email}`,
    revoke: `Remove credits from ${user.email}`,
    ban:    `Ban ${user.email}`,
    unban:  `Unban ${user.email}`,
  };
  const accents = { grant: '#88ee88', revoke: '#ffaa44', ban: '#ff6666', unban: '#88ee88' };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} style={modalStyle}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          {titles[action]}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 18 }}>
          Current balance: {Number(user.credits).toFixed(2)} credits.
          {isCredit && ' This change will be visible in the user\'s history forever.'}
        </div>

        {isCredit && (
          <>
            <Label>Amount</Label>
            <input
              type="number" required min="0" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)}
              style={inputStyle} autoFocus
            />
          </>
        )}

        <Label style={{ marginTop: isCredit ? 12 : 0 }}>
          Reason {isBan && <span style={{ color: 'rgba(255,255,255,0.4)' }}>(optional)</span>}
        </Label>
        <textarea
          required={isCredit}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={isBan ? 'Reason (logged in audit)' : 'Why? Logged forever in credit history.'}
          rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 70, paddingTop: 10 }}
        />

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

const Label = ({ children, style }) => (
  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase', ...style }}>
    {children}
  </div>
);

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(8px)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 999,
  fontFamily: '"DM Sans", sans-serif',
};
const modalStyle = {
  width: 420, padding: 24,
  background: 'rgba(18,18,22,0.95)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
};
const inputStyle = {
  width: '100%', height: 38, padding: '0 12px',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none',
  fontFamily: 'inherit',
};
const cancelBtnStyle = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 9, color: '#fff', cursor: 'pointer',
};
const confirmBtnStyle = {
  padding: '8px 16px', fontSize: 13, fontWeight: 700,
  border: 'none', borderRadius: 9,
};
