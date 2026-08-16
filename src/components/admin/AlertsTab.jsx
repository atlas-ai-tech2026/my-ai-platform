// ─── AlertsTab ───────────────────────────────────────────────────────────────
// The screen the panel did not have: what needs your attention, without you
// going to look for it.
//
// The case for it, in one story. A kie-balance check ran hourly for weeks and
// its entire output was console.error. On 8 August 415 generations failed with
// the provider saying "Credits insufficient" while a workshop was running.
// Everyone was refunded automatically, so no money went missing — what went
// missing was the room's confidence, and the only record was a log line that
// has since rotated away.
//
// Design rules that follow from that:
//   · severity is a COLOUR as well as a word, so the list is scannable
//     without being read;
//   · resolved items stay for seven days — "it fixed itself" is information,
//     and a condition that keeps coming back is a pattern;
//   · Acknowledge does NOT clear the row. It only stops the email. Letting a
//     screen mark a live problem "done" is how it gets forgotten.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';

const TONE = {
  critical: { bg: 'var(--crm-red-bg)',   br: 'var(--crm-red-br)',   fg: 'var(--crm-red)',   word: 'Critical' },
  warning:  { bg: 'var(--crm-amber-bg)', br: 'var(--crm-amber-br)', fg: 'var(--crm-amber)', word: 'Warning' },
  info:     { bg: 'var(--crm-w06)',      br: 'var(--crm-w10)',      fg: 'var(--crm-w55)',   word: 'Info' },
};
const toneOf = (s) => TONE[s] || TONE.info;

