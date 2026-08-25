// ─── ExpiryPanel.jsx ─────────────────────────────────────────────────────────
// Credit expiry — which credits die, and when. (Accounts never do.)
//
// Rebuilt 2026-08-25 for the owner's rule, in their words: "Do not expire any
// account. Only expire the credit if it passed thirty days from the day that
// the credit added to any user." The previous panel answered "who loses
// ACCESS and when" — a question that no longer has victims, because access
// expiry is retired. This one answers what replaced it: whose CREDITS pass
// their thirty days, and when.
//
// ── THE ONE PRESS, AND WHY IT IS GATED ─────────────────────────────────────
// Until Activate is pressed the hourly sweep takes nothing. (Sign-in was
// un-gated separately on 2026-08-25 after the workshop lockouts: no stored
// date can refuse an account any more, pressed or not — the press now wipes
// the leftover dates from the records and removes the overdue credits.)
// Gated behind the exact numbers on screen (a picture that moved while it
// was being read is refused server-side), because this is the press that
// touches 600 accounts' balances at once.
//
// ── THE REASSURANCE IS PART OF THE DESIGN, NOT DECORATION ──────────────────
// Expiry removes CREDITS ONLY. The account, its sign-in, its history and
// every image and video stay exactly where they are, and every removal is a
// ledger row naming the addition dates it took — traceable, reversible by a
// fresh grant. Somebody reading "5,000 credits will be removed" at speed
// needs that clause more than any other number on the screen.

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

const panel = {
  border: '1px solid var(--crm-w08)', borderRadius: 12,
  padding: '14px 16px', marginBottom: 14, background: 'var(--crm-w03)',
};

/** Red the day of and the day before; amber inside a week; plain after that. */
function urgency(daysLeft) {
  if (daysLeft <= 1) return { color: 'var(--crm-red)', label: daysLeft <= 0 ? 'TODAY' : 'TOMORROW' };
  if (daysLeft <= 7) return { color: 'var(--crm-amber)', label: `in ${daysLeft} days` };
  return { color: 'var(--crm-w60)', label: `in ${daysLeft} days` };
}

const daysUntil = (day) =>
  Math.ceil((Date.parse(`${day}T23:59:59Z`) - Date.now()) / 86400000);

export default function ExpiryPanel({ onError }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);      // which day's emails are shown
  const [armed, setArmed] = useState(false);   // has the preview been read?
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try { setData(await adminApi.creditLotsOverview(30)); }
    catch (e) { onError?.(e, 'Could not read the credit-expiry picture'); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const activate = useCallback(async () => {
    if (!data) return;
    setRunning(true);
    try {
      const r = await adminApi.creditLotsActivate({
        expect_accounts: data.due_now.accounts,
        expect_credits: data.due_now.credits,
      });
      toast.success(
        `${r.unlocked} account(s) got access back · ` +
        `${r.sweep ? r.sweep.credits : 0} overdue credits removed` +
        (r.sweep_error ? ' — first sweep pending, the hourly job finishes it' : ''));
      setArmed(false);
      load();
    } catch (e) {
      onError?.(e, 'Activation refused');
      // The usual refusal is "the numbers moved" — reload so the fresh
      // numbers are the ones on screen.
      load();
    } finally { setRunning(false); }
  }, [data, load, onError]);

  const copyEmails = (g) => {
    navigator.clipboard?.writeText((g.emails || []).join('\n'))
      .then(() => toast.success(`${g.emails.length} address(es) copied`))
      .catch(() => toast.error('Could not copy'));
  };

  if (!data) return <div style={panel}>Reading credit expiry…</div>;

  const active = Boolean(data.activated_at);
  const nothingSoon = !data.upcoming?.length;

  return (
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}
          title={`Every credit addition lives ${data.life_days} days from the day it was added (a promo code with its own access-days keeps its own number). The hourly sweep removes what has passed its date — credits only, never the account.`}>
          Credit expiry — the {data.life_days}-day rule
        </div>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: active ? 'var(--crm-green)' : 'var(--crm-amber)',
        }}>
          {active
            ? `active since ${new Date(data.activated_at).toLocaleDateString()}`
            : 'built and waiting — nothing happens until you press Activate'}
        </div>
        {active && (
          <span style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginLeft: 'auto' }}
            title="The sweep runs every hour on both instances; running twice is harmless by design.">
            {data.last_sweep_at
              ? `last sweep ${new Date(data.last_sweep_at).toLocaleString()}`
              : 'no sweep has taken anything yet'}
          </span>
        )}
      </div>

      {/* The clause that matters most, directly under the headline. */}
      <div style={{ fontSize: 12, color: 'var(--crm-w60)', marginTop: 6, lineHeight: 1.5 }}>
        Expiry removes credits only. Sign-in, history and every generated image and video
        stay untouched, and each removal is a ledger line naming the dates the credits
        were added — traceable, and reversible with a fresh grant.
      </div>

      {!active && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--crm-w08)',
        }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            One press does both halves of the change:
            <div>
              · <b>{data.locked_accounts}</b> old lockout date{data.locked_accounts === 1 ? '' : 's'} still
              on the records are wiped <span style={{ color: 'var(--crm-w40)' }}>(sign-in already
              ignores them — no date can refuse an account any more)</span>
            </div>
            <div>
              · <b style={{ color: data.due_now.accounts ? 'var(--crm-red)' : 'var(--crm-ink)' }}>
                {data.due_now.credits}
              </b> credits already past their {data.life_days} days are removed across{' '}
              <b>{data.due_now.accounts}</b> account{data.due_now.accounts === 1 ? '' : 's'}
            </div>
            {data.unattributed_credits > 0 && (
              <div style={{ color: 'var(--crm-w40)' }}
                title="Credits the ledger could not date — from before the ledger existed. They were given the full life from the day the dating ran rather than being expired on a guess.">
                · {data.unattributed_credits} credits had no recorded addition date and were given
                the full {data.life_days} days from today — they are NOT in the removal above
              </div>
            )}
          </div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, marginTop: 10, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
            I have read these numbers — unlock {data.locked_accounts} account
            {data.locked_accounts === 1 ? '' : 's'} and remove {data.due_now.credits} overdue credits
          </label>
          {/* Same red-on-red-tint pattern as the bulk-expiry button — the
              theme guard rejected a plain literal here once already. */}
          <button onClick={activate} disabled={!armed || running}
            style={{
              marginTop: 8, fontSize: 12, padding: '6px 14px', borderRadius: 8,
              border: '1px solid var(--crm-red-br)',
              background: armed ? 'var(--crm-red-bg)' : 'transparent',
              color: armed ? 'var(--crm-red)' : 'var(--crm-w30)',
              fontWeight: armed ? 700 : 400,
              cursor: armed && !running ? 'pointer' : 'not-allowed',
            }}>
            {running ? 'Activating…' : 'Activate the rule'}
          </button>
        </div>
      )}

      {/* The look-ahead: whose credits die on which day. */}
      {nothingSoon ? (
        <div style={{ fontSize: 12, color: 'var(--crm-w40)', marginTop: 12 }}>
          No credits reach their {data.life_days} days in the next 30 days.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {data.upcoming.map((g) => {
            const left = daysUntil(g.day);
            const u = urgency(left);
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
                    <b>{g.credits}</b> credits
                    <span style={{ color: 'var(--crm-w40)' }}>
                      {' '}across {g.accounts} account{g.accounts === 1 ? '' : 's'}
                    </span>
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
                    title="Copy these addresses — e.g. to warn a workshop group their credits end this day."
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
                    {(g.emails || []).map((e) => <div key={e}>{e}</div>)}
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
