// ─── StatsCards ──────────────────────────────────────────────────────────────
// Top-of-page summary tiles + "Last admin login" banner.
import React from 'react';

export default function StatsCards({ stats }) {
  if (!stats) return null;
  const lastLogin = stats.recent_admin_logins?.[0];

  return (
    <>
      {lastLogin && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: 'var(--crm-amber-bg)',
          border: '1px solid var(--crm-amber-br)',
          borderRadius: 10, fontSize: 12,
          color: 'var(--crm-amber)', fontFamily: '"DM Sans", sans-serif',
        }}>
          <strong>Last admin login:</strong>{' '}
          {new Date(lastLogin.created_at).toLocaleString()} from {lastLogin.ip_address || 'unknown'}
          {lastLogin.user_agent && (
            <span style={{ opacity: 0.6 }}> · {String(lastLogin.user_agent).slice(0, 60)}</span>
          )}
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        <Card label="Total users"        value={stats.total_users} />
        <Card label="Active in 24h"      value={stats.active_today} />
        <Card label="Banned"             value={stats.total_banned} accent={stats.total_banned > 0 ? 'var(--crm-red)' : undefined} />
        <Card label="Credits outstanding" value={Number(stats.total_credits_outstanding).toFixed(2)} />
        <Card label="Spends in 24h"      value={stats.spends_24h} />
        <Card
          label="Cost: image / video"
          value={`${stats.credit_costs.image} / ${stats.credit_costs.video}`}
          small
        />
      </div>
    </>
  );
}

function Card({ label, value, accent, small }) {
  return (
    <div style={{
      padding: 16, background: 'var(--crm-w03)',
      border: '1px solid var(--crm-w06)', borderRadius: 12,
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--crm-w40)' }}>
        {label}
      </div>
      <div style={{
        marginTop: 6, fontSize: small ? 18 : 26, fontWeight: 700,
        color: accent || 'var(--crm-ink)',
      }}>{value ?? '—'}</div>
    </div>
  );
}
