// ─── sop-written.test.js ─────────────────────────────────────────────────────
// The check that would have caught the Node canvas bug.
//
// The existing structure check finds columns empty in EVERY row, and caught
// pending_video_charges.model_label exactly as designed. It could not see the
// second bug: the canvas wrote ledger notes the label parser could not read, so
// every canvas generation stored no label — while direct generations kept the
// column ~60% full and the check reported nothing wrong.
//
// A column can be most-of-the-way written and still be completely broken for
// one of the ways people use the product.

import { describe, it, expect, vi } from 'vitest';
import {
  MUST_BE_WRITTEN, MIN_ROWS, measureWritten, judgeWritten, summariseWritten,
} from './sop-written.js';

const poolReturning = (rowsFor) => ({
  query: vi.fn(async (sql) => {
    const m = sql.match(/FROM "([a-z_]+)"/);
    const t = m ? m[1] : '?';
    const c = (sql.match(/COUNT\("([a-z_]+)"\)/) || [])[1];
    const r = rowsFor[`${t}.${c}`];
    if (!r) throw new Error(`relation "${t}" does not exist`);
    return { rows: [r] };
  }),
});

describe('the bug this check exists for', () => {
  // 60% written is not "fine". It is one whole surface of the product missing.
  it('flags a column that is mostly written but broken for one source', async () => {
    const measured = await measureWritten(poolReturning({
      'generation_events.model_label': { total: 1000, written: 600 },
    }), { specs: [MUST_BE_WRITTEN[0]] });
    const [f] = judgeWritten(measured);
    expect(f.state, '40% missing was reported as healthy').toBe('bad');
    expect(f.detail).toMatch(/400 of 1000/);
  });

  it('says what it breaks and what to do, not just that it is wrong', async () => {
    const measured = await measureWritten(poolReturning({
      'generation_events.model_label': { total: 1000, written: 600 },
    }), { specs: [MUST_BE_WRITTEN[0]] });
    const [f] = judgeWritten(measured);
    expect(f.why).toBeTruthy();
    expect(f.action, 'a finding with no action is a finding nobody can act on').toBeTruthy();
  });

  it('stays quiet when the column is being written properly', async () => {
    const measured = await measureWritten(poolReturning({
      'generation_events.model_label': { total: 1000, written: 995 },
    }), { specs: [MUST_BE_WRITTEN[0]] });
    expect(judgeWritten(measured)[0].state).toBe('ok');
  });
});

describe('refusing to cry wolf', () => {
  // A rate from four rows is noise, and a check that cries wolf becomes
  // wallpaper — which is worse than no check, because it still looks like
  // coverage.
  it('says nothing on a sample too small to mean anything', async () => {
    const measured = await measureWritten(poolReturning({
      'generation_events.model_label': { total: 4, written: 0 },
    }), { specs: [MUST_BE_WRITTEN[0]] });
    const [f] = judgeWritten(measured);
    expect(f.state).toBe('quiet');
    expect(f.detail).toMatch(/too few to judge/);
  });

  it('sets that bar somewhere defensible', () => {
    expect(MIN_ROWS).toBeGreaterThanOrEqual(20);
  });

  // Every declared column must carry a reason and a fix. A list of column
  // names is a list nobody can act on at 6am.
  it('every declared column says what it costs and how to fix it', () => {
    for (const s of MUST_BE_WRITTEN) {
      expect(s.why, `${s.table}.${s.column} has no reason`).toBeTruthy();
      expect(s.action, `${s.table}.${s.column} has no action`).toBeTruthy();
      expect(s.maxNullPct, `${s.table}.${s.column} has no limit`).toBeGreaterThan(0);
    }
  });
});

describe('not looking is not the same as being fine', () => {
  // The property that matters most. A check that cannot run must never render
  // as a pass — that is how a broken check goes unnoticed for months.
  it('reports a table it could not read as UNKNOWN, never as ok', async () => {
    const measured = await measureWritten(poolReturning({}), { specs: [MUST_BE_WRITTEN[0]] });
    const [f] = judgeWritten(measured);
    expect(f.state).toBe('unknown');
    expect(f.detail).toMatch(/could not be checked/);
    expect(f.state).not.toBe('ok');
  });

  it('one unreadable table does not stop the others being checked', async () => {
    const measured = await measureWritten(poolReturning({
      'credits_history.reason': { total: 500, written: 500 },
    }), { specs: MUST_BE_WRITTEN });
    expect(measured).toHaveLength(MUST_BE_WRITTEN.length);
    expect(judgeWritten(measured).filter((f) => f.state === 'ok')).toHaveLength(1);
  });

  it('counts unknowns separately in the summary, not as passes', () => {
    const s = summariseWritten(judgeWritten([
      { table: 'a', column: 'x', error: 'boom' },
      { table: 'b', column: 'y', total: 100, written: 100, maxNullPct: 10 },
    ]));
    expect(s).toMatchObject({ unknown: 1, ok: 1, bad: 0 });
  });
});

