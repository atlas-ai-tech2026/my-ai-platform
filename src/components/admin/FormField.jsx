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
// Three things every field can now show:
//
//   *  a red asterisk when the field is required
//   ⓘ  a button that explains, in plain words, exactly what to put in the box
//   ▸  a red border and a message when a required box was left empty
//
// The invalid state is only ever shown AFTER a submit attempt (`showErrors`).
// Painting a form red before the admin has typed anything is nagging, not help.

import React, { useState } from 'react';

export const REQUIRED_MESSAGE = 'You must fill this';

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
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div style={{ ...style, position: 'relative' }}>
      {label && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3,
          color: invalid ? '#f87171' : 'rgba(255,255,255,0.45)',
          fontSize: 11.5, fontWeight: invalid ? 600 : 400,
        }}>
          <span>{label}</span>
          {required && (
            // aria-hidden: the asterisk is decoration. Screen readers are told
            // by aria-required on the control itself, which the caller sets.
            <span aria-hidden="true" title="Required" style={{ color: '#f87171', fontWeight: 700 }}>*</span>
          )}
          {info && (
            <button
              type="button"
              aria-label={`What to put in ${label}`}
              aria-expanded={showInfo}
              onClick={() => setShowInfo((v) => !v)}
              style={{
                width: 15, height: 15, borderRadius: '50%', flex: 'none', padding: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${showInfo ? '#60a5fa' : 'rgba(255,255,255,0.28)'}`,
                background: showInfo ? 'rgba(96,165,250,0.18)' : 'transparent',
                color: showInfo ? '#93c5fd' : 'rgba(255,255,255,0.55)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit', lineHeight: 1,
              }}
            >i</button>
          )}
        </label>
      )}

      {showInfo && info && (
        <div role="note" style={{
          margin: '0 0 6px', padding: '8px 11px', borderRadius: 9, maxWidth: 460,
          background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.35)',
          color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 1.45, fontWeight: 400,
        }}>{info}</div>
      )}

      {children}

      {invalid && (
        <div role="alert" style={{
          marginTop: 4, color: '#f87171', fontSize: 11.5, fontWeight: 600,
        }}>{message || REQUIRED_MESSAGE}</div>
      )}

      {hint && !invalid && (
        <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{hint}</div>
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
    background: invalid ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${invalid ? '#f87171' : 'rgba(255,255,255,0.12)'}`,
    color: '#fff',
    outline: 'none',
    colorScheme: 'dark',
    ...extra,
  };
}

/**
 * Summary line under a form: "3 required boxes are empty".
 * Counting is the caller's job; this only phrases it.
 */
export function MissingSummary({ count, extra = [] }) {
  if (!count && !extra.length) return null;
  return (
    <div role="alert" style={{
      padding: '9px 13px', borderRadius: 10, fontSize: 12.5, marginTop: 4,
      background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.45)',
      color: '#fca5a5', fontWeight: 600,
    }}>
      {count > 0 && (
        <>Fill the {count} box{count === 1 ? '' : 'es'} marked in red{extra.length ? ' — also: ' : '.'}</>
      )}
      {extra.join(' · ')}
    </div>
  );
}