const ago = (iso) => {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function AlertsTab({ onError }) {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await adminApi.alerts();
      setData(d);
      setForm((f) => f || d.settings);
    } catch (e) { onError?.(e); setData({ open: [], resolved: [] }); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  // The server checks every 5 minutes; refreshing the view on the same cadence
  // keeps an open panel honest without polling hard.
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await adminApi.alertsCheck();
      toast.success(r.open ? `${r.open} alert(s) open` : 'Checked — nothing needs attention.');
      await load();
    } catch (e) { onError?.(e); toast.error(e?.message || 'Check failed.'); }
    finally { setChecking(false); }
  };

  const ack = async (id) => {
    setBusy(id);
    try { await adminApi.alertAck(id); await load(); }
    catch (e) { onError?.(e); toast.error(e?.message || 'Could not acknowledge.'); }
    finally { setBusy(null); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const s = await adminApi.alertSettings(form);
      setForm(s);
      toast.success('Thresholds saved.');
      await load();
    } catch (e) { onError?.(e); toast.error(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const open = data?.open || [];
  const resolved = data?.resolved || [];
  const critical = open.filter((a) => a.severity === 'critical').length;

  return (
    <div style={{ fontFamily: '"DM Sans", sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, color: 'var(--crm-ink)' }}>Alerts</h2>
        <button onClick={checkNow} disabled={checking} style={btn}>
          {checking ? 'Checking…' : '⟳ Check now'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--crm-w45)' }}>
          {data?.last_check_at
            ? `Checked ${ago(data.last_check_at)} · runs every 5 minutes`
            : 'Runs every 5 minutes'}
        </span>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--crm-w55)', lineHeight: 1.6, margin: '0 0 16px', maxWidth: '76ch' }}>
        What needs your attention, without going to look for it. Anything critical or warning also
        emails you <b>once</b> — and again only if it is still critical a day later, so the sender
        stays worth reading.
      </p>

      {data === null && <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>}

      {data && !open.length && (
        <div style={{ ...card, borderColor: 'var(--crm-green-br)', background: 'var(--crm-green-bg)',
          color: 'var(--crm-green)', fontWeight: 600 }}>
          ✅ Nothing needs your attention.
        </div>
      )}

      {critical > 0 && (
        <div style={{ ...card, borderColor: 'var(--crm-red-br)', background: 'var(--crm-red-bg)',
          color: 'var(--crm-red)', marginBottom: 12 }}>
          <b>{critical} critical</b> — these are affecting customers right now.
        </div>
      )}

      {open.map((a) => {
        const t = toneOf(a.severity);
        return (
          <div key={a.id} style={{ ...row, borderLeft: `3px solid ${t.fg}` }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...pill, background: t.bg, color: t.fg, border: `1px solid ${t.br}` }}>
                  {t.word}
                </span>
                <span style={{ color: 'var(--crm-ink)', fontWeight: 640, fontSize: 13.5 }}>{a.title}</span>
                {a.status === 'acknowledged' && (
                  <span style={{ ...pill, background: 'var(--crm-w06)', color: 'var(--crm-w55)',
                    border: '1px solid var(--crm-w10)' }}>acknowledged</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--crm-w55)', marginTop: 4, lineHeight: 1.55 }}>
                {a.detail}
              </div>
              <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginTop: 4 }}>
                First seen {ago(a.first_seen)}
                {a.seen_count > 1 && ` · still happening after ${a.seen_count} checks`}
              </div>
            </div>
            {a.status !== 'acknowledged' && (
              <button onClick={() => ack(a.id)} disabled={busy === a.id} style={btn}
                title="Stops the email. The alert stays until the condition actually clears.">
                {busy === a.id ? '…' : 'Acknowledge'}
              </button>
            )}
          </div>
        );
      })}

      {/* ── thresholds ── */}
      {form && (
        <details style={{ marginTop: 26 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--crm-w72)', fontSize: 13, fontWeight: 600 }}>
            Thresholds and email
          </summary>
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
              <Field label="Warn when kie credits fall below" hint="Higher than it looks: a busy workshop can go from this to empty between two checks."
                value={form.kie_balance_min} onChange={(v) => setForm({ ...form, kie_balance_min: v })} />
              <Field label="Flag a video charge stuck for (hours)" hint="Charged, nothing delivered."
                value={form.stuck_charge_hours} onChange={(v) => setForm({ ...form, stuck_charge_hours: v })} />
              <Field label="Warn when failures exceed (%)" hint="Of the last hour's generations."
                value={form.failure_rate_pct} onChange={(v) => setForm({ ...form, failure_rate_pct: v })} />
              <Field label="…but only after this many attempts" hint="3 failures out of 4 is 75% and means nothing."
                value={form.failure_min_attempts} onChange={(v) => setForm({ ...form, failure_min_attempts: v })} />
              <Field label="Warn if the nightly sweep is older than (hours)" hint="A stale sweep looks like a fresh one."
                value={form.catalogue_stale_hours} onChange={(v) => setForm({ ...form, catalogue_stale_hours: v })} />
              <div>
                <label style={lbl}>Email alerts to</label>
                <input style={inp} value={form.email_to || ''} placeholder="info@voxel-ai.ai"
                  onChange={(e) => setForm({ ...form, email_to: e.target.value })} />
                <label style={{ ...hint, display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                  <input type="checkbox" checked={!!form.email_enabled}
                    onChange={(e) => setForm({ ...form, email_enabled: e.target.checked })} />
                  Send emails
                </label>
              </div>
            </div>
            <button onClick={save} disabled={saving} style={{ ...btn, marginTop: 14 }}>
              {saving ? 'Saving…' : 'Save thresholds'}
            </button>
          </div>
        </details>
      )}

      {/* ── resolved ── */}
      {resolved.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--crm-w55)', fontSize: 12.5 }}>
            Resolved in the last 7 days ({resolved.length})
          </summary>
          <div style={{ marginTop: 10 }}>
            {resolved.map((a) => (
              <div key={a.id} style={{ ...row, opacity: 0.72 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--crm-w72)', fontSize: 13 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginTop: 2 }}>
                    Cleared {ago(a.resolved_at)}
                    {a.seen_count > 1 && ` · lasted ${a.seen_count} checks`}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--crm-w40)', marginTop: 8, maxWidth: '70ch' }}>
            Kept on purpose. Something that resolves itself and then comes back is a pattern, and
            deleting it hides that.
          </p>
        </details>
      )}
    </div>
  );
}

function Field({ label, hint: h, value, onChange }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input style={inp} type="number" min="0" value={value ?? ''}
        onChange={(e) => onChange(e.target.value)} />
      {h && <div style={hint}>{h}</div>}
    </div>
  );
}

const card = {
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 12, padding: '14px 16px',
};
const row = {
  display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
  background: 'var(--crm-w03)', border: '1px solid var(--crm-w08)',
  borderRadius: 10, padding: '12px 14px', marginBottom: 8,
};
const btn = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-w85)', cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
};
const pill = {
  padding: '1.5px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
  letterSpacing: '.04em', textTransform: 'uppercase',
};
const lbl = { display: 'block', fontSize: 11.5, color: 'var(--crm-w55)', marginBottom: 4, fontWeight: 600 };
const inp = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w10)',
  color: 'var(--crm-ink)', fontFamily: '"DM Sans", sans-serif',
};
const hint = { fontSize: 11, color: 'var(--crm-w40)', marginTop: 4, lineHeight: 1.45 };