describe('looking at now, not at all of history', () => {
  // 3,046 rows will never be filled. Reporting them forever is a permanent red
  // mark nobody can clear, which is how a check becomes wallpaper.
  it('restricts every query to a recent window', async () => {
    const pool = poolReturning({ 'generation_events.model_label': { total: 100, written: 100 } });
    await measureWritten(pool, { specs: [MUST_BE_WRITTEN[0]], days: 7 });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/created_at > NOW\(\)/);
    expect(params).toEqual([7]);
  });

  it('applies the per-column condition, so pending rows are not judged', async () => {
    const spec = MUST_BE_WRITTEN.find((s) => s.column === 'duration_ms');
    const pool = poolReturning({ 'generation_events.duration_ms': { total: 100, written: 100 } });
    await measureWritten(pool, { specs: [spec] });
    // Asserted as INTENT, not as a fixed clause: this used to pin the literal
    // string "outcome <> 'pending'", which turned out to be the bug.
    expect(pool.query.mock.calls[0][0]).toMatch(/AND \(outcome IN/);
    expect(spec.where).not.toMatch(/pending/);
  });

  // ── the reason that clause changed ────────────────────────────────────────
  // sweepStale marks an attempt `unknown` when the browser tab closed and it
  // never reported back, and leaves duration_ms null ON PURPOSE — inventing a
  // duration there would fabricate the exact number this column exists to give
  // honestly. `outcome <> 'pending'` counted every one of them as a gap: 44.4%
  // of the window on production, with the line pointing at a bug that was not
  // there.
  it('does not count an attempt that never reported back as a missing duration', () => {
    const spec = MUST_BE_WRITTEN.find((s) => s.column === 'duration_ms');
    expect(spec.where).toBe("outcome IN ('delivered', 'failed')");
    expect(spec.where, 'swept-unknown rows were judged for a duration they cannot have')
      .not.toMatch(/unknown/);
  });

  // ── a column is not judged on rows written before it existed ─────────────
  // Nothing wrote pending_video_charges.model_label until 2026-08-19. Over a
  // 7-day window it read 79.5% missing the day AFTER the fix shipped, blaming
  // call sites that all pass modelLabel correctly.
  describe('columns that started being written on a known date', () => {
    it('excludes rows older than that date', async () => {
      const spec = MUST_BE_WRITTEN.find((s) => s.table === 'pending_video_charges');
      const pool = poolReturning({ 'pending_video_charges.model_label': { total: 10, written: 10 } });
      await measureWritten(pool, { specs: [spec], days: 7 });
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toMatch(/created_at >= \$2::date/);
      expect(params).toEqual([7, '2026-08-19']);
    });

    it('leaves every other column judged over the whole window', async () => {
      const spec = MUST_BE_WRITTEN.find((s) => s.column === 'model_label' && s.table === 'generation_events');
      const pool = poolReturning({ 'generation_events.model_label': { total: 10, written: 10 } });
      await measureWritten(pool, { specs: [spec], days: 7 });
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).not.toMatch(/::date/);
      expect(params).toEqual([7]);
    });

    // It must not become a way to hide a regression: only rows BEFORE the date
    // are excluded, so anything written after it is still judged in full, and
    // once the rolling window clears the date the clause stops mattering.
    it('is reported as an error rather than interpolated when it is not a date', async () => {
      const measured = await measureWritten(poolReturning({}), {
        specs: [{ table: 'users', column: 'email', why: 'w', action: 'a', maxNullPct: 5,
                  since: "2026-08-19'; DROP TABLE users --" }],
      });
      expect(measured[0].error).toMatch(/since must be YYYY-MM-DD/);
    });
  });

  // The identifiers are ours, not user input — but a hand-edited list is still
  // worth validating before it is interpolated into SQL.
  it('refuses an identifier that is not a plain name', async () => {
    const measured = await measureWritten(poolReturning({}), {
      specs: [{ table: 'users; DROP TABLE users', column: 'x', why: 'w', action: 'a', maxNullPct: 5 }],
    });
    expect(measured[0].error).toMatch(/unsafe identifier/);
  });
});
