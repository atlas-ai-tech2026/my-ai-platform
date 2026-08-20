// ─── ExpiryPanel.jsx ─────────────────────────────────────────────────────────
// Who loses access, and when.
//
// Built urgently on 2026-08-20. The owner asked which accounts created on
// 21-23 June would expire "tomorrow" and there was no way to find out: the
// Users table shows an access column per row and nothing sorts or filters by
// it, so answering meant scrolling 601 rows — which produces a guess, not an
// answer. Nothing warned in advance either, so the first sign of an expiry was
// a customer unable to sign in.
//
// ── THE REASSURANCE IS PART OF THE DESIGN, NOT DECORATION ──────────────────
// The fear behind the question is that customers and their work disappear. They
// do not: expiry refuses the login and touches nothing else. Somebody reading
// "12 accounts expire tomorrow" at speed needs that clause more than any other
// number on the screen, so it sits directly under the headline rather than in a
// tooltip nobody opens.

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

const panel = {
  border: '1px solid var(--crm-w08)', borderRadius: 12,
  padding: '14px 16px', marginBottom: 14, background: 'var(--crm-w03)',
};

/** Red the day of and the day before; amber inside a week; plain after that. */
function urgency(daysLeft) {
  if (daysLeft <= 1) return { color: 'var(--crm-red)', label: daysLeft === 0 ? 'TODAY' : 'TOMORROW' };
  if (daysLeft <= 7) return { color: 'var(--crm-amber)', label: `in ${daysLeft} days` };
  return { color: 'var(--crm-w60)', label: `in ${daysLeft} days` };
}

export default function ExpiryPanel({ onError }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(14);
  const [open, setOpen] = useState(null);      // which day is expanded

  const load = useCallback(async () => {
    try { setData(await adminApi.expiryReport(days)); }
    catch (e) { onError?.(e, 'Could not read the expiry report'); }
  }, [days, onError]);

  useEffect(() => { load(); }, [load]);

  const copyEmails = (group) => {
    const text = group.accounts.map((a) => a.email).join('\n');
    navigator.clipboard?.writeText(text)
      .then(() => toast.success(`${group.accounts.length} address(es) copied`))
      .catch(() => toast.error('Could not copy'));
  };

  if (!data) return <div style={panel}>Reading access dates…</div>;

  const s = data.summary;
  const nothingSoon = !data.upcoming?.length;

  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Access expiry</div>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: nothingSoon ? 'var(--crm-green)' : 'var(--crm-red)',
        }}>
          {s.headline}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--crm-w40)' }}>looking ahead</span>
          {[7, 14, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                fontSize: 11.5, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--crm-w08)',
                background: days === d ? 'var(--crm-w08)' : 'transparent',
                color: days === d ? 'var(--crm-ink)' : 'var(--crm-w40)',
              }}>{d}d</button>
          ))}
        </div>
      </div>

      {/* The clause that matters most, immediately under the alarming number. */}
      <div style={{ fontSize: 12, color: 'var(--crm-w60)', marginTop: 6, lineHeight: 1.5 }}>
        {s.reassurance}
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
        <span><b>{data.total_accounts}</b> accounts</span>
        <span style={{ color: 'var(--crm-w40)' }}>
          <b style={{ color: 'var(--crm-ink)' }}>{data.open_ended}</b> never expire
        </span>
        <span style={{ color: 'var(--crm-w40)' }}>
          <b style={{ color: data.already_expired ? 'var(--crm-red)' : 'var(--crm-ink)' }}>
            {data.already_expired}
          </b> already expired
        </span>
        {s.creditsAffected > 0 && (
          <span style={{ color: 'var(--crm-w40)' }}>
            <b style={{ color: 'var(--crm-ink)' }}>{s.creditsAffected}</b> credits behind the
            accounts expiring in this window
          </span>
        )}
      </div>

      {nothingSoon ? (
        <div style={{ fontSize: 12, color: 'var(--crm-w40)', marginTop: 12 }}>
          Nothing loses access in the next {days} days.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {data.upcoming.map((g) => {
            const u = urgency(g.daysLeft);
            const isOpen = open === g.day;
            return (
              <div key={g.day} style={{ borderTop: '1px solid var(--crm-w06)', padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: u.color, fontWeight: 700, fontSize: 12.5, minWidth: 92 }}>
                    {u.label}
                  </span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>
                    {g.day}
                  </span>
                  <span style={{ fontSize: 12.5 }}>
                    <b>{g.accounts.length}</b> account{g.accounts.length === 1 ? '' : 's'}
                    {g.credits > 0 && (
                      <span style={{ color: 'var(--crm-w40)' }}> · {g.credits} credits</span>
                    )}
                  </span>
                  <button onClick={() => setOpen(isOpen ? null : g.day)}
                    style={{
                      marginLeft: 'auto', fontSize: 11.5, padding: '3px 8px', borderRadius: 6,
                      border: '1px solid var(--crm-w08)', background: 'transparent',
                      color: 'var(--crm-w60)', cursor: 'pointer',
                    }}>
                    {isOpen ? 'hide' : 'who'}
                  </button>
                  <button onClick={() => copyEmails(g)}
                    style={{
                      fontSize: 11.5, padding: '3px 8px', borderRadius: 6,
                      border: '1px solid var(--crm-w08)', background: 'transparent',
                      color: 'var(--crm-w60)', cursor: 'pointer',
                    }}>
                    copy emails
                  </button>
                </div>
                {isOpen && (
                  <div style={{
                    marginTop: 6, fontSize: 11.5, color: 'var(--crm-w60)',
                    fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.8,
                    wordBreak: 'break-all',
                  }}>
                    {g.accounts.map((a) => (
                      <div key={a.id}>
                        {a.email}
                        <span style={{ color: 'var(--crm-w30)' }}>
                          {' · '}{a.credits} credits
                          {/* An expiry stored as a bare date is MIDNIGHT UTC —
                              3am in Kuwait. "Expires on the 21st" means access
                              ends in the small hours OF the 21st, not at the
                              end of it, which decides whether a workshop that
                              day works. */}
                          {' · ends '}{new Date(a.at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
