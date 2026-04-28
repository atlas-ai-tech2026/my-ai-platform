// ─── HistoryModal ────────────────────────────────────────────────────────────
// Read-only view of the user's credits_history rows.
import React from 'react';

export default function HistoryModal({ user, history, onClose }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>{user.email}</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Credit history</div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {!history && <div style={{ color: 'rgba(255,255,255,0.5)' }}>Loading…</div>}
          {history && history.length === 0 && <div style={{ color: 'rgba(255,255,255,0.5)' }}>No history yet.</div>}
          {history && history.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Δ</Th>
                  <Th>By</Th>
                  <Th>Reason</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <Td>{new Date(h.created_at).toLocaleString()}</Td>
                    <Td><ActionPill action={h.action} /></Td>
                    <Td>
                      <span style={{
                        color: Number(h.amount) > 0 ? '#88ee88' : Number(h.amount) < 0 ? '#ff6666' : 'rgba(255,255,255,0.5)',
                        fontWeight: 600,
                      }}>
                        {Number(h.amount) > 0 ? '+' : ''}{Number(h.amount).toFixed(2)}
                      </span>
                    </Td>
                    <Td>{h.admin_email || <span style={{ color: 'rgba(255,255,255,0.3)' }}>system</span>}</Td>
                    <Td style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.reason || <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>}
                    </Td>
                    <Td style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{h.ip_address || '—'}</Td>
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
  <th style={{ padding: '8px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
    {children}
  </th>
);
const Td = ({ children, style }) => (
  <td style={{ padding: '10px', color: 'rgba(255,255,255,0.85)', verticalAlign: 'top', ...style }}>
    {children}
  </td>
);

function ActionPill({ action }) {
  const colors = {
    grant:  ['#88ee88', 'rgba(136,238,136,0.15)'],
    revoke: ['#ffaa44', 'rgba(255,170,68,0.15)'],
    spend:  ['#88aaff', 'rgba(136,170,255,0.15)'],
    refund: ['#aaaaff', 'rgba(170,170,255,0.15)'],
    ban:    ['#ff6666', 'rgba(255,102,102,0.15)'],
    unban:  ['#88ee88', 'rgba(136,238,136,0.15)'],
    signup: ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0.06)'],
  };
  const [color, bg] = colors[action] || ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0.06)'];
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
      background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{action}</span>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(8px)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 999,
  fontFamily: '"DM Sans", sans-serif',
};
const modalStyle = {
  width: 'min(820px, 92vw)', maxHeight: '85vh', padding: 24,
  background: 'rgba(18,18,22,0.95)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
  display: 'flex', flexDirection: 'column',
};
const closeBtnStyle = {
  width: 32, height: 32, fontSize: 24, lineHeight: '24px',
  background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)',
  cursor: 'pointer',
};
