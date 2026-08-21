// ─── TasksTab.jsx ────────────────────────────────────────────────────────────
// Every task and project, where the owner can just look.
//
// WHY IT EXISTS. The owner asked "what are the pending tasks?" many times, and
// every answer came out of a file only I could read. That made them dependent
// on me for something they should be able to see, and made the list only as
// current as my last recital of it.
//
// This board is now the SINGLE SOURCE OF TRUTH. There were three lists — my
// memory file, my session list, and this — and three lists that disagree is
// worse than one that is merely imperfect.
//
// DESIGN NOTES
//   · Split by OWNER, because "what do I have to do" is the question being
//     asked, and mixing the two makes it unanswerable at a glance.
//   · BLOCKED shows what is blocking it. "Blocked" without a reason is just a
//     task nobody wants to look at.
//   · DONE stays on the board, hidden by default. A board showing only the
//     backlog makes steady progress look like standing still.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/adminApi';
import InfoDot from './InfoDot';

const STATUS = {
  in_progress: { label: 'Doing now', dot: 'var(--crm-blue)',  bg: 'var(--crm-blue-bg)' },
  blocked:     { label: 'Blocked',   dot: 'var(--crm-amber)', bg: 'var(--crm-amber-bg)' },
  pending:     { label: 'Waiting',   dot: 'var(--crm-w40)',   bg: 'transparent' },
  done:        { label: 'Done',      dot: 'var(--crm-green)', bg: 'transparent' },
};

/**
 * Every status that is not "done" — derived from STATUS below, never listed by
 * hand. Naming them by hand is how in_progress got left out of the open count.
 */
export function openCount(bucket = {}) {
  return Object.keys(STATUS)
    .filter((k) => k !== 'done')
    .reduce((n, k) => n + (Number(bucket?.[k]) || 0), 0);
}

const OWNER_LABEL = { owner: 'Yours', claude: 'Mine' };

