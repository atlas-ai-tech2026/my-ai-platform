// ─── DropZone ────────────────────────────────────────────────────────────────
// Drag a file anywhere onto a panel and it uploads.
//
// Amr, 2026-09-05: "I need drag and drop on the prompt box of the images and
// videos and node — the same one you use on Edit Cut, but on production."
//
// Measured the same day: real drop handling existed in exactly three places —
// the Edit Cut screens (dev only), the Node canvas (ONE file at a time) and the
// admin Projects tab. Every generation surface had a button and nothing else.
//
// ── WHY THIS IS A COMPONENT AND NOT SIX COPIES ─────────────────────────────
// Six copies is six chances for one of them to swallow a rejected file, or to
// forget dragLeave and stay highlighted forever, or to accept a 90 MB video
// where only images belong. The version in edit/UploadsPanel.jsx already had
// the shape right; this is that shape, extracted, so the next surface inherits
// the fixes instead of repeating the bugs.
//
// ── THE ONE RULE IT ENFORCES ───────────────────────────────────────────────
// ☠ A REJECTED FILE IS NEVER SWALLOWED. Drop five pictures and a PDF into the
// prompt box and something must say which one was refused and why. Silence is
// how the reference-image bug reached Amr in the first place: the upload failed
// and the thumbnail simply disappeared.

import React, { useCallback, useRef, useState } from 'react';

/** Does this file match an accept string like "image/png,image/jpeg" or "image/*"? */
export function fileMatches(file, accept) {
  if (!accept) return true;
  const type = String(file?.type || '').toLowerCase();
  return accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((rule) => {
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/**
 * Split a dropped FileList into what we can take and what we cannot, with a
 * reason for each refusal. Exported so the sorting is testable without a DOM.
 */
export function sortFiles(fileList, { accept, maxBytes } = {}) {
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(fileList || [])) {
    if (!fileMatches(file, accept)) {
      rejected.push({ file, reason: `${file.name} is not a supported file type` });
      continue;
    }
    if (maxBytes && file.size > maxBytes) {
      rejected.push({ file, reason: `${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB` });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

/**
 * Wrap anything in a drop target.
 *
 * @param onFiles     (File[]) => void  — called with the files that passed
 * @param onRejected  (string[]) => void — reasons, one per refused file
 * @param accept      same syntax as an <input accept>
 * @param multiple    false keeps only the first accepted file
 * @param disabled    ignore drops entirely
 */
export default function DropZone({
  children, onFiles, onRejected, accept, maxBytes, multiple = true,
  disabled = false, style, className, label,
}) {
  const [dragging, setDragging] = useState(false);
  // A drag entering a CHILD element fires dragleave on the parent, so a naive
  // boolean flickers and can stick "on" after the pointer has gone. Counting
  // enter/leave pairs is the fix every drop zone eventually needs.
  const depth = useRef(0);

  const reset = useCallback(() => { depth.current = 0; setDragging(false); }, []);

  const onDragEnter = useCallback((e) => {
    if (disabled) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, [disabled]);

  const onDragLeave = useCallback((e) => {
    if (disabled) return;
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, [disabled]);

  const onDragOver = useCallback((e) => {
    if (disabled) return;
    e.preventDefault();
    // Without this the browser shows a "move" cursor and then navigates away
    // to the file when it is dropped — losing whatever was on the page.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, [disabled]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    reset();
    if (disabled) return;
    const { accepted, rejected } = sortFiles(e.dataTransfer?.files, { accept, maxBytes });
    // Never swallowed — see the header.
    if (rejected.length) onRejected?.(rejected.map((r) => r.reason));
    if (accepted.length) onFiles?.(multiple ? accepted : accepted.slice(0, 1));
  }, [disabled, accept, maxBytes, multiple, onFiles, onRejected, reset]);

  return (
    <div
      data-testid="dropzone"
      data-dragging={dragging ? 'true' : 'false'}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={className}
      style={{ position: 'relative', ...style }}
    >
      {children}
      {dragging && !disabled && (
        <div
          style={{
            position: 'absolute', inset: 0, borderRadius: 14, zIndex: 30,
            border: '2px dashed var(--crm-orange, #FF5C35)',
            background: 'rgba(255,92,53,0.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', fontSize: 13, fontWeight: 600,
            color: 'var(--crm-orange, #FF5C35)', textAlign: 'center', padding: 12,
          }}
        >
          {label || 'Drop to attach'}
        </div>
      )}
    </div>
  );
}
