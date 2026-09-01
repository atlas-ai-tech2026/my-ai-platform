// ─── thumbnail-sweep.test.js ─────────────────────────────────────────────────
// The all-accounts thumbnail backfill.
//
// The happy path is the least interesting thing here. This job runs unattended
// on customer data, newest-first, forever — so the properties worth testing are
// the ones that decide whether it QUIETLY STOPS WORKING:
//
//   1. a row that can never succeed must not block everything behind it
//   2. it must never report "finished" when it does not actually know
//   3. its query must agree with the filter backfillRows applies afterwards —
//      a disagreement is a stall that looks exactly like normal operation

import { describe, it, expect, vi } from 'vitest';
import {
  sweepOnce, sweepLine, retryCutoff,
  NEXT_BATCH_SQL, REMAINING_SQL, MARK_FAILED_SQL,
  SWEEP_LOCK_ID, BATCH, RETRY_AFTER_DAYS,
} from './thumbnail-sweep.js';
import { isEligible } from './thumbnail-survey.js';

const row = (id, extra = {}) => ({
  id, user_id: 7,
  data: { type: 'image', status: 'completed', result_url: `https://x/${id}.png`, ...extra },
});
const quiet = { warn() {}, error() {}, log() {} };
const ok = (n) => ({ attempted: n, done: n, failed: 0, problems: [], savedMB: 1 });
/**
 * Stands in for backfillRows: reports each success by id, as the real one does,
 * and reports `attempted` as the ELIGIBLE count — not the batch size. That
 * distinction is the whole point: attempted < batch.length is how a filter
 * disagreement shows itself.
 */
const finishes = (ids) => async (_batch, { onDone }) => {
  for (const id of ids) onDone(id);
  return { attempted: ids.length, done: ids.length, failed: 0, problems: [], savedMB: 1 };
};

describe('☠ ONE DEAD ROW MUST NOT BLOCK THE WHOLE BACKLOG', () => {
  it('writes down the rows that failed, so the queue head can move', async () => {
    // Without this the newest broken picture is chosen first on EVERY pass and
    // nothing behind it is ever reached — a job that runs for ever and
    // achieves nothing, while every log line looks reasonable.
    const marked = [];
    await sweepOnce({
      rows: async () => [row('a'), row('b')],
      backfill: async (batch, { onDone }) => {
        onDone('a');
        return { attempted: 2, done: 1, failed: 1, problems: [{ id: 'b', why: 'source responded 404' }] };
      },
      markFailed: async (id) => marked.push(id),
      remaining: async () => 5,
      log: quiet,
    });
    expect(marked).toEqual(['b']);
  });

  it('a failure is a delay, not a life sentence', async () => {
    // A network blip must not blacklist a good picture for ever.
    expect(RETRY_AFTER_DAYS).toBeGreaterThan(0);
    const now = 1_756_000_000_000;
    expect(retryCutoff(now)).toBe(Math.floor(now / 1000) - RETRY_AFTER_DAYS * 86_400);
    // The query lets a row back in once its mark is older than the cutoff.
    expect(NEXT_BATCH_SQL).toMatch(/thumb_failed_at.*<.*to_jsonb\(\$2::bigint\)/s);
  });

  it('a row with NO mark is never excluded by the retry clause', async () => {
    // jsonb null sorts BELOW every number, so a missing mark passes the
    // comparison. If that were the other way round the sweep would select
    // nothing at all, for ever, and look perfectly healthy doing it.
    expect(NEXT_BATCH_SQL).toMatch(/COALESCE\(data->'thumb_failed_at', 'null'::jsonb\)/);
  });

  it('a failure to WRITE the mark does not take the pass down', async () => {
    const r = await sweepOnce({
      rows: async () => [row('a')],
      backfill: async () => ({ attempted: 1, done: 0, failed: 1, problems: [{ id: 'a', why: 'x' }] }),  // no onDone: nothing succeeded
      markFailed: async () => { throw new Error('db gone'); },
      remaining: async () => 1,
      log: quiet,
    });
    expect(r.failed).toBe(1);
  });
});

