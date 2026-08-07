// ─── UserTable ──────────────────────────────────────────────────────────────
// Paginated user list with per-row actions. Receives `users` + paginate/refresh
// callbacks from the parent page; doesn't fetch on its own.
import React from 'react';

export default function UserTable({ users, page, total, limit, onPage, onAction }) {
  if (!users) return <div style={{ color: 'rgba(255,255,255,0.5)' }}>Loading…</div>;
  if (users.length === 0) return <div style={{ color: 'rgba(255,255,255,0.5)' }}>No users found.</div>;

  const totalPages = total ? Math.max(1, Math.ceil(total / limit)) : null;

  return (
    <>
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden',
        fontFamily: '"DM Sans", sans-serif',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: 'left' }}>
              <Th>Email</Th>
              <Th>Credits</Th>
              <Th>Role</Th>
              <Th>Package</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <Td>
                  <div style={{ color: '#fff' }}>{u.email}</div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>id: {u.id}</div>
                </Td>
                <Td><strong style={{ color: '#fff' }}>{Number(u.credits).toFixed(2)}</strong></Td>
                <Td><RoleBadge role={u.role} /></Td>
                <Td>{u.package || <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>}</Td>
                <Td>
                  {u.banned
                    ? <span style={{ color: '#ff6666', fontWeight: 600 }}>BANNED</span>
                    : <span style={{ color: '#88ee88' }}>active</span>}
                </Td>
                <Td>{new Date(u.created_at).toLocaleDateString()}</Td>
                <Td align="right">
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <ActionBtn onClick={() => onAction('grant',  u)}>+ Credits</ActionBtn>
                    <ActionBtn onClick={() => onAction('revoke', u)}>− Credits</ActionBtn>
                    {u.role !== 'admin' && (
                      <ActionBtn
                        onClick={() => onAction(u.banned ? 'unban' : 'ban', u)}
                        accent={u.banned ? '#88ee88' : '#ff6666'}
                      >{u.banned ? 'Unban' : 'Ban'}</ActionBtn>
                    )}
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
          color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: '"DM Sans", sans-serif',
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
  <th style={{ padding: '12px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', textAlign: align }}>
    {children}
  </th>
);
const Td = ({ children, align = 'left' }) => (
  <td style={{ padding: '12px 14px', color: 'rgba(255,255,255,0.85)', verticalAlign: 'middle', textAlign: align }}>
    {children}
  </td>
);

function RoleBadge({ role }) {
  const isAdmin = role === 'admin';
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: isAdmin ? 'rgba(224,30,30,0.15)' : 'rgba(255,255,255,0.07)',
      color: isAdmin ? '#ff8888' : 'rgba(255,255,255,0.7)',
      border: isAdmin ? '1px solid rgba(224,30,30,0.4)' : '1px solid rgba(255,255,255,0.1)',
    }}>{role}</span>
  );
}

function ActionBtn({ children, onClick, disabled, accent }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: '5px 10px', fontSize: 11, fontWeight: 600,
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid ${accent ? `${accent}55` : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 8, color: accent || 'rgba(255,255,255,0.85)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        fontFamily: '"DM Sans", sans-serif',
      }}
    >{children}</button>
  );
}
