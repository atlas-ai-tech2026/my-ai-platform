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
import { CREDIT_PLANS } from '@/lib/creditPricing';
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
  const [usage, setUsage] = useState(null); // { daily, recent }

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await authedFetch('/api/me/usage'));
    } catch (e) {
      console.error('[account] usage load failed:', e.message);
    }
  }, []);

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
          {section === 'usage' && <UsageSection user={user} usage={usage} />}
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
function UsageSection({ user, usage }) {
  const spends = useMemo(
    () => (usage?.recent || []).filter(r => r.action === 'spend'),
    [usage]
  );
  const total30 = useMemo(
    () => (usage?.daily || []).reduce((s, d) => s + d.credits_spent, 0),
    [usage]
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Usage</h1>
      <div className="rounded-2xl border border-border bg-white/[0.03] p-6">
        <div className="text-sm text-foreground-muted mb-4">
          Last 30 days — <b className="text-white">{total30.toLocaleString()}</b> credits used
          · balance <b className="text-white">{Number(user?.credits || 0).toLocaleString()}</b>
        </div>
        <MiniUsageChart daily={usage?.daily} height={220} showAxis />
      </div>
      <div className="rounded-2xl border border-border bg-white/[0.03] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-foreground-muted">
              <th className="px-5 py-3 font-medium">When</th>
              <th className="px-5 py-3 font-medium">Generation</th>
              <th className="px-5 py-3 font-medium text-right">Credits</th>
            </tr>
          </thead>
          <tbody>
            {!usage && <tr><td colSpan={3} className="px-5 py-8 text-center text-foreground-muted">Loading…</td></tr>}
            {usage && spends.length === 0 && (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-foreground-muted">No generations yet — your usage will appear here.</td></tr>
            )}
            {spends.slice(0, 30).map(r => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-5 py-3 text-foreground-muted whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-5 py-3 text-white">{r.reason || 'Generation'}</td>
                <td className="px-5 py-3 text-right text-red-400 font-semibold">{Number(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
