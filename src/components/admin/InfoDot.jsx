// ─── InfoDot.jsx ─────────────────────────────────────────────────────────────
// The ⓘ that explains one thing, wherever that thing is read.
//
// The owner made this a STANDING RULE on 2026-08-18: every field and every line
// in the control panel carries an explanation, and every tab carries a
// description. FormField already did it for form inputs; this is the same
// affordance for anything that is not a form — a status line, a number, a
// button whose consequences are not obvious.
//
// Extracted rather than copied so the next tab gets it for free. A rule that
// requires remembering to re-implement it is a rule that lapses.
//
// TWO DELIBERATE CHOICES, both learned from the version inside FormField:
//   · position:absolute — the panel is lifted out of the layout, so opening it
//     cannot move a single element. A tooltip that reflows the page makes you
//     lose your place, and on a status screen you are usually mid-scan.
//   · NO onClick — hover and keyboard focus only. With nothing to toggle, a
//     stray click cannot leave a panel stuck open over the thing you wanted.

import React, { useState } from 'react';

export default function InfoDot({ label, text, width = 300 }) {
  const [show, setShow] = useState(false);
  if (!text) return null;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <button
        type="button"
        aria-label={`What ${label} means`}
        aria-expanded={show}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        tabIndex={0}
        style={{
          width: 15, height: 15, borderRadius: '50%', flex: 'none', padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${show ? 'var(--crm-blue)' : 'var(--crm-w28)'}`,
          background: show ? 'var(--crm-blue-bg)' : 'transparent',
          color: show ? 'var(--crm-blue)' : 'var(--crm-w55)',
          fontSize: 10, fontWeight: 700, cursor: 'help',
          fontFamily: 'inherit', lineHeight: 1,
        }}
      >i</button>

      {show && (
        <span role="tooltip" style={{
          position: 'absolute',
          top: 'calc(100% + 7px)',
          left: -6,
          zIndex: 60,
          width,
          padding: '9px 11px',
          borderRadius: 9,
          background: 'var(--crm-tooltip-bg)',
          border: '1px solid var(--crm-w16)',
          boxShadow: '0 8px 24px var(--crm-shadow)',
          color: 'var(--crm-w80)',
          fontSize: 12,
          lineHeight: 1.55,
          fontWeight: 400,
          textTransform: 'none',
          letterSpacing: 0,
          whiteSpace: 'normal',
          textAlign: 'left',
        }}>{text}</span>
      )}
    </span>
  );
}
