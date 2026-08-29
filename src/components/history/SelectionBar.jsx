// ─── SelectionBar.jsx ────────────────────────────────────────────────────────
// Delete some pictures, and be able to change your mind.
//
// ── THE THREE THINGS THAT KEEP THIS SAFE ───────────────────────────────────
// 1. THE CONFIRMATION NAMES THE FILTER. "Delete 128 pictures?" does not say
//    which 128 — and if a filter was set and forgotten, that is exactly the
//    moment to be reminded of it.
// 2. THE UNDO IS THE REAL PROTECTION. A frightening dialog trains people to
//    click through it; an undo sitting right there afterwards catches the
//    mistake the dialog did not. It is not decoration, and it is not optional.
// 3. IT NEVER SAYS "DONE" WHEN IT IS NOT. Asking to delete 40 and getting 38
//    is stated, because the other two were already gone and the customer needs
//    to know that rather than assume.
//
// ── AND WHAT IT DOES NOT DO ────────────────────────────────────────────────
// It does not cover the screen. A modal over a grid of somebody's own work,
// with a red button in it, is the shape of interface that produces accidents —
// the question belongs in the flow, not on top of it.

import React, { useState } from 'react';
import { labels, confirmSentence, count } from '@/lib/history-selection';

const font = '"DM Sans", sans-serif';

export default function SelectionBar({
  selection, filter, total, loaded, recoveryDays = 30,
  onSelectAll, onClear, onDelete, busy = false, undo = null, onUndo, onDismissUndo,
}) {
  const [confirming, setConfirming] = useState(false);
  const l = labels(selection, { total, loaded });
  const n = count(selection);

  // The undo outlives the selection bar: it must still be there after
  // selecting has been switched off, which is when most people look for it.
  if (!selection.on && undo) {
    return <UndoBar undo={undo} onUndo={onUndo} onDismiss={onDismissUndo} busy={busy} />;
  }
  if (!selection.on) return null;

  return (
    <div style={{ padding: '0 28px 10px', fontFamily: font }}>
      {undo && <UndoBar undo={undo} onUndo={onUndo} onDismiss={onDismissUndo} busy={busy} />}

      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        padding: '9px 12px', borderRadius: 10,
        background: 'rgba(224,30,30,0.10)', border: '1px solid rgba(224,30,30,0.30)',
      }}>
        <span style={{ fontSize: 13, color: '#FFF' }}>{l.selected}</span>
        <button onClick={onSelectAll} disabled={busy} style={btn}>{l.selectAll}</button>
        {n > 0 && <button onClick={onClear} disabled={busy} style={btn}>Clear</button>}
        <button
          onClick={() => setConfirming(true)}
          disabled={!l.canDelete || busy}
          style={{ ...btn, marginLeft: 'auto', opacity: l.canDelete && !busy ? 1 : 0.45 }}
        >
          {busy ? 'Working…' : l.remove}
        </button>
      </div>

      {confirming && (
        <div style={{
          marginTop: 8, padding: '12px 14px', borderRadius: 10,
          background: 'rgba(224,30,30,0.14)', border: '1px solid rgba(224,30,30,0.45)',
        }}>
          <div style={{ fontSize: 13.5, color: '#FFF', lineHeight: 1.6 }}>
            {confirmSentence(n, filter, recoveryDays)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={() => { setConfirming(false); onDelete?.(); }}
              style={{ ...btn, background: '#E01E1E', borderColor: '#E01E1E', fontWeight: 700 }}
            >
              Yes, delete {n.toLocaleString()}
            </button>
            <button onClick={() => setConfirming(false)} style={btn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What happened, and one press to reverse it.
 *
 * Shown after the fact rather than instead of the confirmation — the two catch
 * different mistakes. The dialog catches "I did not mean to press that"; this
 * catches "I meant to press it and I was wrong".
 */
function UndoBar({ undo, onUndo, onDismiss, busy }) {
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      padding: '9px 12px', borderRadius: 10, marginBottom: 8, fontFamily: font,
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
    }}>
      <span style={{ fontSize: 13, color: '#FFF' }}>{undo.message}</span>
      {undo.canUndo && (
        <button onClick={onUndo} disabled={busy} style={btn}>
          {busy ? 'Restoring…' : 'Undo'}
        </button>
      )}
      <button onClick={onDismiss} disabled={busy} style={{ ...btn, marginLeft: 'auto' }}>
        Dismiss
      </button>
    </div>
  );
}

const btn = {
  height: 30, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)',
  color: '#FFF', fontSize: 12.5, fontWeight: 600, fontFamily: font,
};
