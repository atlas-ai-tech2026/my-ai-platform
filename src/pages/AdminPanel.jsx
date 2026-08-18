// ─── AdminPanel ──────────────────────────────────────────────────────────────
// The CRM. Mounted at /x7k9-control-panel-mh2024 behind <AdminGuard/>.
//
// Wired in src/App.jsx. Uses the adminApi client + sonner toasts.

import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { adminApi, ApiError, readCsrfCookie } from '@/lib/adminApi';
import StatsCards from '@/components/admin/StatsCards';
import UserTable from '@/components/admin/UserTable';
import BulkExpiryPanel from '@/components/admin/BulkExpiryPanel';
import CreditsModal from '@/components/admin/CreditsModal';
import HistoryModal from '@/components/admin/HistoryModal';
import LogsTab from '@/components/admin/LogsTab';
import UsageTab from '@/components/admin/UsageTab';
import PromoCodesTab from '@/components/admin/PromoCodesTab';
import GiftCardsTab from '@/components/admin/GiftCardsTab';
import BulkTab from '@/components/admin/BulkTab';
import SecurityTab from '@/components/admin/SecurityTab';
import CostingTab from '@/components/admin/CostingTab';
import OffersTab from '@/components/admin/OffersTab';
import NotificationsTab from '@/components/admin/NotificationsTab';
import AlertsTab from '@/components/admin/AlertsTab';
import CustomerPanel from '@/components/admin/CustomerPanel';
import SopTab from '@/components/admin/SopTab';
import TasksTab from '@/components/admin/TasksTab';
import LiveTab from '@/components/admin/LiveTab';
import { ThemedToaster } from '@/components/admin/crmTheme';

const PAGE_SIZE = 50;

// kie.ai-style sections: Users (the original CRM), API Usage (aggregates +
// kie balance), Logs (per-transaction ledger with voxel + KIE credits).
// Every tab carries a one-line `desc`, shown under the tab bar the moment it
// is opened. Twelve tabs had accumulated with nothing saying what any of them
// was for — obvious to whoever built them, opaque to anyone else, and to the
// owner after a month away. The descriptions say what the screen is FOR, and
// where two screens sound alike (Costing vs Offers, Logs vs API Usage) they
// say what the difference is, because that is the actually confusing part.
const TABS = [
  // FIRST on purpose. Every other tab answers a question you thought to ask;
  // this one is the only screen that speaks first. It exists because a kie
  // balance check ran hourly into console.error while 415 generations failed
  // mid-workshop on 8 August — the system knew and had nowhere to say it.
  // SECOND, right after Alerts, and the pairing is deliberate. Alerts shows
  // only what is WRONG. This shows the whole picture INCLUDING what is fine —
  // which is most of what you need before standing in front of a room. Both
  // read the same checks, so they can never disagree.
  { id: 'sop', label: 'SOP',
    desc: 'Your daily operations picture: what every automated check found, and what to do about each one. Backups, restore verification, supplier runway, stuck charges, failure rate, and the structural checks that find a screen promising something no table keeps. A line that could not be determined says "not checked" — never green.' },
  // THIRD. The owner had to ask "what is pending?" every time, and the answer
  // came from a file only I could read. This board is now the single source of
  // truth for both of us.
  { id: 'tasks', label: 'Tasks',
    desc: 'Every task and project, split into yours and mine, in priority order — with the history back to the start. Open one to see why it matters and what it involves. Mark your own items done; reopen anything closed too early. This is the list, not a copy of it.' },
  { id: 'alerts', label: 'Alerts',
    desc: 'What needs your attention right now — supplier balance running low, charges taken with nothing delivered, failure spikes. This is the only screen that speaks first; every other tab waits to be asked. Anything serious also emails you once.' },
  // Tier 2.1 — for use DURING a session, not after it. Second only to
  // Alerts because it is the other screen you open without being asked to.
  { id: 'live', label: 'Live',
    desc: 'For while a workshop is actually running. Who is generating right now, what is failing in the last ten minutes, and what it is costing per minute. Refreshes itself every 10 seconds — do not reload it.' },
  { id: 'users', label: 'Users',
    desc: 'Every customer. Search, grant or remove credits, ban, reset a password. "Details" opens one person’s full story — every generation, whether it worked, and what they were charged.' },
  { id: 'usage', label: 'API Usage',
    desc: 'What you are spending with kie.ai: totals, your remaining balance, and which models consumed it. Money OUT to your supplier — as opposed to Logs, which is credits moving between you and customers.' },
  { id: 'logs',  label: 'Logs',
    desc: 'Every credit transaction, newest first — spends, refunds, grants, promo redemptions. The raw ledger everything else on this panel is calculated from.' },
  { id: 'promos', label: 'Promo Codes',
    desc: 'The access codes you hand out at workshops. Create them, see who redeemed each one, set how long the code can be used and how long access lasts afterwards.' },
  { id: 'gifts',  label: 'Gift Cards',
    desc: 'Prepaid credit codes, redeemed once each. Unlike promo codes these carry a credit value rather than granting access to a workshop cohort.' },
  { id: 'bulk',   label: 'Bulk',
    desc: 'Create many accounts at once before a workshop, and close their access when it ends. The expiry switch here excludes admins and can be reversed in one click.' },
  // N1: 2FA enrolment had no screen anywhere — the server side shipped with H5.
  { id: 'security', label: 'Security',
    desc: 'Your own admin account: two-factor authentication, recovery codes, and recent sign-ins. Nothing here affects customers.' },
  // Costing calculator — works out what prices SHOULD be. It does not charge
  // anybody; pricing.js remains the charging authority (finding C1).
  { id: 'costing', label: 'Costing',
    desc: 'What each model costs you and what it should sell for at your margin target — plus workshop profit and which models are reliable enough to demonstrate live. A CALCULATOR: nothing here changes what customers are charged until you deliberately carry a number across.' },
  // Offers — promotions priced against the Costing engine's margin target.
  { id: 'offers', label: 'Offers',
    desc: 'Discounts and bonus-credit promotions, each priced against the margin target from Costing so you can see what it costs before approving it.' },
  // Notifications — manual messages + automatic rules, in-app bell only.
  { id: 'notifications', label: 'Notifications',
    desc: 'Messages to customers — one-off announcements and automatic rules such as "credits running low". In-app only for now; email campaigns are deliberately switched off.' },
];

