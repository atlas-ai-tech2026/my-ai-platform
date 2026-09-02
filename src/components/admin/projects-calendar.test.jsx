// ─── projects-calendar.test.jsx ──────────────────────────────────────────────
// THE MONTH GRID.
//
// Amr asked for this specifically: "Calendar view is very important for us."
//
// A month grid has three classic ways of being quietly wrong, and this
// codebase has already been bitten by the first one:
//
//   1. TIMEZONE. Building a Date from a date-only value and comparing instants
//      is what made the same deadline read 02 Sept in Kuwait and 01 Sept in
//      London. Every date here is a STRING, matched by equality.
//   2. DAYLIGHT SAVING. Walking a month by adding 24 hours in local time skips
//      or repeats a day twice a year. The grid is walked in UTC.
//   3. SILENT TRUNCATION. A day showing three of seven deadlines while looking
//      complete is the calendar lying about the week.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ProjectsTab.jsx'), 'utf8');
const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('☠ THE GRID CANNOT SHIFT A DAY', () => {
  it('cells are matched to projects by STRING, never by Date comparison', () => {
    expect(code).toMatch(/starts\.get\(key\)/);
    expect(code).toMatch(/ends\.get\(key\)/);
    expect(code, 'a Date is being built from a project date again')
      .not.toMatch(/new Date\(p\.start_date\)|new Date\(p\.end_date\)/);
  });

  it('☠ the month is walked in UTC — DST would otherwise skip or repeat a day', () => {
    // Adding a day in local time across a clock change gives 23 or 25 hours,
    // and a 42-cell grid built that way loses or duplicates one twice a year.
    expect(code).toMatch(/Date\.UTC\(y, m, 1 - lead\)/);
    expect(code).toMatch(/d\.setUTCDate\(gridStart\.getUTCDate\(\) \+ i\)/);
    expect(code).toMatch(/getUTCFullYear\(\)/);
  });

  it('today is decided by the same day-string as everything else', () => {
    expect(code).toMatch(/const today = todayStr\(\);/);
    expect(code).toMatch(/isToday: key === today/);
  });

  it('weeks start on Monday, and the shift is explicit', () => {
    // getUTCDay() is 0 for Sunday; the +6 %7 is what makes Monday column one.
    expect(code).toMatch(/\(first\.getUTCDay\(\) \+ 6\) % 7/);
    expect(code).toMatch(/'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'/);
  });
});

describe('☠ IT NEVER HIDES A DEADLINE SILENTLY', () => {
  it('a day with more than three says how many more', () => {
    expect(code).toMatch(/\+ \{list\.length - shown\.length\} more/);
  });

  it('and the cap is applied where the count can still see the full list', () => {
    // slice for display, length for the count — not slice first and count after.
    expect(code).toMatch(/const shown = list\.slice\(0, 3\);/);
    expect(code).toMatch(/list\.length > shown\.length/);
  });
});

describe('it shows both ends of a project, and marks the late one', () => {
  it('starts and deadlines are separate, with different marks', () => {
    expect(code).toMatch(/mark="▸"/);
    expect(code).toMatch(/mark="◗"/);
    expect(code).toMatch(/deadline/);
  });

  it('an overdue deadline is red — using the same isOverdue as the list', () => {
    // One decision, used everywhere, so a card and a cell cannot disagree.
    expect(code).toMatch(/const late = deadline && isOverdue\(p\)/);
  });

  it('and clicking one opens the project', () => {
    expect(code).toMatch(/onClick=\{\(\) => onEdit\(p\)\}/);
  });
});

describe('it is reachable', () => {
  it('the Calendar button exists beside List and Board', () => {
    expect(code).toMatch(/\['table', 'board', 'calendar'\]/);
    expect(code).toMatch(/view === 'calendar' && <Calendar/);
  });
});
