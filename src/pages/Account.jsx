// ─── Account ─────────────────────────────────────────────────────────────────
// User-facing "Manage Account" — structured after higgsfield.ai's account
// area: left sidebar (Personal profile / Gifts / Subscription / Usage /
// Promocode), main panel per section. Personal profile shows the avatar +
// name + email, a Credits card ("X credits left · N% of maximum credit
// pool" + Top-up), and a Usage-history mini chart, matching higgsfield's
// layout. Gifts + Promocode redeem through POST /api/redeem-code (gift
// cards and promo codes generated in the admin CRM).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  User, Gift, CreditCard, BarChart3, Ticket, Pencil, Check, X, LogOut,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { VOXEL_TOKEN_KEY } from '@/lib/adminApi';
import { CREDIT_PLANS, CREDIT_VALUE_USD } from '@/lib/creditPricing';
import Avatar from '@/components/common/Avatar';

const SECTIONS = [
  { id: 'profile', label: 'Personal profile', icon: User },
  { id: 'gifts', label: 'Gifts', icon: Gift },
  { id: 'subscription', label: 'Subscription', icon: CreditCard },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'promocode', label: 'Promocode', icon: Ticket },
];

async function authedFetch(path, opts = {}) {
  const token = localStorage.getItem(VOXEL_TOKEN_KEY);
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export default function Account() {
  const { user, isAuthenticated, isLoadingAuth, openAuthModal, refresh, logout } = useAuth();
  const [section, setSection] = useState('profile');
  const [usage, setUsage] = useState(null); // { daily, recent, models, range, lifetime }
  const [usageDays, setUsageDays] = useState(30);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await authedFetch(`/api/me/usage?days=${usageDays}`));
    } catch (e) {
      console.error('[account] usage load failed:', e.message);
    }
  }, [usageDays]);

  useEffect(() => { if (isAuthenticated) loadUsage(); }, [isAuthenticated, loadUsage]);

  if (isLoadingAuth) {
    return <div className="min-h-[60vh]" />;
  }
  if (!isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="font-heading text-3xl tracking-wide text-white">Your account</h1>
        <p className="text-foreground-muted max-w-md">
          Sign in to see your profile, subscription, credit usage, and to redeem
          promo codes and gift cards.
        </p>
        <button
          onClick={() => openAuthModal('login')}
          className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-white font-semibold rounded-full transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="text-sm text-foreground-muted mb-6">
        {(user?.display_name || user?.email?.split('@')[0] || 'my')}&rsquo;s workspace
      </div>
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar — higgsfield order */}
        <aside className="md:w-56 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible" aria-label="Account sections">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors text-left ${
                  section === s.id
                    ? 'bg-white/10 text-white'
                    : 'text-foreground-muted hover:text-white hover:bg-white/5'
                }`}>
                <s.icon size={17} />
                {s.label}
              </button>
            ))}
            <button onClick={logout}
              className="hidden md:flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-foreground-muted hover:text-white hover:bg-white/5 mt-6 text-left">
              <LogOut size={17} />
              Sign out
            </button>
          </nav>
        </aside>

        {/* Main panel */}
        <div className="flex-1 min-w-0">
          {section === 'profile' && <ProfileSection user={user} usage={usage} refresh={refresh} onSeeAll={() => setSection('usage')} />}
          {section === 'gifts' && <RedeemSection kindLabel="gift card" user={user} usage={usage} refresh={refresh} loadUsage={loadUsage} action="gift"
            blurb="Have a Voxel gift card? Each card is a one-time voucher — redeem it here and the credits land instantly." />}
          {section === 'subscription' && <SubscriptionSection user={user} usage={usage} />}
          {section === 'usage' && (
            <UsageSection user={user} usage={usage} days={usageDays}
              onDays={setUsageDays} onRefresh={loadUsage} />
          )}
          {section === 'promocode' && <RedeemSection kindLabel="promo code" user={user} usage={usage} refresh={refresh} loadUsage={loadUsage} action="promo"
            blurb="Got a promo code from a campaign or giveaway? Redeem it here — each code works once per account." />}
        </div>
      </div>
    </div>
  );
}

// ─── Personal profile ────────────────────────────────────────────────────────
function ProfileSection({ user, usage, refresh, onSeeAll }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.display_name || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await authedFetch('/api/me', { method: 'PATCH', body: JSON.stringify({ display_name: name }) });
      await refresh();
      setEditing(false);
      toast.success('Profile updated');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const credits = Number(user?.credits || 0);
  const pool = Number(user?.credit_limit || 0);
  const pct = pool > 0 ? Math.round((credits / pool) * 100) : null;
  const displayName = user?.display_name || user?.email?.split('@')[0] || 'Creator';

  return (
    <div className="space-y-6">
      {/* Header — avatar + name + email (higgsfield top block) */}
      <div className="flex items-center gap-5">
        <Avatar name={displayName} size={72} />
        <div className="min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus
                placeholder="Display name"
                className="bg-white/5 border border-border rounded-lg px-3 py-1.5 text-xl font-semibold text-white outline-none focus:border-primary" />
              <button onClick={save} disabled={saving} className="p-2 rounded-lg bg-primary text-white" aria-label="Save name"><Check size={16} /></button>
              <button onClick={() => { setEditing(false); setName(user?.display_name || ''); }} className="p-2 rounded-lg bg-white/10 text-white" aria-label="Cancel"><X size={16} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-white truncate">{displayName}</h1>
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-white transition-colors">
                <Pencil size={13} /> Edit
              </button>
            </div>
          )}
          <div className="text-foreground-muted mt-1 truncate">{user?.email}</div>
        </div>
      </div>

      {/* Credits + Usage history cards (higgsfield's two-card row) */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
          <div className="flex items-center gap-2 text-foreground-muted text-sm mb-6">
            <CreditCard size={16} /> Credits
          </div>
          <div className="text-3xl font-bold text-white">{credits.toLocaleString()} credits left</div>
          <div className="text-sm text-foreground-muted mt-2">
            {pct != null ? `${pct}% of maximum credit pool` : 'Awaiting your first credits'}
          </div>
          <Link to="/pricing"
            className="inline-block mt-5 px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors">
            Top-up
          </Link>
        </div>
        <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
          <div className="flex items-center justify-between text-sm mb-4">
            <span className="flex items-center gap-2 text-foreground-muted"><BarChart3 size={16} /> Usage history</span>
            <button onClick={onSeeAll} className="text-white underline underline-offset-2">See all</button>
          </div>
          <MiniUsageChart daily={usage?.daily} height={120} />
        </div>
      </div>
    </div>
  );
}

// ─── Subscription ────────────────────────────────────────────────────────────
// Full higgsfield-style Subscription page: plan card with feature checklist,
// credits meter, auto-refill (honest "coming soon" — needs online billing),
// model access, billing (honest empty states), and the "Your Rewind" stats.
const MODEL_SHOWCASE = [
  'Kling 3.0', 'Veo 3', 'Sora 2', 'Seedance 2.0',
  'Nano Banana Pro', 'GPT Image 2', 'Midjourney', 'Wan 2.6',
];

function SubscriptionSection({ user, usage }) {
  const planName = user?.package || 'Free';
  const plan = CREDIT_PLANS.find(p => p.name.toLowerCase() === String(planName).toLowerCase());
  const credits = Number(user?.credits || 0);
  const pool = Number(user?.credit_limit || 0);
  const pct = pool > 0 ? Math.min(100, Math.round((credits / pool) * 100)) : 0;
  const life = usage?.lifetime;
  const topModel = life?.top_model?.model?.replace(/^(image|video|audio|node video|node):\s*/, '');

  const features = [
    plan ? `${plan.creditsPerMonth.toLocaleString()} credits per month` : 'Credits granted by the team',
    'Access to all models',
    'No watermark on exports',
    'Commercial usage rights',
    'Same cost per credit on every plan',
    'Full generation history',
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Subscription</h1>
        <p className="text-foreground-muted text-sm mt-1">Manage your plan, credits &amp; model access</p>
      </div>

      {/* Plan card — name, price, Upgrade, feature checklist */}
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-2xl font-bold text-white">{planName} Plan</div>
            <div className="text-foreground-muted mt-1 text-sm">
              {plan
                ? `$${plan.pricePerMonth}/month · ${plan.creditsPerMonth.toLocaleString()} credits per month`
                : 'Pay-as-you-go — pick a plan to get monthly credits at the best rate.'}
            </div>
          </div>
          <Link to="/pricing"
            className="px-5 py-2 rounded-full bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-colors">
            Upgrade plan
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 mt-5">
          {features.map(f => (
            <div key={f} className="flex items-center gap-2 text-sm text-foreground-secondary">
              <Check size={15} className="text-green-400 shrink-0" /> {f}
            </div>
          ))}
        </div>
      </div>

      {/* Credits meter — higgsfield's "Monthly credits left" card */}
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm text-foreground-muted mb-1">Credits left</div>
            <div className="text-2xl font-bold text-white">
              {credits.toLocaleString()} <span className="text-foreground-muted font-normal">/ {pool.toLocaleString()}</span>
            </div>
          </div>
          <Link to="/pricing"
            className="px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors">
            + Buy credits
          </Link>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden mt-4">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Auto-refill — honest placeholder until online billing exists */}
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-white font-semibold">Auto-refill</div>
          <div className="text-sm text-foreground-muted mt-1">
            Automatic top-ups when you run low — arrives with online billing.
          </div>
        </div>
        <span className="px-4 py-1.5 rounded-full bg-white/10 text-foreground-muted text-sm font-semibold">
          Coming soon
        </span>
      </div>

      {/* Model access — every plan includes every model */}
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
        <div className="text-white font-semibold mb-1">Model access</div>
        <div className="text-sm text-foreground-muted mb-4">
          Every Voxel plan unlocks every model — nothing is gated behind tiers.
        </div>
        <div className="divide-y divide-border/60">
          {MODEL_SHOWCASE.map(m => (
            <div key={m} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-white">{m}</span>
              <span className="px-3 py-0.5 rounded-full bg-green-400/10 text-green-400 text-xs font-semibold">Active</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-foreground-muted mt-3">…and every other model in the studio.</div>
      </div>

      {/* Billing — honest empty states until online payments launch */}
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6 space-y-4">
        <div>
          <div className="text-white font-semibold mb-1">Invoices</div>
          <div className="text-sm text-foreground-muted">
            No invoices yet — your billing history appears here once online payments launch.
          </div>
        </div>
        <div className="h-px bg-border/60" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-white font-semibold mb-1">Payment methods</div>
            <div className="text-sm text-foreground-muted">
              No saved payment methods — plans are currently arranged with the Voxel team.
            </div>
          </div>
          <Link to="/contact"
            className="px-5 py-2 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm font-semibold transition-colors">
            Billing help
          </Link>
        </div>
      </div>

      {/* Your Rewind — lifetime stats like higgsfield's cards */}
      {life && life.generations > 0 && (
        <div>
          <div className="text-white font-semibold mb-3">Your Rewind</div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-border bg-gradient-to-br from-cyan-500/10 to-transparent p-5">
              <div className="text-2xl font-bold text-cyan-300">{life.generations.toLocaleString()} generations</div>
              <div className="text-sm text-foreground-muted mt-1">so far — and you&rsquo;re just getting started</div>
            </div>
            <div className="rounded-2xl border border-border bg-gradient-to-br from-purple-500/10 to-transparent p-5">
              <div className="text-2xl font-bold text-purple-300">{life.videos.toLocaleString()} videos</div>
              <div className="text-sm text-foreground-muted mt-1">created — your story in motion</div>
            </div>
            <div className="rounded-2xl border border-border bg-gradient-to-br from-teal-500/10 to-transparent p-5">
              <div className="text-2xl font-bold text-teal-300 truncate">{topModel || '—'}</div>
              <div className="text-sm text-foreground-muted mt-1">
                your top model · {life.top_model?.generations?.toLocaleString() || 0} generations
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Usage ───────────────────────────────────────────────────────────────────
// higgsfield-style "Usage history": header + Refresh + range picker, Spend
// overview tiles (total cost $, credits spent, features used, generations),
// per-model share bar with legend, daily chart, and a filterable ledger
// table (Credits | Feature | Action | Date) with pagination.
const SHARE_COLORS = ['#e0442c', '#c084fc', '#4ade80', '#60a5fa', '#fbbf24', '#f472b6', '#2dd4bf', '#a3a3a3'];
const cleanModel = (reason) => String(reason || '').replace(/^(image|video|audio|node video|node):\s*/, '') || 'Other';

const ACTION_LABEL = {
  spend:  { label: 'Spent', cls: 'text-foreground-secondary' },
  refund: { label: 'Refunded', cls: 'text-green-400' },
  promo:  { label: 'Promo', cls: 'text-purple-300' },
  gift:   { label: 'Gift card', cls: 'text-pink-300' },
  grant:  { label: 'Granted', cls: 'text-blue-300' },
  revoke: { label: 'Revoked', cls: 'text-red-400' },
};

const PAGE = 25;

function UsageSection({ user, usage, days, onDays, onRefresh }) {
  const [feature, setFeature] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const models = usage?.models || [];
  const range = usage?.range;
  const totalSpent = Number(range?.credits_spent || 0);

  const features = useMemo(
    () => [...new Set((usage?.recent || []).map(r => cleanModel(r.reason)).filter(m => m !== 'Other'))],
    [usage]
  );
  const rows = useMemo(() => {
    let r = usage?.recent || [];
    if (feature) r = r.filter(x => cleanModel(x.reason) === feature);
    if (action) r = r.filter(x => x.action === action);
    return r;
  }, [usage, feature, action]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="space-y-5">
      {/* Header row — title + Refresh + range picker */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Usage history</h1>
          <p className="text-foreground-muted text-sm mt-1">View credits usage, history and statistics</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh}
            className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm font-semibold transition-colors">
            ⟳ Refresh
          </button>
          <select value={days} onChange={e => { onDays(Number(e.target.value)); setPage(1); }}
            className="px-4 py-2 rounded-full bg-white/10 text-white text-sm font-semibold outline-none border border-border"
            style={{ colorScheme: 'dark' }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Spend overview — higgsfield's four tiles */}
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
        <div className="text-sm text-foreground-muted mb-4">Spend overview</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <div className="text-2xl font-bold text-white">${(totalSpent * CREDIT_VALUE_USD).toFixed(2)}</div>
            <div className="text-sm text-foreground-muted">Total cost</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{totalSpent.toLocaleString()}</div>
            <div className="text-sm text-foreground-muted">Credits spent</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{models.length}</div>
            <div className="text-sm text-foreground-muted">Features used</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{Number(range?.generations || 0).toLocaleString()}</div>
            <div className="text-sm text-foreground-muted">Total generations</div>
          </div>
        </div>

        {/* Per-model share bar + legend */}
        {models.length > 0 && totalSpent > 0 && (
          <>
            <div className="flex h-2.5 rounded-full overflow-hidden mt-6 bg-white/10">
              {models.map((m, i) => (
                <div key={m.model} title={`${cleanModel(m.model)} ${(m.credits_spent / totalSpent * 100).toFixed(0)}%`}
                  style={{ width: `${(m.credits_spent / totalSpent) * 100}%`, background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
              {models.slice(0, 8).map((m, i) => (
                <span key={m.model} className="flex items-center gap-1.5 text-xs text-foreground-muted">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
                  {cleanModel(m.model)}
                  <b className="text-white">{Math.round((m.credits_spent / totalSpent) * 100)}%</b>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Daily chart */}
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
        <MiniUsageChart daily={usage?.daily} height={200} showAxis />
      </div>

      {/* Usage history table — Credits | Feature | Action | Date */}
      <div className="rounded-2xl border border-border bg-white/[0.03] overflow-hidden">
        <div className="flex items-center gap-2 px-5 pt-4 pb-1 flex-wrap">
          <span className="text-white font-semibold mr-2">Usage history</span>
          <span className="text-xs text-foreground-muted bg-white/10 rounded-full px-2 py-0.5">{rows.length}</span>
          <div className="flex-1" />
          <select value={feature} onChange={e => { setFeature(e.target.value); setPage(1); }}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-border text-sm text-white outline-none" style={{ colorScheme: 'dark' }}>
            <option value="">All features</option>
            {features.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={action} onChange={e => { setAction(e.target.value); setPage(1); }}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-border text-sm text-white outline-none" style={{ colorScheme: 'dark' }}>
            <option value="">All actions</option>
            <option value="spend">Spent</option>
            <option value="refund">Refunded</option>
            <option value="promo">Promo</option>
            <option value="gift">Gift card</option>
          </select>
        </div>
        {/* Two of these columns refuse to wrap — a credit amount and a full
            timestamp — so on a phone the table pushes wider than the screen.
            With no scroll container that width escapes to the PAGE, and the
            whole account screen slides sideways. Found by the layout sweep,
            not by anyone reporting it. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-foreground-muted">
              <th className="px-5 py-3 font-medium">Credits</th>
              <th className="px-5 py-3 font-medium">Feature</th>
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {!usage && <tr><td colSpan={4} className="px-5 py-8 text-center text-foreground-muted">Loading…</td></tr>}
            {usage && pageRows.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-foreground-muted">No activity matches these filters yet.</td></tr>
            )}
            {pageRows.map(r => {
              const amt = Number(r.amount);
              const a = ACTION_LABEL[r.action] || { label: r.action, cls: 'text-foreground-muted' };
              return (
                <tr key={r.id} className="border-t border-border/60">
                  <td className={`px-5 py-3 font-semibold whitespace-nowrap ${amt > 0 ? 'text-green-400' : 'text-white'}`}>
                    {amt > 0 ? `+${amt}` : Math.abs(amt)} credits
                  </td>
                  <td className="px-5 py-3 text-white">{cleanModel(r.reason)}</td>
                  <td className={`px-5 py-3 ${a.cls}`}>{a.label}</td>
                  <td className="px-5 py-3 text-foreground-muted whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 text-sm text-foreground-muted">
          <span>Show {PAGE}</span>
          <span>Page {page} of {pages}</span>
          <span className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1 rounded-lg bg-white/10 disabled:opacity-40 text-white">‹</button>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}
              className="px-3 py-1 rounded-lg bg-white/10 disabled:opacity-40 text-white">›</button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Gifts / Promocode (shared redeem UI) ────────────────────────────────────
function RedeemSection({ kindLabel, blurb, action, usage, refresh, loadUsage }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const redeemed = useMemo(
    () => (usage?.recent || []).filter(r => r.action === action),
    [usage, action]
  );

  const redeem = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await authedFetch('/api/redeem-code', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      toast.success(`+${r.credits} credits added — new balance ${r.balance.toLocaleString()}`);
      setCode('');
      await Promise.all([refresh(), loadUsage()]);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white capitalize">{kindLabel}s</h1>
      <p className="text-foreground-muted max-w-xl">{blurb}</p>
      <div className="flex gap-2 max-w-md">
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && redeem()}
          placeholder={`Enter ${kindLabel}…`}
          className="flex-1 bg-white/5 border border-border rounded-xl px-4 py-2.5 text-white font-mono tracking-wide outline-none focus:border-primary" />
        <button onClick={redeem} disabled={busy || !code.trim()}
          className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-semibold transition-colors">
          {busy ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      <div>
        <div className="text-sm text-foreground-muted mb-3">Redeemed {kindLabel}s</div>
        {redeemed.length === 0 ? (
          <div className="text-sm text-foreground-muted/60">Nothing redeemed yet.</div>
        ) : (
          <ul className="space-y-2 max-w-xl">
            {redeemed.map(r => (
              <li key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-white/[0.03] px-4 py-3 text-sm">
                <span className="text-white font-mono">{(r.reason || '').replace(/^(promo|gift card):\s*/, '')}</span>
                <span className="text-foreground-muted">{new Date(r.created_at).toLocaleDateString()}</span>
                <span className="text-green-400 font-semibold">+{Number(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────
function MiniUsageChart({ daily, height = 120, showAxis = false }) {
  if (!daily) return <div style={{ height }} className="flex items-center justify-center text-foreground-muted text-sm">Loading…</div>;
  if (!daily.length) return <div style={{ height }} className="flex items-center justify-center text-foreground-muted text-sm">No usage yet</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={daily} margin={{ top: 4, right: 4, left: showAxis ? -18 : 4, bottom: 0 }}>
        {showAxis && <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />}
        <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
          tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false}
          interval="preserveStartEnd" />
        {showAxis && <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />}
        <Tooltip
          contentStyle={{ background: '#141417', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }}
          labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
          formatter={(v, k) => [v, k === 'credits_spent' ? 'credits' : k]}
        />
        <Bar dataKey="credits_spent" name="credits" fill="#e0442c" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