export default function AdminPanel() {
  const [tab, setTab] = useState('users');
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState(null);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);

  // Credits / ban modal
  const [pendingAction, setPendingAction] = useState(null); // { action, user }
  const [historyFor, setHistoryFor] = useState(null);       // user
  // Tier 2.2 — the whole person on one screen, with each charge paired to
  // its outcome. The history modal shows the raw ledger; this answers
  // "my video didn't work" without you reading it.
  const [customerFor, setCustomerFor] = useState(null);
  const [historyRows, setHistoryRows] = useState(null);
  // Same defect as CustomerPanel had: without this, a failed fetch left
  // historyRows null and the modal said "Loading…" forever.
  const [historyErr, setHistoryErr] = useState(null);

  // Refund audit report (null = not run, 'loading', or the report object)
  const [audit, setAudit] = useState(null);

  // Full DB backup download. Plain fetch (not adminApi) because the response
  // is a gzip stream, not JSON — saved via a temporary <a download>.
  const [backingUp, setBackingUp] = useState(false);
  const downloadBackup = useCallback(async () => {
    setBackingUp(true);
    try {
      // N3: cookie session, not a bearer token. Plain fetch (not adminApi)
      // only because the response is a gzip stream rather than JSON.
      const csrf = readCsrfCookie();
      const res = await fetch('/api/admin/backup', {
        credentials: 'include',
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Backup failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1]
        || `voxel-backup-${new Date().toISOString().slice(0, 10)}.ndjson.gz`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Backup downloaded: ${name} — keep it somewhere safe`);
    } catch (e) {
      toast.error(e.message || 'Backup failed');
    } finally {
      setBackingUp(false);
    }
  }, []);

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
    if (action === 'details') { setCustomerFor(user); return; }
    if (action === 'history') {
      setHistoryFor(user);
      setHistoryRows(null);
      setHistoryErr(null);
      try {
        const r = await adminApi.history(user.id);
        setHistoryRows(r.history);
      } catch (e) { handleError(e, 'History fetch failed'); setHistoryErr(e); }
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
      <ThemedToaster />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px 64px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ color: 'var(--crm-ink)', fontSize: 22, fontWeight: 700, marginBottom: 4, fontFamily: '"DM Sans", sans-serif' }}>
              Control Panel
            </h1>
            <div style={{ color: 'var(--crm-w40)', fontSize: 13, marginBottom: 24, fontFamily: '"DM Sans", sans-serif' }}>
              Signed in as {stats?.admin_email || '—'}.
            </div>
          </div>
        </div>

        {/* Tab bar — kie.ai dashboard style */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--crm-w08)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '10px 18px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t.id ? 'var(--crm-ink)' : 'var(--crm-w40)',
                borderBottom: tab === t.id ? '2px solid #e0442c' : '2px solid transparent',
                marginBottom: -1,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* What this tab is FOR, in one line, right where you land. Twelve
            tabs had accumulated with nothing explaining any of them — obvious
            to whoever built them, opaque to anyone else and to the owner after
            a month away. */}
        <p style={{
          margin: '12px 0 18px', maxWidth: '92ch', fontSize: 13, lineHeight: 1.65,
          color: 'var(--crm-w55)', fontFamily: 'inherit',
        }}>
          {TABS.find(t => t.id === tab)?.desc}
        </p>

        {tab === 'usage' && <UsageTab onError={handleError} />}
        {tab === 'logs' && <LogsTab onError={handleError} />}
        {tab === 'promos' && <PromoCodesTab onError={handleError} />}
        {tab === 'gifts' && <GiftCardsTab onError={handleError} />}
        {tab === 'bulk' && <BulkTab onError={handleError} />}
        {tab === 'security' && <SecurityTab onError={handleError} />}
        {customerFor && (
          <CustomerPanel user={customerFor} onClose={() => setCustomerFor(null)} onError={handleError} />
        )}

        {tab === 'sop' && <SopTab onError={handleError} />}
        {tab === 'tasks' && <TasksTab onError={handleError} />}
        {tab === 'alerts' && <AlertsTab onError={handleError} />}

        {tab === 'live' && <LiveTab onError={handleError} />}
        {tab === 'costing' && <CostingTab onError={handleError} />}
        {tab === 'offers' && <OffersTab onError={handleError} />}
        {tab === 'notifications' && <NotificationsTab onError={handleError} />}

        {tab === 'users' && (<>
        <StatsCards stats={stats} />

        {/* Close access for a finished cohort. Deletes nothing; admins are
            excluded server-side so this cannot lock the owner out. */}
        <BulkExpiryPanel onDone={reload} onError={handleError} />

        {/* Refund audit — cross-references failed videos vs refunds. */}
        <div style={{ marginBottom: 16 }}>
          <button onClick={runAudit} disabled={audit === 'loading'} style={auditBtnStyle}>
            {audit === 'loading' ? 'Auditing…' : '🔍 Refund Audit'}
          </button>
          <button onClick={downloadBackup} disabled={backingUp} style={{ ...auditBtnStyle, marginLeft: 8 }}
            title="Download a full database backup (users, credits, history). The prod DB has no automatic backups — do this regularly.">
            {backingUp ? 'Exporting…' : '💾 Download Backup'}
          </button>
          {audit && audit !== 'loading' && (
            <div style={auditBoxStyle}>
              <div style={{ marginBottom: 8, color: audit.users_with_possible_gaps ? 'var(--crm-amber)' : 'var(--crm-green)', fontWeight: 600 }}>
                {audit.users_with_possible_gaps === 0
                  ? `✅ Clean — ${audit.failed_videos_total} failed videos across ${audit.users_with_failures} users, every one covered by a refund.`
                  : `⚠ ${audit.users_with_possible_gaps} user(s) may have unrefunded failures — review below.`}
              </div>
              {audit.report.filter(u => u.possible_unrefunded > 0).map(u => (
                <div key={u.user_id} style={{ padding: '8px 0', borderTop: '1px solid var(--crm-w08)', fontSize: 13 }}>
                  <b>{u.email}</b> — {u.failed_videos} failed videos, {u.refund_count} refunds
                  (+{u.refund_total}) → <span style={{ color: 'var(--crm-amber)' }}>{u.possible_unrefunded} possibly unrefunded</span>
                  <div style={{ color: 'var(--crm-w45)', marginTop: 2 }}>
                    {u.failures.slice(0, 5).map((f, i) => (
                      <span key={i}>{f.model} · {new Date(f.at).toLocaleString()}{i < Math.min(u.failures.length, 5) - 1 ? '  |  ' : ''}</span>
                    ))}
                  </div>
                  <div style={{ color: 'var(--crm-w35)', marginTop: 2 }}>
                    Check their History for the exact spends, then use + Credits to make good.
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 8, color: 'var(--crm-w35)', fontSize: 12 }}>
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
        </>)}
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
          error={historyErr}
          onClose={() => { setHistoryFor(null); setHistoryRows(null); setHistoryErr(null); }}
        />
      )}
    </div>
  );
}

function handleError(e, fallback) {
  if (e instanceof ApiError) {
    if (e.status === 401) {
      // N3: nothing to clear locally any more — the session lives in an
      // httpOnly cookie. The reload lands on AdminGuard, which asks the
      // server who we are, gets 401, and shows the sign-in form. No loop.
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
  minHeight: '100vh', background: 'var(--crm-page)',
  fontFamily: '"DM Sans", sans-serif', color: 'var(--crm-ink)',
};
const auditBtnStyle = {
  height: 36, padding: '0 16px', borderRadius: 10, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
};
const auditBoxStyle = {
  marginTop: 10, padding: '12px 16px', borderRadius: 12,
  background: 'var(--crm-w04)', border: '1px solid var(--crm-w08)',
  fontFamily: 'inherit', fontSize: 13,
};
const searchInputStyle = {
  width: '100%', height: 42, padding: '0 16px', marginBottom: 16,
  background: 'var(--crm-w04)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, color: 'var(--crm-ink)', fontSize: 14, outline: 'none',
  fontFamily: 'inherit',
};
