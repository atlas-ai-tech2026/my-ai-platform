// ─── AdminPanel ──────────────────────────────────────────────────────────────
// The CRM. Mounted at /x7k9-control-panel-mh2024 behind <AdminGuard/>.
//
// Wired in src/App.jsx. Uses the adminApi client + sonner toasts.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Toaster, toast } from 'sonner';
import { adminApi, ApiError, VOXEL_TOKEN_KEY, getStoredUser } from '@/lib/adminApi';
import StatsCards from '@/components/admin/StatsCards';
import UserTable from '@/components/admin/UserTable';
import CreditsModal from '@/components/admin/CreditsModal';
import HistoryModal from '@/components/admin/HistoryModal';

const PAGE_SIZE = 50;

export default function AdminPanel() {
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState(null);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);

  // Credits / ban modal
  const [pendingAction, setPendingAction] = useState(null); // { action, user }
  const [historyFor, setHistoryFor] = useState(null);       // user
  const [historyRows, setHistoryRows] = useState(null);

  // Refund audit report (null = not run, 'loading', or the report object)
  const [audit, setAudit] = useState(null);

  const runAudit = useCallback(async () => {
    setAudit('loading');
    try {
      const r = await adminApi.auditRefunds();
      setAudit(r);
    } catch (e) {
      setAudit(null);
      handleError(e, 'Audit failed');
    }
  }, []);

  // Initial + post-action data load
  const reload = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        adminApi.stats(),
        adminApi.listUsers(page, PAGE_SIZE),
      ]);
      setStats(s);
      setUsers(u.users);
      setTotal(u.total);
    } catch (e) {
      handleError(e, 'Failed to load admin data');
    }
  }, [page]);

  useEffect(() => { reload(); }, [reload]);

  // Debounced server-side search
  useEffect(() => {
    const q = searchTerm.trim();
    if (!q) { setSearchResults(null); return; }
    const id = setTimeout(async () => {
      try {
        const r = await adminApi.searchUsers(q);
        setSearchResults(r.users);
      } catch (e) { handleError(e, 'Search failed'); }
    }, 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const visibleUsers = searchResults ?? users;

  // Action dispatch
  const onAction = useCallback(async (action, user) => {
    if (action === 'history') {
      setHistoryFor(user);
      setHistoryRows(null);
      try {
        const r = await adminApi.history(user.id);
        setHistoryRows(r.history);
      } catch (e) { handleError(e, 'History fetch failed'); }
      return;
    }
    if (action === 'reset-password') {
      // Passwords are hashed and unrecoverable — admin sets a NEW one and
      // hands it to the user. prompt() keeps this dead simple for an
      // internal tool.
      const pw = window.prompt(`New password for ${user.email} (min 8 characters):`);
      if (pw === null) return;
      if (pw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
      adminApi.resetPassword(user.id, pw)
        .then(() => toast.success(`Password reset for ${user.email} — share it with them securely`))
        .catch(e => handleError(e, 'Password reset failed'));
      return;
    }
    // grant / revoke / ban / unban → open modal
    setPendingAction({ action, user });
  }, []);

  const submitPending = useCallback(async ({ amount, reason }) => {
    if (!pendingAction) return;
    const { action, user } = pendingAction;
    try {
      if (action === 'grant' || action === 'revoke') {
        await adminApi.updateCredits(user.id, { amount, action, reason });
        toast.success(`${action === 'grant' ? 'Granted' : 'Revoked'} ${amount} credits to ${user.email}`);
      } else if (action === 'ban' || action === 'unban') {
        await adminApi.setBan(user.id, action === 'ban', reason);
        toast.success(`${action === 'ban' ? 'Banned' : 'Unbanned'} ${user.email}`);
      }
      setPendingAction(null);
      reload();
    } catch (e) { handleError(e, 'Action failed'); }
  }, [pendingAction, reload]);

  return (
    <div style={containerStyle}>
      <Toaster position="bottom-right" theme="dark" richColors />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px 64px 24px' }}>
        <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, marginBottom: 4, fontFamily: '"DM Sans", sans-serif' }}>
          Control Panel
        </h1>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 24, fontFamily: '"DM Sans", sans-serif' }}>
          Signed in as {stats?.admin_email || getStoredUser()?.email || '—'}.
        </div>

        <StatsCards stats={stats} />

        {/* Refund audit — cross-references failed videos vs refunds. */}
        <div style={{ marginBottom: 16 }}>
          <button onClick={runAudit} disabled={audit === 'loading'} style={auditBtnStyle}>
            {audit === 'loading' ? 'Auditing…' : '🔍 Refund Audit'}
          </button>
          {audit && audit !== 'loading' && (
            <div style={auditBoxStyle}>
              <div style={{ marginBottom: 8, color: audit.users_with_possible_gaps ? '#fbbf24' : '#4ade80', fontWeight: 600 }}>
                {audit.users_with_possible_gaps === 0
                  ? `✅ Clean — ${audit.failed_videos_total} failed videos across ${audit.users_with_failures} users, every one covered by a refund.`
                  : `⚠ ${audit.users_with_possible_gaps} user(s) may have unrefunded failures — review below.`}
              </div>
              {audit.report.filter(u => u.possible_unrefunded > 0).map(u => (
                <div key={u.user_id} style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 13 }}>
                  <b>{u.email}</b> — {u.failed_videos} failed videos, {u.refund_count} refunds
                  (+{u.refund_total}) → <span style={{ color: '#fbbf24' }}>{u.possible_unrefunded} possibly unrefunded</span>
                  <div style={{ color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                    {u.failures.slice(0, 5).map((f, i) => (
                      <span key={i}>{f.model} · {new Date(f.at).toLocaleString()}{i < Math.min(u.failures.length, 5) - 1 ? '  |  ' : ''}</span>
                    ))}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    Check their History for the exact spends, then use + Credits to make good.
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                Note: refund counts include image refunds, so the gap number is a conservative signal, not an exact figure.
                Failed images have no history rows (their refunds are immediate and code-enforced) and can't be audited retroactively.
              </div>
            </div>
          )}
        </div>

        <input
          type="text" placeholder="Search by email…"
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          style={searchInputStyle}
        />

        <UserTable
          users={visibleUsers}
          page={searchResults ? 1 : page}
          total={searchResults ? null : total}
          limit={PAGE_SIZE}
          onPage={(p) => { if (p < 1) return; setPage(p); }}
          onAction={onAction}
        />
      </div>

      {pendingAction && (
        <CreditsModal
          user={pendingAction.user}
          action={pendingAction.action}
          onClose={() => setPendingAction(null)}
          onSubmit={submitPending}
        />
      )}
      {historyFor && (
        <HistoryModal
          user={historyFor}
          history={historyRows}
          onClose={() => { setHistoryFor(null); setHistoryRows(null); }}
        />
      )}
    </div>
  );
}

function handleError(e, fallback) {
  if (e instanceof ApiError) {
    if (e.status === 401) {
      // Clear the stale/expired token BEFORE reloading. Without this, the
      // reloaded page still has the bad token in localStorage, AdminGuard
      // still thinks we're logged in, and the panel re-fires the same
      // calls → another 401 → another reload → loop until rate-limited.
      localStorage.removeItem(VOXEL_TOKEN_KEY);
      toast.error('Session expired. Please sign in again.');
      setTimeout(() => window.location.reload(), 800);
      return;
    }
    if (e.status === 403) return toast.error(e.body?.error || 'Forbidden.');
    if (e.status === 429) return toast.error('Rate limited. Slow down.');
    return toast.error(e.body?.error || fallback);
  }
  toast.error(fallback);
}

const containerStyle = {
  minHeight: '100vh', background: '#0a0a0c',
  fontFamily: '"DM Sans", sans-serif', color: '#fff',
};
const auditBtnStyle = {
  height: 36, padding: '0 16px', borderRadius: 10, cursor: 'pointer',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
};
const auditBoxStyle = {
  marginTop: 10, padding: '12px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  fontFamily: 'inherit', fontSize: 13,
};
const searchInputStyle = {
  width: '100%', height: 42, padding: '0 16px', marginBottom: 16,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12, color: '#fff', fontSize: 14, outline: 'none',
  fontFamily: 'inherit',
};
