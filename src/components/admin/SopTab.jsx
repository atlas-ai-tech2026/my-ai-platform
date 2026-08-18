// ─── SopTab.jsx ──────────────────────────────────────────────────────────────
// The screen you open every morning: what every automated check found, and
// WHAT TO DO about each one.
//
// It exists because on 2026-08-18 the owner asked how to check the backup
// system and the honest answer was "there is no screen — open a raw API URL".
// Every check already existed. Not one of them had a face.
//
// ── HOW THIS DIFFERS FROM ALERTS ────────────────────────────────────────────
// Alerts shows only what is WRONG, and shouts. This shows the whole picture
// INCLUDING what is fine, because "everything is fine" is most of what you
// need before standing in front of a room. Both read the same checks, so they
// can never tell different stories.
//
// ── THE RULE THE DESIGN ENFORCES ────────────────────────────────────────────
// Green is EARNED. A line that could not be determined shows as "not checked",
// never as healthy — those are different facts and only one is reassuring. And
// every line that is not OK carries its action, because a status without an
// action is just a number to worry about.

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const STATE_STYLE = {
  critical: { dot: 'var(--crm-red)',   bg: 'var(--crm-red-bg)',   label: 'Act now' },
  warn:     { dot: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)', label: 'This week' },
  unknown:  { dot: 'var(--crm-w40)',   bg: 'var(--crm-w05)',      label: 'Not checked' },
  ok:       { dot: 'var(--crm-green)', bg: 'transparent',         label: 'Fine' },
};

const ZONE_META = {
  today: {
    title: 'Today',
    blurb: 'Changes minute to minute. This is the reason to open this tab.',
  },
  integrity: {
    title: 'Structure',
    blurb: 'Changes only when the code changes — a screen promising something no table keeps.',
  },
  posture: {
    title: 'Security posture',
    blurb: 'Changes almost never. Only what is still open or can be checked live.',
  },
};

function ago(iso) {
  if (!iso) return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Line({ line }) {
  const s = STATE_STYLE[line.state] || STATE_STYLE.unknown;
  const checked = ago(line.checked_at);
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10,
      background: s.bg, border: '1px solid var(--crm-w08)', marginBottom: 8,
      alignItems: 'flex-start',
    }}>
      <span aria-hidden="true" style={{
        width: 9, height: 9, borderRadius: '50%', background: s.dot,
        flex: 'none', marginTop: 6,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 13.5 }}>{line.label}</span>
          {/* Standing rule: every line explains itself where it is read. */}
          <InfoDot label={line.label} text={line.info} />
          {line.value != null && (
            <span style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12.5, color: 'var(--crm-w72)',
            }}>{line.value}</span>
          )}
          <span style={{
            marginLeft: 'auto', fontSize: 10.5, textTransform: 'uppercase',
            letterSpacing: '.06em', color: s.dot, fontWeight: 700,
          }}>{s.label}</span>
        </div>

        {line.detail && (
          <div style={{ fontSize: 12.5, color: 'var(--crm-w60)', marginTop: 4, lineHeight: 1.55 }}>
            {line.detail}
          </div>
        )}

        {/* The action is the point of the whole screen. */}
        {line.action && (
          <div style={{
            fontSize: 12.5, color: 'var(--crm-ink)', marginTop: 6, lineHeight: 1.55,
            paddingLeft: 10, borderLeft: `2px solid ${s.dot}`,
          }}>
            <strong>Do:</strong> {line.action}
          </div>
        )}

        {/* "No news" must never be indistinguishable from "stopped running". */}
        <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginTop: 6 }}>
          {checked ? `checked ${checked}` : 'never checked'}
        </div>
      </div>
    </div>
  );
}

