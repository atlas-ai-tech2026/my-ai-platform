// ─── every-tab-renders.test.jsx ──────────────────────────────────────────────
// EVERY TAB IN THE LIST MUST ACTUALLY RENDER SOMETHING.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The single most repeated failure on this project is not a broken function.
// It is a thing that was BUILT AND CANNOT BE REACHED: five admin endpoints
// with no button, a model dropdown registered as GET on a route the app only
// POSTs, a control-panel card describing thumbnails that did not exist. Six in
// one day, at last count, and every one of them was found by Amr rather than
// by a test.
//
// The control panel is where that keeps happening, because adding a tab is two
// edits in two places — the TABS list and the render switch — and forgetting
// the second produces a tab that is visible, clickable, and blank. Nothing in
// the codebase noticed.
//
// This reads the real file and checks the two lists agree. It is deliberately
// about the WIRING rather than any one tab, so it protects the next tab too.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PANEL = path.join(ROOT, 'src/pages/AdminPanel.jsx');
const SRC = fs.readFileSync(PANEL, 'utf8');

/** Every `{ id: 'x', label: 'Y'` in the TABS array. */
const declared = [...SRC.matchAll(/\{\s*id:\s*'([a-z-]+)',\s*label:/g)].map((m) => m[1]);
/** Every `tab === 'x'` render branch. */
const rendered = new Set([...SRC.matchAll(/tab === '([a-z-]+)'/g)].map((m) => m[1]));

describe('☠ NOTHING IS BUILT AND UNREACHABLE', () => {
  it('finds the tab list at all — if this fails the rest proves nothing', () => {
    // A regex that silently matches zero things would make every test below
    // pass vacuously, which is worse than no test.
    expect(declared.length).toBeGreaterThan(15);
    expect(rendered.size).toBeGreaterThan(15);
  });

  it.each(declared.map((id) => [id]))('the "%s" tab has something to render', (id) => {
    expect(rendered.has(id),
      `TABS lists "${id}" but AdminPanel has no \`tab === '${id}'\` branch — `
      + 'it will be clickable and blank').toBe(true);
  });

  it('and nothing renders for a tab nobody can select', () => {
    // The mirror image: a render branch with no entry in TABS is a screen that
    // exists and cannot be reached, which is the same bug facing the other way.
    const orphans = [...rendered].filter((id) => !declared.includes(id));
    expect(orphans, `these render but are not in TABS: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('every tab explains itself — standing rule, 2026-08', () => {
  it('has a description, and not a token one', () => {
    // "Every tab gets a description" is a rule Amr set because a control panel
    // nobody can read is a control panel nobody uses. A one-word desc passes
    // the letter of it and fails the point, so there is a length floor.
    const withDesc = [...SRC.matchAll(/\{\s*id:\s*'([a-z-]+)',\s*label:\s*'[^']*',\s*\n?\s*desc:\s*'((?:[^'\\]|\\.)*)'/g)];
    const byId = new Map(withDesc.map((m) => [m[1], m[2]]));
    const missing = declared.filter((id) => !byId.has(id) || byId.get(id).length < 60);
    expect(missing, `these need a real description: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('the speech lab specifically', () => {
  it('is in the list and wired up', () => {
    expect(declared).toContain('speech');
    expect(rendered.has('speech')).toBe(true);
  });

  it('is lazy, so 540 KB of ONNX runtime does not load with the panel', () => {
    // Every other screen in the control panel would otherwise pay for it on
    // first open — including Alerts, which is the one opened in a hurry.
    expect(SRC).toMatch(/lazy\(\(\) => import\('@\/components\/admin\/SpeechLabTab'\)\)/);
    expect(SRC).not.toMatch(/^import SpeechLabTab from/m);
  });
});
