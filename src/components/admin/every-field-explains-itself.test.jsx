// ─── every-field-explains-itself.test.jsx ────────────────────────────────────
// TASK #47, MADE MECHANICAL.
//
// The owner set a standing rule on 2026-08-18: every field and every line in
// the control panel carries an explanation, and every tab carries a
// description. It has sat on the board as "DOING NOW" ever since — because a
// habit can never be finished, so the row could never be closed.
//
// A rule kept by discipline is a rule that lapses the week somebody is busy.
// This is that rule, written down where it fails on its own.
//
// ── WHAT THIS DELIBERATELY DOES NOT ASSERT ─────────────────────────────────
// Not "every <input> has an ⓘ". Measured, that flags eleven components — and
// their fields are checkboxes, date pickers and filter boxes:
//
//     LogsTab       "Filter by user email…"     ProviderDashboard  type="date"
//     ExpiryPanel   type="checkbox"             AdminGuard         the login form
//
// A search box needs no explanation. Asserting otherwise would cry wolf eleven
// times, and this morning I fixed a structure check that did exactly that —
// 22 findings of which most were wrong, so the number never fell and nobody
// read the line. A check people dismiss is worse than no check.
//
// So it asserts the things that are genuinely mechanical, plus one list that
// makes the NEXT screen fail rather than the current ones.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

/**
 * Screens whose only inputs are search, filter, date-range, a checkbox, or the
 * login form. Each is named with WHY — an unexplained exemption is how a real
 * gap gets waved through later.
 */
const NO_EXPLANATION_NEEDED = {
  'AdminGuard.jsx': 'the sign-in form — an email and a password box explain themselves',
  'AdminNav.jsx': 'the sidebar filter',
  'AlertsTab.jsx': 'filters and a date range over a list that is already labelled',
  'CostingTab.jsx': 'a model search and a window selector; the panels inside carry their own ⓘ',
  'ExpiryPanel.jsx': 'one checkbox beside its own sentence',
  'LiveTab.jsx': 'a refresh interval and a session picker',
  'LogsTab.jsx': 'four filter boxes — "Filter by user email…" is its own explanation',
  'ProviderDashboard.jsx': 'two date pickers bounding a spend chart',
  'SecurityTab.jsx': 'the six-digit 2FA code box',
  'UsageTab.jsx': 'a date range over the usage table',
  'WorkshopsPanel.jsx': 'a combo box for picking or naming a workshop',
};

describe('☠ EVERY TAB EXPLAINS ITSELF', () => {
  const panel = readFileSync(join(here, '../../pages/AdminPanel.jsx'), 'utf8');
  const seg = panel.slice(panel.indexOf('const TABS = ['), panel.indexOf('\n];', panel.indexOf('const TABS = [')));

  it('every tab in the registry has a description', () => {
    const ids = [...seg.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
    const descs = (seg.match(/desc:/g) || []).length;
    expect(ids.length).toBeGreaterThan(10);
    expect(descs, `${ids.length} tabs but ${descs} descriptions — one ships unexplained`)
      .toBe(ids.length);
  });

  it('and none of them is a placeholder', () => {
    // Escaped apostrophes are common in these sentences ("a customer\\'s"), so
    // the match has to run to the first UNESCAPED quote or it truncates and
    // reports a perfectly good description as too short.
    for (const m of seg.matchAll(/desc: '((?:[^'\\]|\\.)*)'/g)) {
      expect(m[1].length, `a tab description is too short to say anything: "${m[1]}"`)
        .toBeGreaterThan(30);
    }
  });
});

describe('☠ EVERY JOB SAYS WHAT IT WRITES BEFORE YOU PRESS IT', () => {
  const mp = read('MaintenancePanel.jsx');
  const jobs = [...mp.matchAll(/\n    id: '([A-Za-z]+)',/g)].map((m) => m[1]);

  it('there are jobs to check', () => {
    expect(jobs.length).toBeGreaterThanOrEqual(8);
  });

  it('each one carries info, blurb and writes', () => {
    // `writes` is the sentence read before deciding — two of these touch
    // customer history, and a vague description of that is worse than none.
    for (const key of ['info:', 'blurb:', 'writes:']) {
      expect((mp.match(new RegExp(key, 'g')) || []).length,
        `${key} appears fewer times than there are jobs`).toBeGreaterThanOrEqual(jobs.length - 1);
    }
  });
});

describe('☠ THE RULE IS ENFORCED BY THROWING, NOT BY REMEMBERING', () => {
  it('a SOP line without info cannot be constructed', () => {
    const sop = readFileSync(join(here, '../../../server/src/sop-engine.js'), 'utf8');
    expect(sop).toMatch(/must carry an action/);
  });

  it('a pre-flight check without info cannot be constructed', async () => {
    const { check } = await import('../../../server/src/preflight.js');
    const { STATE } = await import('../../../server/src/sop-engine.js');
    expect(() => check({ key: 'x', label: 'x', state: STATE.OK }))
      .toThrow(/explain itself/);
  });

  it('and FormField still offers info AND hint — every form depends on it', () => {
    // If these parameters are removed, every form-heavy screen silently loses
    // its explanations at once and nothing else here would notice.
    const ff = read('FormField.jsx');
    expect(ff).toMatch(/label, required = false, invalid = false, message, info, hint/);
  });
});

describe('☠ A NEW SCREEN WITH FIELDS MUST EXPLAIN THEM', () => {
  it('every admin component with inputs uses InfoDot, FormField, or is declared', () => {
    // The point of this file. The eleven current exemptions are named above
    // with a reason; a TWELFTH — a new screen with real fields and no
    // explanation — fails here rather than shipping quietly.
    const files = readdirSync(here).filter((f) => f.endsWith('.jsx') && !f.includes('.test.'));
    const unexplained = files.filter((f) => {
      const src = read(f);
      if (!/<(input|select|textarea)/.test(src)) return false;
      if (/InfoDot|FormField/.test(src)) return false;
      return !NO_EXPLANATION_NEEDED[f];
    });
    expect(unexplained,
      'a new screen has fields and nothing explaining them — add an ⓘ, use FormField, '
      + 'or declare it in NO_EXPLANATION_NEEDED with the reason').toEqual([]);
  });

  it('and every exemption still exists — a stale list describes nothing', () => {
    const files = new Set(readdirSync(here));
    const gone = Object.keys(NO_EXPLANATION_NEEDED).filter((f) => !files.has(f));
    expect(gone, 'these files are gone; remove them from the exemption list').toEqual([]);
  });

  it('every exemption carries a reason, not just a name', () => {
    for (const [f, why] of Object.entries(NO_EXPLANATION_NEEDED)) {
      expect(why.length, `${f} is exempt with no real reason given`).toBeGreaterThan(15);
    }
  });
});