export default function SopTab({ onError }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try { setData(await adminApi.sop()); }
    catch (e) { onError?.(e, 'Could not load the operations picture'); setErr(e); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  async function checkNow() {
    setBusy(true);
    try {
      const r = await adminApi.sopCheckNow();
      setData(r);
      // The restore check downloads a real archive, so it is rate limited.
      // Saying WHY it did not run beats a button that silently does nothing.
      if (r.restore && !r.restore.ran && r.restore.reason) {
        toast.message(`Backup restore check: ${r.restore.reason}`);
      } else if (r.restore?.ran) {
        toast[r.restore.ok ? 'success' : 'error'](
          r.restore.ok ? 'Backup verified — a real archive was read back.'
                       : `Backup check failed: ${(r.restore.problems || [])[0] || 'see the line below'}`);
      }
    } catch (e) {
      onError?.(e, 'The checks could not be run');
      setErr(e);
    } finally { setBusy(false); }
  }

  if (err) {
    return (
      <div style={{ padding: 16, borderRadius: 12, background: 'var(--crm-red-bg)',
                    border: '1px solid var(--crm-red-br)' }}>
        <div style={{ color: 'var(--crm-red)', fontWeight: 700, marginBottom: 6 }}>
          {err.status === 401 ? 'Your admin session has expired' : 'The checks could not be read'}
        </div>
        <div style={{ color: 'var(--crm-w72)', fontSize: 12.5, lineHeight: 1.6 }}>
          {err.status === 401
            ? 'Nothing is wrong with the system — sign in again and this will be here.'
            : 'Nothing below is missing; it is unknown. Nothing was checked.'}
        </div>
        <button onClick={load} style={btn}>Try again</button>
      </div>
    );
  }

  if (!data) return <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>;

  const zones = data.zones || {};
  const all = Object.values(zones).flat();
  const worst = data.summary?.state || 'ok';
  const cooldown = data.restore_cooldown_min || 0;

  return (
    <div>
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          borderRadius: 999, background: STATE_STYLE[worst].bg,
          border: `1px solid ${STATE_STYLE[worst].dot}`,
        }}>
          <span aria-hidden="true" style={{
            width: 9, height: 9, borderRadius: '50%', background: STATE_STYLE[worst].dot }} />
          <strong style={{ fontSize: 13, color: 'var(--crm-ink)' }}>
            {worst === 'ok' ? 'Everything is fine'
              : worst === 'unknown' ? 'Something could not be checked'
              : worst === 'warn' ? 'Something needs attention this week'
              : 'Something needs you now'}
          </strong>
        </span>

        <span style={{ fontSize: 12, color: 'var(--crm-w50)' }}>
          {all.length} check{all.length === 1 ? '' : 's'} · built {ago(data.generated_at) || 'now'}
        </span>

        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          {cooldown > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--crm-w50)' }}>
              backup re-check in {cooldown} min
            </span>
          )}
          <InfoDot
            label="Check now"
            text={'Re-runs every check immediately. The cheap ones are always current — they are '
              + 'computed fresh each time this screen loads. The backup restore check downloads a '
              + 'real 5 MB archive from storage, so it will not re-run more than once an hour; if '
              + 'it is cooling down it says so rather than pretending.'}
          />
          <button onClick={checkNow} disabled={busy} style={btn}>
            {busy ? 'Checking…' : 'Check now'}
          </button>
        </span>
      </div>

      {Object.entries(ZONE_META).map(([id, meta]) => {
        const lines = zones[id] || [];
        if (!lines.length) return null;
        return (
          <section key={id} style={{ marginBottom: 22 }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14 }}>{meta.title}</div>
              <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginTop: 2 }}>{meta.blurb}</div>
            </div>
            {lines.map((l) => <Line key={l.key} line={l} />)}
          </section>
        );
      })}

      <Schedule
        rows={data.schedule}
        onSaved={(schedule) => setData((d) => ({ ...d, schedule }))}
        onError={onError}
      />
    </div>
  );
}

/**
 * The cadences, editable.
 *
 * Times are shown and entered in KUWAIT time and the label says so. The server
 * is UTC; an unlabelled clock is exactly how the expiry table once rendered
 * every date a day early.
 */
function Schedule({ rows, onSaved, onError }) {
  const [saving, setSaving] = useState(null);
  if (!rows?.length) return null;

  async function save(row, patch) {
    setSaving(row.job);
    try {
      const r = await adminApi.sopScheduleSave({
        job: row.job,
        enabled: patch.enabled ?? row.enabled,
        every: patch.every ?? row.every,
        hour_kuwait: patch.hour_kuwait ?? row.hour_kuwait,
      });
      onSaved?.(r.schedule);
      toast.success('Schedule saved.');
    } catch (e) { onError?.(e, 'Could not save the schedule'); }
    finally { setSaving(null); }
  }

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14 }}>When these run</span>
          <InfoDot
            label="When these run"
            text={'All times are KUWAIT time. The server keeps UTC and converts. Checks are driven '
              + 'by when they LAST RAN, not by a timer — this app redeploys many times a day, and a '
              + 'timer set weeks ahead on a process that lives hours would never fire.'}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--crm-w50)', marginTop: 2 }}>
          Change how often each check runs, and at what hour. Times are Kuwait (UTC+3).
        </div>
      </div>

      {rows.map((row) => (
        <div key={row.job} style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          padding: '10px 12px', borderRadius: 10, marginBottom: 8,
          border: '1px solid var(--crm-w08)', background: 'var(--crm-w03)',
        }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!row.enabled}
              onChange={(e) => save(row, { enabled: e.target.checked })} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--crm-ink)' }}>{row.label}</span>
          </label>
          <InfoDot label={row.label} text={row.info} />

          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--crm-w55)' }}>every</span>
            <select value={row.every} onChange={(e) => save(row, { every: e.target.value })}
              disabled={saving === row.job} style={sel} aria-label={`How often ${row.label} runs`}>
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
            <span style={{ fontSize: 12, color: 'var(--crm-w55)' }}>at</span>
            <select value={row.hour_kuwait} onChange={(e) => save(row, { hour_kuwait: Number(e.target.value) })}
              disabled={saving === row.job} style={sel} aria-label={`What hour ${row.label} runs, Kuwait time`}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: 'var(--crm-w40)' }}>Kuwait</span>
          </span>

          <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--crm-w40)' }}>
            {row.last_run_at ? `last ran ${ago(row.last_run_at)}` : 'has never run'}
          </div>
        </div>
      ))}
    </section>
  );
}

const sel = {
  height: 28, borderRadius: 7, padding: '0 8px', fontSize: 12.5, fontFamily: 'inherit',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)', color: 'var(--crm-ink)',
};

const btn = {
  height: 32, padding: '0 14px', borderRadius: 9, cursor: 'pointer',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
  marginTop: 10,
};
