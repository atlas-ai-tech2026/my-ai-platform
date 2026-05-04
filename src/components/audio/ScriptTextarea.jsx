// Script textarea for the Audio page Voice Canvas. Supports a single
// "currently emphasised" word that the user toggles by selecting it
// (double-click or shift-arrow). Renders a transparent ghost overlay
// above the real <textarea> so the highlight box appears in place
// without losing typing affordances.
//
// SSML emphasis for v1 is purely visual — we don't ship the highlight
// to the TTS endpoint yet. Once we wire SSML, the highlighted span
// becomes the <emphasis> tag in the request body.
import React, { useRef, useMemo } from 'react';

const RED = '#E01E1E';

const SHARED_TEXT_STYLE = {
  fontSize: 13.5,
  lineHeight: 1.65,
  fontFamily: '"DM Sans", sans-serif',
  color: '#FFF',
  padding: 14,
  boxSizing: 'border-box',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
};

export default function ScriptTextarea({ value, onChange, highlighted, onHighlightChange }) {
  const taRef = useRef(null);

  // When the user double-clicks (browser auto-selects the word) we read
  // the selection to identify which word got highlighted. Single-click
  // selecting via shift-arrow / drag also works.
  const handleSelect = () => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const word = value.slice(start, end).trim();
    if (!word || /\s/.test(word)) return;
    onHighlightChange?.(word);
  };

  const segments = useMemo(() => {
    if (!highlighted) return [{ text: value, hi: false }];
    const out = [];
    const re = new RegExp(`(${highlighted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    let last = 0;
    let match;
    while ((match = re.exec(value)) !== null) {
      if (match.index > last) out.push({ text: value.slice(last, match.index), hi: false });
      out.push({ text: match[0], hi: true });
      last = match.index + match[0].length;
    }
    if (last < value.length) out.push({ text: value.slice(last), hi: false });
    return out;
  }, [value, highlighted]);

  return (
    <div style={{
      position: 'relative',
      flex: 1, minHeight: 200,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Ghost layer (visual highlight). Pointer-events off so the
          textarea below catches all input. */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          ...SHARED_TEXT_STYLE,
          color: 'transparent',
          pointerEvents: 'none',
        }}
      >
        {segments.map((seg, i) => seg.hi ? (
          <span key={i} style={{
            background: 'rgba(224,30,30,0.25)',
            borderBottom: `2px solid ${RED}`,
            borderRadius: 3,
            padding: '0 2px',
          }}>{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        ))}
      </div>

      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        onSelect={handleSelect}
        spellCheck={false}
        style={{
          position: 'relative',
          width: '100%', height: '100%',
          minHeight: 200,
          background: 'transparent',
          border: 'none', outline: 'none', resize: 'none',
          caretColor: RED,
          ...SHARED_TEXT_STYLE,
        }}
      />
    </div>
  );
}
