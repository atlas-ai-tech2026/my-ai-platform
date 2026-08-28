// ─── history-search.test.js ──────────────────────────────────────────────────
// One property outranks every other test in this file:
//
//   A CUSTOMER CAN ONLY EVER SEE THEIR OWN WORK.
//
// Search is a convenience. That is not. So most of what follows is attempts to
// make the builder produce a query that escapes its user — with no user, a
// junk user, a hostile filter, an empty filter — and the requirement is that
// every one of them fails loudly instead of quietly returning somebody else's
// history.

import { describe, it, expect } from 'vitest';
import { buildSearch, likeLiteral, toGridItem, MODELS_USED_SQL, MAX_LIMIT } from './history-search.js';

const base = { userId: 7 };

describe('THE PROPERTY — the query cannot escape its user', () => {
  it('throws without a user rather than building an unscoped query', () => {
    for (const bad of [undefined, null, 0, -1, '', 'abc', {}, NaN]) {
      expect(() => buildSearch({ userId: bad }), `userId=${JSON.stringify(bad)}`).toThrow(/user/i);
    }
  });

  it('the user is the FIRST condition and the first parameter, always', () => {
    const q = buildSearch({ ...base, text: 'x', models: ['a'], from: '2026-08-01' });
    expect(q.sql).toMatch(/WHERE user_id = \$1/);
    expect(q.params[0]).toBe(7);
  });

  it('no filter can remove it — every combination keeps user_id = $1', () => {
    const combos = [
      {}, { text: '' }, { text: '   ' }, { models: [] }, { models: null },
      { from: null, to: null }, { savedOnly: false }, { type: null },
      { text: "' OR 1=1 --" }, { models: ["'; DROP TABLE entities; --"] },
      { type: "x' OR '1'='1" },
    ];
    for (const c of combos) {
      const q = buildSearch({ ...base, ...c });
      expect(q.sql, JSON.stringify(c)).toMatch(/WHERE user_id = \$1/);
      expect(q.countSql, JSON.stringify(c)).toMatch(/WHERE user_id = \$1/);
    }
  });

  it('the COUNT is scoped too — a total that counted everyone would leak how much others have', () => {
    const q = buildSearch({ ...base, text: 'dragon' });
    expect(q.countSql).toMatch(/user_id = \$1/);
    expect(q.countParams[0]).toBe(7);
  });
});

describe('nothing the customer types reaches the SQL', () => {
  it('hostile text is a bound parameter, never concatenated', () => {
    const nasty = "'; DROP TABLE entities; --";
    const q = buildSearch({ ...base, text: nasty });
    expect(q.sql).not.toContain('DROP');
    expect(q.params.some((p) => String(p).includes('DROP'))).toBe(true);
  });

  it('a model name is bound, not inlined', () => {
    const q = buildSearch({ ...base, models: ["'; DELETE FROM users; --"] });
    expect(q.sql).not.toContain('DELETE');
    expect(q.sql).toMatch(/ANY\(\$\d+::text\[\]\)/);
  });

  it('the array parameter carries its explicit cast', () => {
    // Postgres cannot deduce the type of an untyped array parameter and errors
    // out — this exact omission has already cost a debugging session here.
    expect(buildSearch({ ...base, models: ['a'] }).sql).toMatch(/::text\[\]/);
  });

  it('wildcards typed by the customer are literal, not "match everything"', () => {
    // Searching for "50%" must find "50%", not every row.
    expect(likeLiteral('50%')).toBe('%50\\%%');
    expect(likeLiteral('a_b')).toBe('%a\\_b%');
    expect(buildSearch({ ...base, text: '%' }).sql).toMatch(/ESCAPE/);
  });
});

describe('no filter means the WHOLE history, newest first', () => {
  it('adds no date window of its own', () => {
    // A default window would make somebody's own library look emptied — a far
    // worse failure than a slow grid, and the reason the 7-day idea was
    // argued against.
    const q = buildSearch(base);
    expect(q.sql).not.toMatch(/created_date >=/);
    expect(q.sql).toMatch(/ORDER BY created_date DESC/);
  });

  it('blank text is not a filter', () => {
    expect(buildSearch({ ...base, text: '   ' }).sql).not.toMatch(/ILIKE/);
  });

  it('an empty model list is not a filter', () => {
    expect(buildSearch({ ...base, models: [] }).sql).not.toMatch(/ANY\(/);
  });
});

describe('the traps in a date filter', () => {
  it('"to 28 August" INCLUDES the 28th', () => {
    // An exclusive bound silently drops the last day's work, which reads as
    // missing history rather than as an off-by-one.
    const q = buildSearch({ ...base, to: '2026-08-28' });
    expect(q.sql).toMatch(/interval '1 day'/);
  });

  it('from and to are both bound values', () => {
    const q = buildSearch({ ...base, from: '2026-08-01', to: '2026-08-28' });
    expect(q.params).toContain('2026-08-01');
    expect(q.params).toContain('2026-08-28');
  });
});

describe('what comes back', () => {
  it('is the grid’s fields, NOT the whole row', () => {
    // SELECT * returns prompts of 2,000 characters — 60 of them is over 100 KB
    // of text to draw squares, fetched from New York.
    const q = buildSearch(base);
    expect(q.sql).not.toMatch(/SELECT \*/);
    for (const f of ['thumb_url', 'result_url', 'model', 'created_date']) {
      expect(q.sql).toContain(f);
    }
  });

  it('truncates the prompt — the card shows two lines', () => {
    expect(buildSearch(base).sql).toMatch(/left\(COALESCE\(data->>'prompt',''\), 200\)/);
  });

  it('counts separately, so "128 pictures" can be true while 60 arrive', () => {
    expect(buildSearch(base).countSql).toMatch(/count\(\*\)/);
  });

  it('never returns more than one page however big a limit is asked for', () => {
    const q = buildSearch({ ...base, limit: 100000 });
    expect(q.params[q.params.length - 2]).toBe(MAX_LIMIT);
  });

  it('a junk limit or offset degrades to something sane, not to NaN', () => {
    const q = buildSearch({ ...base, limit: 'abc', offset: -50 });
    expect(q.params[q.params.length - 2]).toBe(MAX_LIMIT);
    expect(q.params[q.params.length - 1]).toBe(0);
  });

  it('maps a row into what the grid already expects', () => {
    expect(toGridItem({ id: 'a', type: 'image', model: 'X', result_url: 'u', thumb_url: 't', saved: 'true' }))
      .toMatchObject({ id: 'a', model: 'X', result_url: 'u', thumb_url: 't', saved: true });
  });

  it('saved is a real boolean, not the string "false"', () => {
    // `"false"` is truthy in JavaScript, so every picture would show as saved.
    expect(toGridItem({ saved: 'false' }).saved).toBe(false);
    expect(toGridItem({}).saved).toBe(false);
  });
});

describe('the model list offered to a customer', () => {
  it('is the ones THEY have used, and is scoped to them', () => {
    expect(MODELS_USED_SQL).toMatch(/user_id = \$1/);
    expect(MODELS_USED_SQL).toMatch(/DISTINCT/);
  });

  it('never offers a blank entry', () => {
    expect(MODELS_USED_SQL).toMatch(/data->>'model'\),''\) <> ''|COALESCE\(data->>'model',''\) <> ''/);
  });
});
