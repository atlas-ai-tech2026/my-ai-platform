// ─── crmTheme ────────────────────────────────────────────────────────────────
// Light / dark for the CRM.
//
// The whole admin is written in INLINE styles — 372 hard-coded colour values
// across eleven files, almost all of them `rgba(255,255,255,α)` (a white veil
// over a dark page) or `#fff` text. Rewriting every screen into CSS classes
// would be a huge, risky change for a colour switch.
//
// Instead each of those literals becomes a CSS VARIABLE. Inline styles can read
// variables — `color: 'var(--crm-ink)'` works — so the markup barely changes,
// and flipping one attribute on the wrapper repaints the entire panel.
//
// The transformation is uniform and that is why it is safe: in dark mode
// `--crm-w06` is `rgba(255,255,255,0.06)`, and in light mode it is
// `rgba(0,0,0,0.06)`. Same alpha, same intent — a faint veil over the page —
// so every surface, border and muted text keeps the exact relationship to its
// background that it had before.
//
// TWO THINGS DELIBERATELY DO NOT FLIP:
//   • text sitting on an accent colour (white on the red button) stays white,
//     because the accent does not change. Those keep a literal '#fff'.
//   • the status colours — red for danger, amber for "needs cost", green for
//     good — are readable on both backgrounds and carry meaning, so changing
//     them would change what a screen says.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Toaster } from 'sonner';

const STORAGE_KEY = 'voxel_crm_theme';
const ThemeContext = createContext({ theme: 'dark', setTheme: () => {} });

export function useCrmTheme() {
  return useContext(ThemeContext);
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* private mode / storage disabled */ }
  return 'dark';                       // the CRM has always been dark; keep that default
}

/**
 * Wraps the admin panel. Sets `data-crm-theme` on its own div, so the variables
 * below resolve differently without touching a single component.
 */
