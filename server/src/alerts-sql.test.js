// ─── alerts-sql.test.js ──────────────────────────────────────────────────────
// Guards for the class of bug that 42 passing unit tests could not see.
//
// What happened: the statement that resolves alerts no longer firing was
// written as two branches sharing one parameter list. The "nothing is firing"
// branch still referenced $2 while binding a single value, so Postgres threw
// `could not determine data type of parameter $1` on every pass — and it threw
// specifically when the system was HEALTHY, which is the failure you would
// notice last. It survived the whole test suite and died on the first real
// deploy, because the engine tests never touch SQL.
//
// These are static checks on the query text. They cannot prove the SQL is
// correct, but they catch the two things that actually went wrong: a
// placeholder with no argument, and an array parameter with no cast.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'alerts-routes.js'), 'utf8');

/** Every pool.query(...) call, as (sql, argsText) pairs. */
function queries(src) {
  const out = [];
  const re = /pool\.query\(\s*/g;
  let m;
  while ((m = re.exec(src))) {
    // Walk to the matching close paren so nested parens in SQL don't truncate.
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    out.push(src.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

const CALLS = queries(source);

describe('every query binds what it references', () => {
  it('found the queries to check', () => {
    expect(CALLS.length).toBeGreaterThan(5);
  });

  // The exact bug: $2 referenced, one argument bound.
  it('never references a higher $N than it passes arguments', () => {
    for (const call of CALLS) {
      const highest = Math.max(0, ...[...call.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      if (!highest) continue;

      // The argument array is whatever follows the closing backtick/quote.
      const afterSql = call.replace(/^[\s\S]*?`[\s\S]*?`/, '');
      const arr = afterSql.match(/\[([\s\S]*)\]\s*$/);
      expect(arr, `query references $${highest} but passes no argument array:\n${call.slice(0, 160)}`)
        .not.toBeNull();

      // Count top-level commas to get the argument count.
      const inner = arr[1];
      let depth = 0, count = inner.trim() ? 1 : 0;
      for (const ch of inner) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === ',' && depth === 0) count++;
      }
      expect(count, `query references $${highest} but binds ${count} argument(s):\n${call.slice(0, 160)}`)
        .toBeGreaterThanOrEqual(highest);
    }
  });

  // The other half of the same failure. A JS array reaching ANY() without a
  // cast gives Postgres nothing to infer from.
  it('casts every array parameter passed to ANY()', () => {
    for (const call of CALLS) {
      for (const m of call.matchAll(/ANY\(\s*(\$\d+)([^)]*)\)/g)) {
        expect(m[2], `ANY(${m[1]}) needs an explicit ::type[] cast:\n${call.slice(0, 160)}`)
          .toMatch(/::\w+\[\]/);
      }
    }
  });
});

describe('the resolve statement, specifically', () => {
  const resolve = CALLS.find((c) => /SET status = 'resolved'/.test(c) && /NOT \(key = ANY/.test(c));

  it('exists', () => expect(resolve).toBeTruthy());

  // One statement, one parameter list — the two branches could drift apart,
  // and did.
  it('is a single statement rather than a branch on whether anything fired', () => {
    expect(resolve).not.toMatch(/\?\s*`/);
    expect(resolve).not.toMatch(/seen\.size\s*\?/);
  });

  // With no alerts firing the array is empty, `key = ANY('{}')` is false, and
  // NOT false resolves everything — which is exactly right: nothing is firing,
  // so nothing should stay open.
  it('resolves everything still open when the array is empty', () => {
    expect(resolve).toMatch(/NOT \(key = ANY\(\$1::text\[\]\)\)/);
    expect(resolve).toMatch(/status <> 'resolved'/);
  });
});

describe('alerts are updated in place, never duplicated', () => {
  it('upserts on the open-alert key so a 5-minute check cannot pile up rows', () => {
    const insert = CALLS.find((c) => /INSERT INTO alerts/.test(c));
    expect(insert).toMatch(/ON CONFLICT \(key\) WHERE status <> 'resolved'/);
    expect(insert).toMatch(/seen_count = alerts\.seen_count \+ 1/);
  });

  it('never deletes an alert — resolved rows are the recurrence signal', () => {
    expect(source).not.toMatch(/DELETE FROM alerts/i);
  });
});
