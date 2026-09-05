// ─── no-hardcoded-money-rate.test.jsx ────────────────────────────────────────
// No screen may decide for itself what a credit is worth.
//
// ☠ WHAT THIS CAUGHT. Amr filtered Manual Credits to "spa 4" on 2026-09-05.
// The Value tile read $9,605.78. The Batches screen, on the same 396 ledger
// entries and the same 151,671 credits, read $9,605.83. Both are figures he
// builds invoices from.
//
// The cause was `const CREDIT_USD = 0.063333` written into
// ManualCreditsTab.jsx, and the same literal inline in LiveTab.jsx. Neither
// ever asked the database, which stores 0.06333333.
//
// FIVE CENTS IS NOT THE POINT. Amr has said he wants to revisit pricing. On the
// day that value changes, every screen reading the database shows the new
// number and every hardcoded one silently keeps showing the old — no error, no
// warning, two screens quietly disagreeing about what a workshop is worth.
//
// That is this project's recurring bug in its purest form: something that works
// exactly as written and helps nobody. A comment saying "don't hardcode the
// rate" would not have stopped it. This does.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ADMIN_DIR = path.resolve(__dirname, 'components/admin');

/** Strip comments so a literal QUOTED in an explanation is not a violation. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments, JSX comments included
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

// Any decimal that looks like dollars-per-credit. Deliberately broad: it should
// fire on 0.0633, 0.063333, 0.06333333 and anything else in that shape, because
// the next person's typo will not be the exact literal we removed.
const RATE = /\b0\.0[0-9]{2,10}\b/g;

// HTML number inputs legitimately carry decimals in step/min/max — they are
// units of typing, not prices. Stripped before the check rather than added to
// the allowlist below, because they are never a rate in any file.
const stripInputUnits = (src) => src.replace(/\b(?:step|min|max)="[^"]*"/g, '');

// ☠ AN ALLOWLIST WITH REASONS, NOT AN OFF SWITCH. Every entry here is a
// decimal that is NOT the voxel credit value. If you are adding to this list to
// make a red test green, you are doing the thing this file exists to stop.
const ALLOWED = {
  // kie.ai's OWN credit price, not Voxel's, on a screen that reports kie's
  // balance. It is hardcoded on purpose and has a documented update process:
  // when kie reprices, kie-pricing.js and this line change together.
  'UsageTab.jsx': ['0.005'],
};

const files = readdirSync(ADMIN_DIR)
  .filter((f) => f.endsWith('.jsx') && !f.endsWith('.test.jsx'));

describe('no admin screen hardcodes what a credit is worth', () => {
  it('has admin components to check (the test is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const f of files) {
    it(`${f} takes the rate from the API, not from a literal`, () => {
      const src = stripInputUnits(codeOnly(readFileSync(path.join(ADMIN_DIR, f), 'utf8')));
      const allowed = ALLOWED[f] || [];
      const hits = (src.match(RATE) || []).filter((h) => !allowed.includes(h));
      expect(
        hits,
        `${f} contains ${hits.join(', ')} — a money rate written into the file. `
        + 'Read it from the API response (the server gets it from pricing_settings '
        + 'via readCreditValue), and show a dash when it is missing: an unknown '
        + 'price is not a price.',
      ).toEqual([]);
    });
  }
});

describe('the two screens that had the bug read it from the API', () => {
  for (const f of ['ManualCreditsTab.jsx', 'LiveTab.jsx', 'BatchesTab.jsx']) {
    it(`${f} references credit_value from the response`, () => {
      expect(readFileSync(path.join(ADMIN_DIR, f), 'utf8')).toMatch(/credit_value/);
    });
  }

  it('and they say so rather than showing a wrong number when it is missing', () => {
    // `unknown` is never rendered as `ok` — the same rule the SOP lines follow.
    for (const f of ['ManualCreditsTab.jsx', 'LiveTab.jsx']) {
      const src = readFileSync(path.join(ADMIN_DIR, f), 'utf8');
      expect(src, `${f} should fall back to a dash or a message, not to a rate`)
        .toMatch(/rate unavailable|'—'/);
    }
  });
});
