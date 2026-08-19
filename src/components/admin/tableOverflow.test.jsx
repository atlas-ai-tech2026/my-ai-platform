// ─── tableOverflow.test.jsx ──────────────────────────────────────────────────
// No table in the control panel may cut a column off the right edge.
//
// WHY THIS EXISTS. `UserTable` had `width: 100%` and no overflow container. It
// looked correct for months, because the page happened to be wide enough. Then
// the sidebar took 232px away and the last three action buttons — Details,
// History, Reset PW — were cut off. Not greyed out, not wrapped onto a second
// line: absent, with nothing on screen admitting it.
//
// The owner found it. That is the part worth fixing properly: the failure was
// invisible to every existing test, because each one asked "does the button
// render?" and the button did render — just past the edge of a container that
// had been told to hide it.
//
// Every OTHER table already had the guard. So this is not a new convention, it
// is one file that was missed — which is exactly the kind of thing a sweep
// catches and a per-component test does not.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

function adminSources() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.jsx') && !f.endsWith('.test.jsx'))
    .map((f) => ({ file: f, src: readFileSync(join(DIR, f), 'utf8') }));
}

describe('every admin table can scroll rather than hide a column', () => {
  const withTables = adminSources().filter(({ src }) => src.includes('<table'));

  // A sweep that silently matches nothing passes forever and protects nothing.
  // This is the self-check: if a refactor moves the tables elsewhere, this test
  // fails loudly instead of quietly becoming a no-op.
  it('actually finds the tables it claims to be checking', () => {
    expect(withTables.length,
      'no <table> found in src/components/admin — this sweep is checking nothing'
    ).toBeGreaterThanOrEqual(5);
  });

  it.each(withTables.map(({ file }) => file))(
    '%s wraps its table in a horizontal scroll container',
    (file) => {
      const { src } = withTables.find((s) => s.file === file);
      expect(src,
        `${file} has a <table> but no overflowX container. On a narrow window, or `
        + 'with the sidebar expanded, its right-hand columns are cut off and nothing '
        + 'on screen says so — which is how the Users table lost its action buttons.'
      ).toMatch(/overflowX:\s*'auto'/);
    },
  );

  // A scroll container only helps if the table is allowed to STAY wide.
  // `width: 100%` on its own lets the columns crush together until they are
  // unreadable, and the scrollbar never appears because nothing ever overflows.
  //
  // Two ways to prevent that, and both are fine:
  //   · minWidth on the table       — Users, Logs, Promo Codes, Gift Cards
  //   · white-space: nowrap on cells — Notifications, API Usage
  // The first version of this test only accepted the first, and flagged two
  // files that were already correct. Asserting a MECHANISM rather than the
  // OUTCOME is how a test starts inventing work.
  it.each(withTables.map(({ file }) => file))(
    '%s stays wide enough to scroll, instead of squashing its columns',
    (file) => {
      const { src } = withTables.find((s) => s.file === file);
      const holdsWidth = /minWidth:\s*\d+/.test(src) || /whiteSpace:\s*'nowrap'/.test(src);
      expect(holdsWidth,
        `${file}: the table has neither a minWidth nor nowrap cells, so its columns `
        + 'will compress into an unreadable mess before the scroll container ever '
        + 'engages.'
      ).toBe(true);
    },
  );
});
