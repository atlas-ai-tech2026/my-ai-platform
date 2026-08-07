// ─── FormField ───────────────────────────────────────────────────────────────
// One field component for the whole CRM, so "required" and "you missed this"
// look and behave identically on every screen.
//
// Before this existed the admin had ELEVEN separate copies of the input style
// and four different label helpers, and five screens (Promo, Gift Cards, Logs,
// Usage, Security) had no labels at all — only placeholders. A placeholder
// disappears the moment you type, so on those screens there was nowhere to
// hang a required marker and nothing to remind you what a box was for.
//
// Three things every field can show:
//
//   *  a red asterisk when the field is required
//   ⓘ  a floating description of exactly what to put in the box
//   ▸  a red border and a message when a required box was left empty
//
// ── THE ⓘ MUST NOT MOVE ANYTHING ─────────────────────────────────────────────
// The first version rendered the description as a normal block inside the
// field, so opening it pushed every neighbouring box down and sideways. The
// owner reported that immediately, and they were right: a form that rearranges
// itself while you read it is worse than one with no help at all.
//
// It is now absolutely positioned and painted ABOVE the form (z-index), so it
// occupies no space in the layout and nothing shifts. It opens on hover and
// closes when the pointer leaves; click still pins it open for touch screens
// and keyboards, where there is no hover.
//
// ── AND THE BOXES MUST LINE UP ───────────────────────────────────────────────
// Every label row is a FIXED height. Without that, a field whose label wraps to
// two lines starts its input lower than its neighbours, and a row of boxes
// looks visibly ragged. Fixed label height means every input in a row starts on
// the same line regardless of how long its label is.

import React, { useState } from 'react';

export const REQUIRED_MESSAGE = 'You must fill this';

/** Height of the label row. Every input therefore starts at the same y. */
const LABEL_ROW_HEIGHT = 18;

/**
 * @param label      the field's name, always visible (never placeholder-only)
 * @param required   adds the red asterisk and enables the empty check
 * @param invalid    true → red border + message. Caller decides when.
 * @param message    overrides the default "You must fill this"
 * @param info       the ⓘ description: what to put in this box, and why
 * @param hint       always-visible small print under the field
 */