function when(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (!Number.isFinite(d)) return null;
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

function Task({ t, onStatus, onMove, busy }) {
  const s = STATUS[t.status] || STATUS.pending;
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      border: '1px solid var(--crm-w08)', borderRadius: 10, marginBottom: 8,
      background: s.bg, padding: '11px 13px',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{
          width: 8, height: 8, borderRadius: '50%', background: s.dot, flex: 'none',
          transform: 'translateY(-1px)',
        }} />
        {t.ref && (
          <span style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
            color: 'var(--crm-w50)', flex: 'none',
          }}>#{t.ref}</span>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{
            background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
            fontSize: 13.5, fontWeight: 650, color: 'var(--crm-ink)', fontFamily: 'inherit',
            flex: 1, minWidth: 200,
            textDecoration: t.status === 'done' ? 'line-through' : 'none',
            opacity: t.status === 'done' ? 0.7 : 1,
          }}
        >{t.title}</button>

        <span style={{
          fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em',
          color: s.dot, fontWeight: 700, flex: 'none',
        }}>{s.label}</span>

        {/* Reorder within your own list. Up/down rather than typing a number:
            the priority scheme is an implementation detail, not something to
            learn in order to say "this one first". */}
        {t.status !== 'done' && (
          <span style={{ display: 'inline-flex', gap: 2, flex: 'none' }}>
            {/* Named by REFERENCE, not by title: "Move Move DNS to Cloudflare
                higher" is clumsy read aloud, and it collides with the title
                button that carries the same words. */}
            <button onClick={() => onMove(t.id, 'up')} disabled={busy === t.id}
              aria-label={`Higher priority: task ${t.ref ? `#${t.ref}` : t.id}`}
              title="Higher priority" style={arrowBtn}>▲</button>
            <button onClick={() => onMove(t.id, 'down')} disabled={busy === t.id}
              aria-label={`Lower priority: task ${t.ref ? `#${t.ref}` : t.id}`}
              title="Lower priority" style={arrowBtn}>▼</button>
          </span>
        )}

        {t.status !== 'done' ? (
          <button onClick={() => onStatus(t.id, 'done')} disabled={busy === t.id} style={btnSm}>
            {busy === t.id ? '…' : 'Done'}
          </button>
        ) : (
          <button onClick={() => onStatus(t.id, 'pending')} disabled={busy === t.id} style={btnSm}>
            {busy === t.id ? '…' : 'Reopen'}
          </button>
        )}
      </div>

      {t.blocked_by && (
        <div style={{ fontSize: 12, color: 'var(--crm-amber)', marginTop: 6, paddingLeft: 18 }}>
          <strong>Blocked by:</strong> {t.blocked_by}
        </div>
      )}

      {open && (
        <div style={{ paddingLeft: 18, marginTop: 8 }}>
          {t.why && (
            <div style={{ fontSize: 12.5, color: 'var(--crm-ink)', lineHeight: 1.6, marginBottom: 6 }}>
              <strong>Why:</strong> {t.why}
            </div>
          )}
          {t.detail && (
            <div style={{ fontSize: 12.5, color: 'var(--crm-w60)', lineHeight: 1.6 }}>{t.detail}</div>
          )}
          {t.done_at && (
            <div style={{ fontSize: 11, color: 'var(--crm-w40)', marginTop: 6 }}>
              finished {when(t.done_at)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TasksTab({ onError }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [who, setWho] = useState('all');

  const load = useCallback(async () => {
    setErr(null);
    try { setData(await adminApi.tasks()); }
    catch (e) { onError?.(e, 'Could not load the task list'); setErr(e); }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  async function onMove(id, move) {
    setBusy(id);
    try {
      const r = await adminApi.taskMove(id, move);
      setData(r);
      // Already top or bottom is not a failure — a red toast on a button that
      // behaved correctly teaches people to distrust the buttons.
      if (!r.moved) toast.message(move === 'up' ? 'Already first.' : 'Already last.');
    } catch (e) { onError?.(e, 'Could not reorder'); }
    finally { setBusy(null); }
  }

  async function onStatus(id, status) {
    setBusy(id);
    try {
      const r = await adminApi.taskStatus(id, status);
      setData(r);
      toast.success(status === 'done' ? 'Marked done.' : 'Reopened.');
    } catch (e) { onError?.(e, 'Could not update the task'); }
    finally { setBusy(null); }
  }

  const shown = useMemo(() => {
    const all = data?.tasks || [];
    return all
      .filter((t) => (showDone ? true : t.status !== 'done'))
      .filter((t) => (who === 'all' ? true : t.owner === who));
  }, [data, showDone, who]);

  if (err) {
    return (
      <div style={{ padding: 16, borderRadius: 12, background: 'var(--crm-red-bg)',
                    border: '1px solid var(--crm-red-br)' }}>
        <div style={{ color: 'var(--crm-red)', fontWeight: 700, marginBottom: 6 }}>
          {err.status === 401 ? 'Your admin session has expired' : 'The task list could not be read'}
        </div>
        <div style={{ color: 'var(--crm-w72)', fontSize: 12.5 }}>
          {err.status === 401
            ? 'Nothing is wrong with the list — sign in again and it will be here.'
            : 'Nothing is missing; it is unknown. Nothing was read.'}
        </div>
        <button onClick={load} style={btn}>Try again</button>
      </div>
    );
  }
  if (!data) return <div style={{ color: 'var(--crm-w50)' }}>Loading…</div>;

  const sum = data.summary || {};
  const groups = who === 'all'
    ? [['owner', shown.filter((t) => t.owner === 'owner')],
       ['claude', shown.filter((t) => t.owner === 'claude')]]
    : [[who, shown]];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {/* ── COUNT EVERYTHING THAT IS NOT DONE ──────────────────────────
            This said `pending + blocked` and silently dropped in_progress, so
            the pill read 16 while the section below it listed 18 and the sidebar
            badge said 29. Spotted by the owner on 2026-08-21 — three numbers
            describing the same list and disagreeing, which is exactly the kind
            of thing that makes a whole screen stop being trusted.

            It also read `a + b || 0`, which parses as `(a + b) || 0`: one
            missing status key turns the WHOLE pill into 0 rather than a partial
            count. Both fixed by deriving from the status list instead of naming
            statuses by hand — add a fifth status tomorrow and this still adds
            up. */}
        <Pill n={openCount(sum.owner)} label="yours open" tone="var(--crm-amber)" />
        <Pill n={openCount(sum.claude)} label="mine open" tone="var(--crm-blue)" />
        <Pill n={(sum.owner?.done || 0) + (sum.claude?.done || 0)} label="done" tone="var(--crm-green)" />
        <InfoDot
          label="this board"
          text={'Every task and project, and the history back to the start. This is now the single '
            + 'source of truth — I keep it current as part of doing the work, so you never have to '
            + 'ask what is pending. Mark your own items done; reopen anything I closed too early.'}
        />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {['all', 'owner', 'claude'].map((k) => (
            <button key={k} onClick={() => setWho(k)} aria-pressed={who === k}
              style={{ ...btnSm, ...(who === k ? activeBtn : {}) }}>
              {k === 'all' ? 'Everything' : OWNER_LABEL[k]}
            </button>
          ))}
          <button onClick={() => setShowDone((v) => !v)} aria-pressed={showDone}
            style={{ ...btnSm, ...(showDone ? activeBtn : {}) }}>
            {showDone ? 'Hide done' : 'Show done'}
          </button>
        </span>
      </div>

      {groups.map(([owner, list]) => (
        list.length ? (
          <section key={owner} style={{ marginBottom: 22 }}>
            <div style={{ fontWeight: 700, color: 'var(--crm-ink)', fontSize: 14, marginBottom: 8 }}>
              {OWNER_LABEL[owner]} <span style={{ color: 'var(--crm-w40)', fontWeight: 400 }}>({list.length})</span>
            </div>
            {list.map((t) => (
              <Task key={t.id} t={t} onStatus={onStatus} onMove={onMove} busy={busy} />
            ))}
          </section>
        ) : null
      ))}

      {!shown.length && (
        <div style={{ color: 'var(--crm-w50)', fontSize: 13 }}>
          Nothing here — try “Show done”.
        </div>
      )}
    </div>
  );
}

function Pill({ n, label, tone }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '5px 11px',
      borderRadius: 999, border: '1px solid var(--crm-w12)', background: 'var(--crm-w03)',
    }}>
      <strong style={{ color: tone, fontSize: 15,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{n}</strong>
      <span style={{ fontSize: 11.5, color: 'var(--crm-w55)' }}>{label}</span>
    </span>
  );
}

const arrowBtn = {
  width: 22, height: 22, padding: 0, borderRadius: 6, cursor: 'pointer', flex: 'none',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-w55)', fontSize: 9, lineHeight: 1, fontFamily: 'inherit',
};
const btnSm = {
  height: 26, padding: '0 10px', borderRadius: 7, cursor: 'pointer', flex: 'none',
  background: 'var(--crm-w06)', border: '1px solid var(--crm-w12)',
  color: 'var(--crm-ink)', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
};
const activeBtn = { background: 'var(--crm-ink)', color: 'var(--crm-page)', borderColor: 'var(--crm-ink)' };
const btn = { ...btnSm, height: 30, marginTop: 10 };
