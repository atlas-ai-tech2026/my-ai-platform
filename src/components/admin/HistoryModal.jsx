// ─── HistoryModal ────────────────────────────────────────────────────────────
// Read-only view of the user's credits_history rows.
import React from 'react';

export default function HistoryModal({ user, history, error, onClose }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ color: 'var(--crm-ink)', fontSize: 18, fontWeight: 700 }}>{user.email}</div>
            <div style={{ color: 'var(--crm-w40)', fontSize: 12 }}>Credit history</div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {/* Without the `error` branch a failed fetch left history null and this
              modal said "Loading…" for ever — a screen that waits patiently for
              something that already failed. */}
          {error && (
            <div style={{ color: 'var(--crm-red)', lineHeight: 1.6 }}>
              {error.status === 401
                ? 'Your admin session has expired — sign in again and the history will be here.'
                : `This ledger could not be read${error.status ? ` (server answered ${error.status})` : ''}. Nothing is missing — it is unknown.`}
            </div>
          )}
          {!history && !error && <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>}
          {history && !error && history.length === 0 && <div style={{ color: 'var(--crm-w50)' }}>No history yet.</div>}
          {history && history.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--crm-w10)', textAlign: 'left' }}>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Δ</Th>
                  <Th>KIE credit</Th>
                  <Th>FAL cost</Th>
                  <Th>By</Th>
                  <Th>Reason</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--crm-w04)' }}>
                    <Td>{new Date(h.created_at).toLocaleString()}</Td>
                    <Td><ActionPill action={h.action} /></Td>
                    <Td>
                      <span style={{
                        color: Number(h.amount) > 0 ? 'var(--crm-green)' : Number(h.amount) < 0 ? 'var(--crm-red)' : 'var(--crm-w50)',
                        fontWeight: 600,
                      }}>
                        {Number(h.amount) > 0 ? '+' : ''}{Number(h.amount).toFixed(2)}
                      </span>
                    </Td>
                    <Td>
                      {/* Estimated KIE credits this generation burned on our
                          kie.ai balance; "—" = FAL-backed / untracked row. */}
                      <span style={{ color: h.kie_credits ? 'var(--crm-purple)' : 'var(--crm-w30)', fontWeight: h.kie_credits ? 600 : 400 }}>
                        {h.kie_credits ? `−${Number(h.kie_credits).toFixed(2)}` : '—'}
                      </span>
                    </Td>
                    <Td>
                      {/* Estimated USD on our fal.ai bill; "—" = kie-backed / untracked. */}
                      <span style={{ color: h.fal_cost ? 'var(--crm-orange)' : 'var(--crm-w30)', fontWeight: h.fal_cost ? 600 : 400 }}>
                        {h.fal_cost ? `−$${Number(h.fal_cost).toFixed(2)}` : '—'}
                      </span>
                    </Td>
                    <Td>{h.admin_email || <span style={{ color: 'var(--crm-w30)' }}>system</span>}</Td>
                    <Td style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.reason || <span style={{ color: 'var(--crm-w30)' }}>—</span>}
                    </Td>
                    <Td style={{ color: 'var(--crm-w50)', fontSize: 11 }}>{h.ip_address || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const Th = ({ children }) => (
  <th style={{ padding: '8px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--crm-w50)' }}>
    {children}
  </th>
);
const Td = ({ children, style }) => (
  <td style={{ padding: '10px', color: 'var(--crm-w85)', verticalAlign: 'top', ...style }}>
    {children}
  </td>
);

function ActionPill({ action }) {
  const colors = {
    grant:  ['var(--crm-green)', 'var(--crm-green-bg)'],
    revoke: ['var(--crm-amber)', 'var(--crm-amber-bg)'],
    spend:  ['var(--crm-blue)', 'var(--crm-blue-bg)'],
    refund: ['var(--crm-violet)', 'var(--crm-violet-bg)'],
    promo:  ['var(--crm-purple)', 'var(--crm-purple-bg)'],
    gift:   ['var(--crm-pink)', 'var(--crm-pink-bg)'],
    ban:    ['var(--crm-red)', 'var(--crm-red-bg)'],
    unban:  ['var(--crm-green)', 'var(--crm-green-bg)'],
    signup: ['var(--crm-w70)', 'var(--crm-w06)'],
  };
  const [color, bg] = colors[action] || ['var(--crm-w70)', 'var(--crm-w06)'];
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
      background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{action}</span>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'var(--crm-overlay)',
  backdropFilter: 'blur(8px)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 999,
  fontFamily: '"DM Sans", sans-serif',
};
const modalStyle = {
  width: 'min(820px, 92vw)', maxHeight: '85vh', padding: 24,
  background: 'var(--crm-surface)',
  border: '1px solid var(--crm-w10)', borderRadius: 16,
  display: 'flex', flexDirection: 'column',
};
const closeBtnStyle = {
  width: 32, height: 32, fontSize: 24, lineHeight: '24px',
  background: 'transparent', border: 'none', color: 'var(--crm-w60)',
  cursor: 'pointer',
};