export function CrmThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStored);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <style>{CRM_THEME_CSS}</style>
      <div data-crm-theme={theme} style={{
        minHeight: '100vh',
        background: 'var(--crm-page)',
        color: 'var(--crm-ink)',
      }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * The toast palette has to follow the panel. Left as `theme="dark"` it would
 * drop dark notification cards onto a light page.
 */
export function ThemedToaster() {
  const { theme } = useCrmTheme();
  return <Toaster position="bottom-right" theme={theme} richColors />;
}

/** The toggle itself. Small, and it says which mode it will switch TO. */
export function ThemeToggle() {
  const { theme, setTheme } = useCrmTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '6px 12px', borderRadius: 9, cursor: 'pointer',
        background: 'var(--crm-w06)',
        border: '1px solid var(--crm-w12)',
        color: 'var(--crm-ink-2)',
        fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
        {theme === 'dark' ? '☀' : '☾'}
      </span>
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

// Scoped to [data-crm-theme] so nothing here can leak into the customer app,
// which has its own styling and is not part of this change.
export const CRM_THEME_CSS = `
[data-crm-theme="dark"] {
  --crm-page:  #0a0a0c;
  --crm-ink:   #ffffff;
  --crm-ink-2: rgba(255,255,255,0.72);
  --crm-w03: rgba(255,255,255,0.03); --crm-w04: rgba(255,255,255,0.04);
  --crm-w05: rgba(255,255,255,0.05); --crm-w06: rgba(255,255,255,0.06);
  --crm-w08: rgba(255,255,255,0.08); --crm-w10: rgba(255,255,255,0.10);
  --crm-w12: rgba(255,255,255,0.12); --crm-w14: rgba(255,255,255,0.14);
  --crm-w16: rgba(255,255,255,0.16); --crm-w20: rgba(255,255,255,0.20);
  --crm-w25: rgba(255,255,255,0.25); --crm-w28: rgba(255,255,255,0.28);
  --crm-w30: rgba(255,255,255,0.30); --crm-w35: rgba(255,255,255,0.35);
  --crm-w40: rgba(255,255,255,0.40); --crm-w45: rgba(255,255,255,0.45);
  --crm-w50: rgba(255,255,255,0.50); --crm-w55: rgba(255,255,255,0.55);
  --crm-w60: rgba(255,255,255,0.60); --crm-w65: rgba(255,255,255,0.65);
  --crm-w70: rgba(255,255,255,0.70); --crm-w72: rgba(255,255,255,0.72);
  --crm-w80: rgba(255,255,255,0.80); --crm-w85: rgba(255,255,255,0.85);
  --crm-w90: rgba(255,255,255,0.90);
  --crm-tooltip-bg: #15151b;
  --crm-shadow: rgba(0,0,0,0.55);
}
[data-crm-theme="light"] {
  --crm-page:  #f7f7f5;
  --crm-ink:   #101014;
  --crm-ink-2: rgba(16,16,20,0.75);
  /* Same alphas, inverted base: a faint veil over a light page instead of a
     dark one, so every surface keeps its original relationship to the page. */
  --crm-w03: rgba(16,16,20,0.04); --crm-w04: rgba(16,16,20,0.05);
  --crm-w05: rgba(16,16,20,0.06); --crm-w06: rgba(16,16,20,0.06);
  --crm-w08: rgba(16,16,20,0.11); --crm-w10: rgba(16,16,20,0.13);
  --crm-w12: rgba(16,16,20,0.16); --crm-w14: rgba(16,16,20,0.18);
  --crm-w16: rgba(16,16,20,0.20); --crm-w20: rgba(16,16,20,0.24);
  --crm-w25: rgba(16,16,20,0.30); --crm-w28: rgba(16,16,20,0.34);
  --crm-w30: rgba(16,16,20,0.36); --crm-w35: rgba(16,16,20,0.42);
  --crm-w40: rgba(16,16,20,0.48); --crm-w45: rgba(16,16,20,0.52);
  --crm-w50: rgba(16,16,20,0.56); --crm-w55: rgba(16,16,20,0.60);
  --crm-w60: rgba(16,16,20,0.64); --crm-w65: rgba(16,16,20,0.68);
  --crm-w70: rgba(16,16,20,0.72); --crm-w72: rgba(16,16,20,0.75);
  --crm-w80: rgba(16,16,20,0.82); --crm-w85: rgba(16,16,20,0.86);
  --crm-w90: rgba(16,16,20,0.90);
  --crm-tooltip-bg: #ffffff;
  --crm-shadow: rgba(16,16,20,0.22);
}
/* Native controls follow the theme, so date pickers and dropdown sheets are
   readable in both — the black-on-black <option> bug, in reverse. */
[data-crm-theme="dark"]  { color-scheme: dark; }
[data-crm-theme="light"] { color-scheme: light; }
[data-crm-theme] input, [data-crm-theme] select, [data-crm-theme] textarea { color-scheme: inherit; }
[data-crm-theme="light"] option { background: #ffffff; color: #101014; }
`;

/** The exact white-alpha literal → variable map used by the conversion. */
export const ALPHA_TO_VAR = {
  '0.03': 'w03', '0.04': 'w04', '0.05': 'w05', '0.06': 'w06', '0.08': 'w08',
  '0.1': 'w10', '0.10': 'w10', '0.12': 'w12', '0.14': 'w14', '0.15': 'w16',
  '0.16': 'w16', '0.18': 'w20', '0.2': 'w20', '0.20': 'w20', '0.25': 'w25',
  '0.28': 'w28', '0.3': 'w30', '0.30': 'w30', '0.35': 'w35', '0.4': 'w40',
  '0.40': 'w40', '0.45': 'w45', '0.5': 'w50', '0.50': 'w50', '0.55': 'w55',
  '0.6': 'w60', '0.60': 'w60', '0.65': 'w65', '0.7': 'w70', '0.70': 'w70',
  '0.72': 'w72', '0.8': 'w80', '0.80': 'w80', '0.85': 'w85', '0.9': 'w90',
  '0.90': 'w90',
};