describe('☠ THE TWO FILTERS MUST AGREE', () => {
  // backfillRows re-applies isEligible in JavaScript. Any row this SQL returns
  // that isEligible then rejects is never attempted AND never marked — so it
  // sits in the newest 25 for ever. This is the subtle version of the deadlock
  // above, and the one no counter would reveal.
  const cases = [
    ['a video',            { type: 'video' }],
    ['a failed generation',{ status: 'failed' }],
    ['one already done',   { thumb_url: 'https://x/t.jpg' }],
    ['a data: URI',        { result_url: 'data:image/png;base64,AAA' }],
    ['no source at all',   { result_url: '' }],
  ];

  it.each(cases)('the SQL excludes %s, exactly as isEligible does', (_name, extra) => {
    expect(isEligible(row('x', extra))).toBe(false);
  });

  it('and a plain completed image passes both', () => {
    expect(isEligible(row('x'))).toBe(true);
    expect(NEXT_BATCH_SQL).toMatch(/data->>'type' = 'image'/);
    expect(NEXT_BATCH_SQL).toMatch(/COALESCE\(data->>'status', 'completed'\) = 'completed'/);
    expect(NEXT_BATCH_SQL).toMatch(/COALESCE\(data->>'thumb_url', ''\) = ''/);
    expect(NEXT_BATCH_SQL).toMatch(/result_url' ~\* '\^https\?:\/\/'/);
  });

  it('☠ if they disagree anyway, it marks the strays instead of stalling', async () => {
    // Belt and braces: the assertion above can only check the filters I know
    // about. If isEligible ever gains a rule this query lacks, the sweep must
    // still make progress rather than spin.
    const marked = [];
    await sweepOnce({
      rows: async () => [row('a'), row('b'), row('c')],
      backfill: finishes(['a']),                       // b and c were refused
      markFailed: async (id) => marked.push(id),
      remaining: async () => 9,
      log: quiet,
    });
    expect(marked.sort()).toEqual(['b', 'c']);         // the strays are moved past
  });

  it('and says so out loud rather than leaving it to be inferred', async () => {
    const warn = vi.fn();
    await sweepOnce({
      rows: async () => [row('a'), row('b')],
      backfill: finishes(['a']),
      markFailed: async () => {},
      remaining: async () => 1,
      log: { warn, error() {} },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/disagree/));
  });
});

describe('☠ IT NEVER CLAIMS TO BE FINISHED WHEN IT CANNOT COUNT', () => {
  it('a count that throws is null, and null is NOT finished', async () => {
    const r = await sweepOnce({
      rows: async () => [row('a')],
      backfill: finishes(['a']),
      markFailed: async () => {},
      remaining: async () => { throw new Error('db unreachable'); },
      log: quiet,
    });
    expect(r.remaining).toBeNull();
    expect(r.finished).toBe(false);
  });

  it('a count that comes back as nonsense is null too', async () => {
    const r = await sweepOnce({
      rows: async () => [row('a')],
      backfill: finishes(['a']),
      markFailed: async () => {},
      remaining: async () => NaN,
      log: quiet,
    });
    expect(r.remaining).toBeNull();
    expect(r.finished).toBe(false);
  });

  it('and the log line says unknown rather than inventing a number', () => {
    expect(sweepLine({ done: 3, failed: 0, savedMB: 0, remaining: null })).toMatch(/remaining unknown/);
  });

  it('genuinely empty is genuinely finished, and quiet', async () => {
    const r = await sweepOnce({
      rows: async () => [], backfill: finishes([]),
      markFailed: async () => {}, remaining: async () => 0, log: quiet,
    });
    expect(r.finished).toBe(true);
    expect(sweepLine(r)).toMatch(/nothing left/);
  });

  it('the REMAINING count is not narrowed by the retry mark', () => {
    // A row that keeps failing still has no thumbnail. Excluding it here would
    // let the number reach zero while the work was not done — the control
    // panel would say finished and be wrong.
    expect(REMAINING_SQL).not.toMatch(/thumb_failed_at/);
  });
});

describe('☠ IT ONLY EVER ADDS', () => {
  it('the two SELECTs cannot write', () => {
    for (const sql of [NEXT_BATCH_SQL, REMAINING_SQL]) {
      expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|ALTER)\b/i);
    }
  });

  it('the ONE write touches one key on one row and cannot reach result_url', () => {
    expect(MARK_FAILED_SQL).toMatch(/jsonb_set\(data, '\{thumb_failed_at\}'/);
    expect(MARK_FAILED_SQL).toMatch(/WHERE id = \$1/);
    expect(MARK_FAILED_SQL).toMatch(/name = 'GenerationHistory'/);
    expect(MARK_FAILED_SQL).not.toMatch(/result_url/);
    expect((MARK_FAILED_SQL.match(/jsonb_set/g) || [])).toHaveLength(1);
  });

  it('it never looks at a row that already has a thumbnail', () => {
    // Redoing one would pay to make a file nobody needed; over 24,000 rows
    // that is real money for no change.
    expect(NEXT_BATCH_SQL).toMatch(/COALESCE\(data->>'thumb_url', ''\) = ''/);
  });

  it('and skips media the rescue job already declared dead', () => {
    expect(NEXT_BATCH_SQL).toMatch(/rescue_gone_at' IS NULL/);
  });

  it('newest first — every account improves at the page it looks at', () => {
    // Account-by-account would give nobody anything for hours.
    expect(NEXT_BATCH_SQL).toMatch(/ORDER BY created_date DESC/);
  });
});

describe('two instances must not both sweep', () => {
  it('has its own advisory lock id, distinct from the backup', () => {
    // Advisory locks share ONE namespace per database. A collision means two
    // unrelated jobs silently blocking each other, visible only under load.
    expect(SWEEP_LOCK_ID).toBe(8_432_121);
    expect(SWEEP_LOCK_ID).not.toBe(8_432_119);
  });

  it('and a batch small enough to be invisible on a 1-vCPU box', () => {
    expect(BATCH).toBeLessThanOrEqual(50);
  });
});

describe('☠ A ROW THAT SUCCEEDED IS NEVER MARKED FAILED', () => {
  it('the success is not stamped with a failure it did not have', async () => {
    // `attempted` is a COUNT — it does not say which. An earlier version
    // inferred "not named as a problem ⇒ never tried", which stamps
    // thumb_failed_at onto the row that had just been given its thumbnail:
    // a plain lie written into customer data.
    const marked = [];
    await sweepOnce({
      rows: async () => [row('a'), row('b')],
      backfill: async (batch, { onDone }) => {
        onDone('a');
        return { attempted: 2, done: 1, failed: 1, problems: [{ id: 'b', why: 'dead link' }] };
      },
      markFailed: async (id) => marked.push(id),
      remaining: async () => 3,
      log: quiet,
    });
    expect(marked).toEqual(['b']);
    expect(marked).not.toContain('a');
  });

  it('a whole clean batch marks nothing at all', async () => {
    const marked = [];
    await sweepOnce({
      rows: async () => [row('a'), row('b'), row('c')],
      backfill: async (batch, { onDone }) => {
        for (const r of batch) onDone(r.id);
        return { attempted: 3, done: 3, failed: 0, problems: [], savedMB: 2 };
      },
      markFailed: async (id) => marked.push(id),
      remaining: async () => 100,
      log: quiet,
    });
    expect(marked).toEqual([]);
  });
});
