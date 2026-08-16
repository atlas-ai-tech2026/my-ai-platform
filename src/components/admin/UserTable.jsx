// ─── UserTable ──────────────────────────────────────────────────────────────
// Paginated user list with per-row actions. Receives `users` + paginate/refresh
// callbacks from the parent page; doesn't fetch on its own.
import React from 'react';

export default function UserTable({ users, page, total, limit, onPage, onAction }) {
  if (!users) return <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>;
  if (users.length === 0) return <div style={{ color: 'var(--crm-w50)' }}>No users found.</div>;

  const totalPages = total ? Math.max(1, Math.ceil(total / limit)) : null;

  return (
    <>
      <div style={{
        background: 'var(--crm-w03)',
        border: '1px solid var(--crm-w06)', borderRadius: 12, overflow: 'hidden',
        fontFamily: '"DM Sans", sans-serif',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--crm-w08)', textAlign: 'left' }}>
              <Th>Email</Th>
              <Th>Credits</Th>
              <Th>Role</Th>
              <Th>Package</Th>
              <Th>Status</Th>
              <Th>Access</Th>
              <Th>Joined</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--crm-w04)' }}>
                <Td>
                  <div style={{ color: 'var(--crm-ink)' }}>{u.email}</div>
                  <div style={{ color: 'var(--crm-w35)', fontSize: 11 }}>id: {u.id}</div>
                </Td>
                <Td><strong style={{ color: 'var(--crm-ink)' }}>{Number(u.credits).toFixed(2)}</strong></Td>
                <Td><RoleBadge role={u.role} /></Td>
                <Td>{u.package || <span style={{ color: 'var(--crm-w30)' }}>—</span>}</Td>
                <Td>
                  {u.banned
                    ? <span style={{ color: 'var(--crm-red)', fontWeight: 600 }}>BANNED</span>
                    : <span style={{ color: 'var(--crm-green)' }}>active</span>}
                </Td>
                <Td><AccessCell expiresAt={u.expires_at} /></Td>
                <Td>{new Date(u.created_at).toLocaleDateString()}</Td>
                <Td align="right">
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <ActionBtn onClick={() => onAction('grant',  u)}>+ Credits</ActionBtn>
                    <ActionBtn onClick={() => onAction('revoke', u)}>− Credits</ActionBtn>
                    {u.role !== 'admin' && (
                      <ActionBtn
                        onClick={() => onAction(u.banned ? 'unban' : 'ban', u)}
                        accent={u.banned ? 'var(--crm-green)' : 'var(--crm-red)'}
                      >{u.banned ? 'Unban' : 'Ban'}</ActionBtn>
                    )}
                    <ActionBtn onClick={() => onAction('details', u)}>Details</ActionBtn>
                    <ActionBtn onClick={() => onAction('history', u)}>History</ActionBtn>
                    <ActionBtn onClick={() => onAction('reset-password', u)}>Reset PW</ActionBtn>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages && totalPages > 1 && (
        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: 'var(--crm-w60)', fontSize: 12, fontFamily: '"DM Sans", sans-serif',
        }}>
          <span>Page {page} of {totalPages} · {total} users total</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <ActionBtn onClick={() => onPage(page - 1)} disabled={page <= 1}>‹ Prev</ActionBtn>
            <ActionBtn onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next ›</ActionBtn>
          </div>
        </div>
      )}
    </>
  );
}

const Th = ({ children, align = 'left' }) => (
  <th style={{ padding: '12px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--crm-w45)', textAlign: align }}>
    {children}
  </th>
);
const Td = ({ children, align = 'left' }) => (
  <td style={{ padding: '12px 14px', color: 'var(--crm-w85)', verticalAlign: 'middle', textAlign: align }}>
    {children}
  </td>
);

function RoleBadge({ role }) {
  const isAdmin = role === 'admin';
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: isAdmin ? 'var(--crm-red-bg)' : 'var(--crm-w08)',
      color: isAdmin ? 'var(--crm-red)' : 'var(--crm-w70)',
      border: isAdmin ? '1px solid var(--crm-red-br)' : '1px solid var(--crm-w10)',
    }}>{role}</span>
  );
}

function ActionBtn({ children, onClick, disabled, accent }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: '5px 10px', fontSize: 11, fontWeight: 600,
        background: 'var(--crm-w06)',
        border: `1px solid ${accent ? `${accent}55` : 'var(--crm-w10)'}`,
        borderRadius: 8, color: accent || 'var(--crm-w85)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        fontFamily: '"DM Sans", sans-serif',
      }}
    >{children}</button>
  );
}

// Whether this account can still sign in, and until when.
//
// Before 2026-08-11 the CRM showed nothing about expiry at all, so 584 of 587
// accounts sat open-ended and nobody could see it. Expiring accounts without
// showing their state would just move the invisibility somewhere else.
function AccessCell({ expiresAt }) {
  if (!expiresAt) return <span style={{ color: 'var(--crm-w30)' }}>open</span>;
  const when = new Date(expiresAt);
  const expired = when <= new Date();
  const days = Math.ceil((when - new Date()) / 86400000);
  return (
    <span
      title={when.toLocaleString()}
      style={{ color: expired ? 'var(--crm-red)' : 'var(--crm-ink)', fontWeight: expired ? 600 : 400 }}
    >
      {expired ? 'EXPIRED' : `${days}d left`}
      <span style={{ display: 'block', fontSize: 11, color: 'var(--crm-w35)', fontWeight: 400 }}>
        {when.toLocaleDateString()}
      </span>
    </span>
  );
}
