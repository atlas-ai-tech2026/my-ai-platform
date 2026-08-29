// ─── RecentlyDeleted.jsx ─────────────────────────────────────────────────────
// The screen the delete confirmation points at.
//
// ── WHY IT HAD TO EXIST BEFORE DELETE COULD SHIP ───────────────────────────
// The confirmation says, in writing:
//
//     "You can bring them back for 30 days from Recently deleted."
//
// Until this screen existed the Undo bar was the only way back, and it
// disappeared on the next page load. Someone could delete, refresh, and have
// no route to recovery at all — while the sentence they had just read promised
// them one. Shipping that would have been a written promise we do not keep,
// which is worse than not having the feature.
//
// ── SOONEST TO BE LOST, FIRST ──────────────────────────────────────────────
// Sorted by time remaining rather than by when it was deleted. What matters is
// what is about to go for good; a picture with 2 days left needs a decision
// today and one with 29 does not.

import React from 'react';

const font = '"DM Sans", sans-serif';

/** Red once it is nearly out of time. A number alone is not urgency. */
export const isUrgent = (daysLeft) => Number(daysLeft) <= 7;

/** "2 days left" · "1 day left" · "last day". Never "0 days left", which reads
 *  as already gone while the picture is still recoverable. */
export function timeLeftLabel(daysLeft) {
  // null and '' both become 0 through Number(), which is FINITE — so without
  // this an unknown date rendered as "last day" and told somebody their
  // picture was about to be destroyed when nothing was known about it at all.
  if (daysLeft === null || daysLeft === undefined || daysLeft === '') return 'unknown';
  const d = Number(daysLeft);
  if (!Number.isFinite(d)) return 'unknown';
  if (d <= 0) return 'last day';
  return d === 1 ? '1 day left' : `${d} days left`;
}

export default function RecentlyDeleted({
  items, loading, error, recoveryDays = 30, busy = false, selected = [], onToggle, onRestore, onReload,
}) {
  if (loading) {
    return <Note>Loading what you have deleted…</Note>;
  }
  if (error) {
    // A failure here must not read as "nothing to recover" — that is the one
    // wrong answer, because it is indistinguishable from the good news.
    return (
      <Note tone="bad">
        Could not load your deleted pictures. They have not been lost — nothing here deletes anything.{' '}
        <button onClick={onReload} style={btn}>Try again</button>
      </Note>
    );
  }
  if (!items?.length) {
    return (
      <Note>
        Nothing deleted in the last {recoveryDays} days. Anything you delete appears here,
        and can be brought back for {recoveryDays} days.
      </Note>
    );
  }

  return (
    <div style={{ padding: '4px 28px 14px', fontFamily: font }}>
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>
          {items.length} recoverable · soonest to be lost first
        </span>
        <button
          onClick={onRestore} disabled={!selected.length || busy}
          style={{ ...btn, marginLeft: 'auto', opacity: selected.length && !busy ? 1 : 0.45 }}
        >
          {busy ? 'Restoring…' : selected.length ? `Restore ${selected.length}` : 'Restore'}
        </button>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 10, paddingTop: 12,
      }}>
        {items.map((it) => {
          const on = selected.includes(it.id);
          const urgent = isUrgent(it.days_left);
          return (
            <button
              key={it.id} onClick={() => onToggle?.(it.id)} disabled={busy}
              aria-pressed={on}
              style={{
                textAlign: 'left', padding: 0, cursor: 'pointer', borderRadius: 12,
                overflow: 'hidden', background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${on ? '#E01E1E' : 'rgba(255,255,255,0.10)'}`,
                fontFamily: font,
              }}
            >
              <div style={{ position: 'relative', aspectRatio: '1 / 1', background: 'rgba(0,0,0,0.35)' }}>
                {/* The small version if it exists — a recovery screen should not
                    download full-size files to show what you might restore. */}
                {(it.thumb_url || it.result_url) && (
                  <img
                    src={it.thumb_url || it.result_url} alt="" loading="lazy" decoding="async"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: on ? 1 : 0.55 }}
                  />
                )}
                <span style={{
                  position: 'absolute', top: 8, left: 8, padding: '3px 8px', borderRadius: 999,
                  fontSize: 11, fontWeight: 700,
                  background: urgent ? '#E01E1E' : 'rgba(0,0,0,0.65)',
                  color: '#FFF', border: '1px solid rgba(255,255,255,0.2)',
                }}>{timeLeftLabel(it.days_left)}</span>
                {on && (
                  <span style={{
                    position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 7,
                    background: '#E01E1E', color: '#FFF', fontSize: 14, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>✓</span>
                )}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{
                  fontSize: 12, color: 'rgba(255,255,255,0.82)', lineHeight: 1.4,
                  overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>{it.prompt || 'No prompt'}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  {it.model || 'Image'}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Note({ children, tone }) {
  return (
    <div style={{
      margin: '4px 28px 14px', padding: '14px 16px', borderRadius: 10, fontFamily: font,
      fontSize: 13, lineHeight: 1.6,
      color: tone === 'bad' ? '#FFB4B4' : 'rgba(255,255,255,0.72)',
      background: tone === 'bad' ? 'rgba(224,30,30,0.12)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${tone === 'bad' ? 'rgba(224,30,30,0.35)' : 'rgba(255,255,255,0.10)'}`,
    }}>{children}</div>
  );
}

const btn = {
  height: 30, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)',
  color: '#FFF', fontSize: 12.5, fontWeight: 600, fontFamily: font,
};