export default function Field({
  label, required = false, invalid = false, message, info, hint, children, style,
}) {
  // HOVER ONLY. An earlier version let a click PIN the panel open, and the
  // owner hit the obvious consequence: pinned panels do not close when you look
  // away, so three or four could sit open at once. A description is a hover
  // affordance — point at it, read it, move on. Keyboard focus opens it too and
  // blur closes it, so it stays reachable without a pointer, and because focus
  // can only be in one place there is still never more than one open.
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div style={{ ...style, position: 'relative' }}>
      {label && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 5,
          // Fixed height, not margin: this is what keeps a row of boxes aligned
          // when one label is longer than another and wraps.
          height: LABEL_ROW_HEIGHT,
          lineHeight: `${LABEL_ROW_HEIGHT}px`,
          color: invalid ? 'var(--crm-red)' : 'var(--crm-w45)',
          fontSize: 11.5, fontWeight: invalid ? 600 : 400,
          // nowrap keeps the row aligned: a label that wrapped to two lines
          // would start its input lower than its neighbours'. Deliberately NOT
          // clipped — a field is simply as wide as its label needs, because a
          // truncated label ("Marketing notifications per client per d…") is a
          // worse problem than a slightly wider box.
          whiteSpace: 'nowrap',
        }}>
          <span>{label}</span>
          {required && (
            // aria-hidden: the asterisk is decoration. Screen readers are told
            // by aria-required on the control itself, which the caller sets.
            <span aria-hidden="true" title="Required" style={{ color: 'var(--crm-red)', fontWeight: 700 }}>*</span>
          )}
          {info && (
            <span
              style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
            >
              <button
                type="button"
                aria-label={`What to put in ${label}`}
                aria-expanded={showInfo}
                onFocus={() => setShowInfo(true)}
                onBlur={() => setShowInfo(false)}
                // No onClick: nothing to toggle, so a stray click cannot leave
                // a panel stuck open.
                tabIndex={0}
                style={{
                  width: 15, height: 15, borderRadius: '50%', flex: 'none', padding: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${showInfo ? 'var(--crm-blue)' : 'var(--crm-w28)'}`,
                  background: showInfo ? 'var(--crm-blue-bg)' : 'transparent',
                  color: showInfo ? 'var(--crm-blue)' : 'var(--crm-w55)',
                  fontSize: 10, fontWeight: 700, cursor: 'help',
                  fontFamily: 'inherit', lineHeight: 1,
                }}
              >i</button>

              {showInfo && (
                // position:absolute — this is the whole point. The panel is
                // lifted out of the layout, so opening it cannot move a single
                // box. It is anchored to the ⓘ and painted over the form.
                <span role="tooltip" style={{
                  position: 'absolute',
                  top: 'calc(100% + 7px)',
                  left: -6,
                  zIndex: 60,
                  width: 290,
                  maxWidth: '80vw',
                  padding: '9px 12px',
                  borderRadius: 9,
                  background: 'var(--crm-tooltip-bg)',
                  border: '1px solid var(--crm-blue-br)',
                  boxShadow: '0 10px 30px var(--crm-shadow)',
                  color: 'var(--crm-w85)',
                  fontSize: 12, lineHeight: 1.5, fontWeight: 400,
                  whiteSpace: 'normal',      // the label row is nowrap; this is not
                  textAlign: 'left',
                  pointerEvents: 'none',     // never blocks the box underneath
                }}>
                  {/* little arrow pointing back at the ⓘ */}
                  <span aria-hidden="true" style={{
                    position: 'absolute', top: -5, left: 9, width: 8, height: 8,
                    background: 'var(--crm-tooltip-bg)',
                    borderLeft: '1px solid var(--crm-blue-br)',
                    borderTop: '1px solid var(--crm-blue-br)',
                    transform: 'rotate(45deg)',
                  }} />
                  {info}
                </span>
              )}
            </span>
          )}
        </label>
      )}

      {children}

      {/* The error DOES take space — it is part of the field and the admin has
          to see it. It only ever appears after a submit attempt, and because
          each field is its own flex item, one field growing cannot shove its
          neighbours sideways. */}
      {invalid && (
        <div role="alert" style={{
          marginTop: 4, color: 'var(--crm-red)', fontSize: 11.5, fontWeight: 600,
          maxWidth: 260, lineHeight: 1.35,
        }}>{message || REQUIRED_MESSAGE}</div>
      )}

      {hint && !invalid && (
        <div style={{ marginTop: 4, color: 'var(--crm-w40)', fontSize: 11 }}>{hint}</div>
      )}
    </div>
  );
}

/**
 * The CRM's input styling, with the invalid state built in — so a red border
 * can never drift out of step with the red label beside it.
 */
export function adminInput(invalid = false, extra = {}) {
  return {
    height: 34,
    padding: '0 10px',
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    background: invalid ? 'var(--crm-red-bg)' : 'var(--crm-w04)',
    border: `1px solid ${invalid ? 'var(--crm-red)' : 'var(--crm-w12)'}`,
    color: 'var(--crm-ink)',
    outline: 'none',
    colorScheme: 'dark',
    boxSizing: 'border-box',
    ...extra,
  };
}

/**
 * A row of fields that line up. Use instead of a bare flex div so every form
 * on every screen has the same gaps and the same baseline.
 */
export function FieldRow({ children, style }) {
  return (
    <div style={{
      display: 'flex',
      gap: 14,
      flexWrap: 'wrap',
      // flex-start, not center or baseline: a field showing an error grows
      // downward, and the others must stay exactly where they were.
      alignItems: 'flex-start',
      ...style,
    }}>{children}</div>
  );
}

/** Aligns a button with the inputs beside it, allowing for the label row. */
export const buttonRowOffset = { marginTop: LABEL_ROW_HEIGHT + 3 };

/**
 * Summary line under a form: "3 required boxes are empty".
 * Counting is the caller's job; this only phrases it.
 */
export function MissingSummary({ count, extra = [] }) {
  if (!count && !extra.length) return null;
  return (
    <div role="alert" style={{
      padding: '9px 13px', borderRadius: 10, fontSize: 12.5, marginTop: 10,
      background: 'var(--crm-red-bg)', border: '1px solid var(--crm-red-br)',
      color: 'var(--crm-red)', fontWeight: 600,
    }}>
      {count > 0 && (
        <>Fill the {count} box{count === 1 ? '' : 'es'} marked in red{extra.length ? ' — also: ' : '.'}</>
      )}
      {extra.join(' · ')}
    </div>
  );
}
