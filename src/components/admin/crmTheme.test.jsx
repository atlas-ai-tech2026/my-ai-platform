// ─── crmTheme.test.jsx ───────────────────────────────────────────────────────
// Light/dark for the CRM works by turning 372 hard-coded colour literals into
// CSS variables, so the risks are specific:
//
//   1. A literal that got MISSED stays dark on a light page — an invisible
//      white-on-white label, or a black block in the middle of a light screen.
//      The sweep test below reads the real component files and fails on any
//      surviving `rgba(255,255,255,…)`.
//   2. A literal that should NOT have flipped — white text on the red button —
//      would turn black on red.
//   3. Every variable a component uses must actually be defined, or the colour
//      silently falls back to nothing.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrmThemeProvider, ThemeToggle, CRM_THEME_CSS, useCrmTheme } from './crmTheme';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../../..');
const FILES = [
  ...fs.readdirSync(DIR).filter((f) => f.endsWith('.jsx') && !f.includes('.test.') && f !== 'crmTheme.jsx')
    .map((f) => path.join(DIR, f)),
  path.join(ROOT, 'src/pages/AdminPanel.jsx'),
];

describe('the conversion left nothing behind', () => {
  it('finds the CRM files to check', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  // A missed literal is a dark smear on a light page.
  it.each(FILES.map((f) => [path.basename(f), f]))(
    '%s has no hard-coded white left', (_name, file) => {
      const src = fs.readFileSync(file, 'utf8');
      const leftovers = [...src.matchAll(/rgba\(255,\s*255,\s*255,[^)]*\)/g)].map((m) => m[0]);
      expect(leftovers, `these will not follow the theme: ${leftovers.join(', ')}`).toEqual([]);
    });

  // The opposite mistake: white text on the red accent must STAY white,
  // because the accent colour does not change between themes.
  it('keeps #fff where it sits on an accent colour', () => {
    const src = FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const whites = src.split('\n').filter((l) => /'#fff'/.test(l));
    expect(whites.length).toBeGreaterThan(0);
    for (const line of whites) {
      expect(line, `#fff not on an accent background: ${line.trim()}`)
        .toMatch(/gradient|#e0442c|#CC0000|#FF2222|#E01E1E|--crm-tooltip-bg/);
    }
  });

  // A var() with no definition renders as no colour at all.
  it('defines every --crm- variable the components use', () => {
    const src = FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const used = new Set([...src.matchAll(/var\((--crm-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const defined = new Set([...CRM_THEME_CSS.matchAll(/(--crm-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !defined.has(v));
    expect(missing, `used but never defined: ${missing.join(', ')}`).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });
});

describe('the two palettes', () => {
  const varsFor = (mode) => {
    const block = CRM_THEME_CSS.split(`[data-crm-theme="${mode}"] {`)[1].split('}')[0];
    return Object.fromEntries([...block.matchAll(/(--crm-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
      .map((m) => [m[1], m[2].trim()]));
  };

  it('defines the same variables in both, so nothing is undefined in one mode', () => {
    const d = Object.keys(varsFor('dark')).sort();
    const l = Object.keys(varsFor('light')).sort();
    expect(l).toEqual(d);
  });

  it('actually inverts — every veil colour differs between the modes', () => {
    const d = varsFor('dark'), l = varsFor('light');
    for (const k of Object.keys(d)) {
      expect(l[k], `${k} is identical in both themes`).not.toBe(d[k]);
    }
  });

  it('flips the page and the ink', () => {
    expect(varsFor('dark')['--crm-page']).toBe('#0a0a0c');
    expect(varsFor('light')['--crm-page']).toBe('#f7f7f5');
    expect(varsFor('dark')['--crm-ink']).toBe('#ffffff');
    expect(varsFor('light')['--crm-ink']).toBe('#101014');
  });

  // The native <option> sheet is painted by the OS; getting this wrong is how
  // the dropdowns were black-on-black in the first place.
  it('sets color-scheme for both, so date pickers and dropdowns follow', () => {
    expect(CRM_THEME_CSS).toMatch(/\[data-crm-theme="dark"\]\s*{\s*color-scheme:\s*dark/);
    expect(CRM_THEME_CSS).toMatch(/\[data-crm-theme="light"\]\s*{\s*color-scheme:\s*light/);
  });

  // Scoped to the attribute so it cannot bleed into the customer-facing app.
  it('is scoped to the CRM and cannot leak into the customer app', () => {
    expect(CRM_THEME_CSS).not.toMatch(/^\s*:root\s*{/m);
    expect(CRM_THEME_CSS).not.toMatch(/^\s*body\s*{/m);
  });
});

describe('the toggle', () => {
  const Probe = () => <span data-testid="mode">{useCrmTheme().theme}</span>;

  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('starts dark, because the CRM has always been dark', () => {
    render(<CrmThemeProvider><Probe /></CrmThemeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('switches to light and back', async () => {
    const user = userEvent.setup();
    render(<CrmThemeProvider><ThemeToggle /><Probe /></CrmThemeProvider>);

    await user.click(screen.getByRole('button', { name: /Switch to light mode/i }));
    expect(screen.getByTestId('mode')).toHaveTextContent('light');

    await user.click(screen.getByRole('button', { name: /Switch to dark mode/i }));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('sets data-crm-theme, which is what repaints everything', async () => {
    const user = userEvent.setup();
    const { container } = render(<CrmThemeProvider><ThemeToggle /></CrmThemeProvider>);
    const panel = container.querySelector('[data-crm-theme]');
    expect(panel).toHaveAttribute('data-crm-theme', 'dark');
    await user.click(screen.getByRole('button', { name: /Switch to light/i }));
    expect(panel).toHaveAttribute('data-crm-theme', 'light');
  });

  it('remembers the choice for next time', async () => {
    const user = userEvent.setup();
    render(<CrmThemeProvider><ThemeToggle /></CrmThemeProvider>);
    await user.click(screen.getByRole('button', { name: /Switch to light/i }));
    expect(localStorage.getItem('voxel_crm_theme')).toBe('light');
  });

  it('survives storage being unavailable rather than crashing the panel', () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    expect(() => render(<CrmThemeProvider><Probe /></CrmThemeProvider>)).not.toThrow();
    if (orig) Object.defineProperty(window, 'localStorage', orig);
  });
});
