// ─── preflight-fast.test.js ──────────────────────────────────────────────────
// ☠ THE SCREEN YOU READ WITH A ROOM FILLING UP MUST NOT BE ABLE TO HANG.
//
// Pressed on production for the first time, the pre-flight card took over two
// minutes and Amr gave up before it answered. Every unit test passed. The
// judgement was right, the wiring was right, and the thing was useless —
// because a check whose entire premise is "the ten minutes before you stand up
// in front of people" had no bound on how long it could take.
//
// TWO CAUSES, and only one of them was the slow query:
//
//   1. it called gatherFacts() to obtain TWO numbers, and inherited a full
//      scan of `entities` that it never used;
//   2. nothing anywhere said a source must answer within any particular time.
//
// The first is a bug. The second is the design fault, because the first would
// only ever have come back in another form.

import { describe, it, expect, vi } from 'vitest';
import { withTimeout, SOURCE_TIMEOUT_MS } from './preflight-routes.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = (f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8');
const never = () => new Promise(() => {});

describe('☠ ONE SLOW SOURCE CANNOT HOLD THE SCREEN', () => {
  it('a promise that never settles is given up on', async () => {
    await expect(withTimeout(never(), 20, 'the models')).rejects.toThrow(/took longer than/);
  });

  it('and the message names WHAT was slow, not just that something was', async () => {
    // "Something timed out" sends you to the logs. "the models took longer
    // than 8s" sends you to the right query.
    await expect(withTimeout(never(), 20, 'the models')).rejects.toThrow(/the models/);
  });

  it('a fast source is untouched', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok');
  });

  it('a source that fails fast keeps its OWN error', async () => {
    // The timeout must not mask a real failure with a generic one.
    await expect(withTimeout(Promise.reject(new Error('connection refused')), 1000, 'x'))
      .rejects.toThrow(/connection refused/);
  });

  it('the timer is cleared, so a slow-but-successful source leaves nothing behind', async () => {
    // An uncleared timer keeps the event loop alive and, in a server, leaks one
    // per request.
    vi.useFakeTimers();
    try {
      const p = withTimeout(Promise.resolve(1), 5000, 'x');
      await p;
      expect(vi.getTimerCount(), 'a timer is still pending after success').toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('the bound is short enough to be read while people are arriving', () => {
    expect(SOURCE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('☠ IT NO LONGER PAYS FOR WORK IT DOES NOT USE', () => {
  const route = src('preflight-routes.js');

  it('does NOT call gatherFacts — that one scans every entities row', () => {
    // Three count(*) FILTER clauses, each extracting result_url from JSONB and
    // splitting it twice, over every GenerationHistory row. Affordable once a
    // morning; not affordable here.
    //
    // Checked against the CODE, not the prose: the header comment discusses
    // gatherFacts on purpose, because why it is not used is the whole story.
    const code = route.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code, 'gatherFacts is back — it brings the entities scan with it')
      .not.toMatch(/gatherFacts\s*\(/);
    expect(code).not.toMatch(/import \{[^}]*gatherFacts/);
  });

  it('uses balanceFacts, which is the two bounded queries', () => {
    expect(route).toMatch(/balanceFacts\(pool, \{ getKieCredits \}\)/);
  });

  it('and balanceFacts really is free of the scan', () => {
    const alerts = src('alerts-routes.js');
    const at = alerts.indexOf('export async function balanceFacts');
    expect(at).toBeGreaterThan(-1);
    const body = alerts.slice(at, alerts.indexOf('\n}', at));
    expect(body, 'balanceFacts touches entities').not.toMatch(/FROM entities/);
    expect(body).toMatch(/FROM credits_history/);
  });

  it('the SOP tab still gets the same numbers from the same place', () => {
    // Shared, not copied — or the two screens could report different balances.
    const alerts = src('alerts-routes.js');
    expect(alerts).toMatch(/Object\.assign\(facts, await balanceFacts\(/);
  });

  it('every source goes through settle(), and settle() is what bounds them', () => {
    // The specific fix was one query. The GENERAL fix is that nothing runs
    // unbounded, so the next slow source degrades one line instead of hanging
    // the screen.
    const code = route.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // Six sources: alerts, balance, models, codes, and — only when a code is
    // given — the cohort row, its invites, and whether its credits are alive.
    const named = [...code.matchAll(/settle\('([a-z-]+)'/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set([
      'alerts', 'balance', 'models', 'codes', 'cohort', 'invites', 'credits-alive',
    ]));
    // and settle is the thing that applies the clock
    expect(code).toMatch(/withTimeout\(fn\(\), SOURCE_TIMEOUT_MS, what\)/);
  });
});

describe('and a slow press is diagnosable afterwards', () => {
  it('the server logs per-source timings', () => {
    // The first slow press left NOTHING on the server saying which part it
    // was, so the diagnosis was reasoning rather than measurement.
    expect(src('preflight-routes.js')).toMatch(/\[preflight\]/);
    expect(src('preflight-routes.js')).toMatch(/timings\[what\] = Date\.now\(\) - started/);
  });

  it('and the timings reach the response too', () => {
    expect(src('preflight-routes.js')).toMatch(/\n\s*timings,/);
  });
});
