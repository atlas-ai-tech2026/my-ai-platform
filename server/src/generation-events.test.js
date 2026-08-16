// ─── generation-events.test.js ───────────────────────────────────────────────
// Telemetry that can break a customer's generation is worse than no telemetry.
// That is the property most of this file is aimed at: every function here must
// swallow its own failure, because it sits directly in the charge and refund
// paths that decide whether someone gets what they paid for.
//
// The rest is about where it hooks in. Instrumenting fifteen routes is exactly
// how the 124-stuck-charge bug happened — eight of ten call sites silently
// forgot to pass modelId for weeks. So recording hangs off chargeCredits() and
// refundCredits(), which every route already goes through, and the tests below
// assert that wiring rather than trusting it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelFrom, recordAttempt, settleAttempt, sweepStale } from './generation-events.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const credits = readFileSync(path.join(here, 'credits.js'), 'utf8');
const videoCharges = readFileSync(path.join(here, 'video-charges.js'), 'utf8');
const schema = readFileSync(path.join(here, 'db.js'), 'utf8');

const fakeClient = (impl) => ({ query: vi.fn(impl) });

describe('reading the model out of a spend note', () => {
  it('strips the kind prefix the ledger already writes', () => {
    expect(labelFrom('image: Nano Banana Pro')).toBe('Nano Banana Pro');
    expect(labelFrom('video: Kling 3.0')).toBe('Kling 3.0');
  });

  it('returns null rather than a junk label', () => {
    for (const n of [null, '', 'no prefix', undefined]) expect(labelFrom(n)).toBeNull();
  });
});

describe('telemetry must never break a generation', () => {
  beforeEach(() => vi.restoreAllMocks());

  // The property that matters most. A missing analytics row is a nuisance; a
  // failed charge is a customer not getting what they paid for.
  it('recordAttempt returns null instead of throwing when the insert fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient(async () => { throw new Error('table is gone'); });
    await expect(recordAttempt({ userId: 1, kind: 'image' }, client)).resolves.toBeNull();
  });

  it('settleAttempt swallows its own failure so a refund still completes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient(async () => { throw new Error('nope'); });
    await expect(settleAttempt({ userId: 1, outcome: 'failed' }, client)).resolves.toBeUndefined();
  });

  it('sweepStale reports 0 rather than throwing inside a scheduled job', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient(async () => { throw new Error('nope'); });
    await expect(sweepStale(6, client)).resolves.toBe(0);
  });

  it('does nothing at all when given neither an id nor a user', async () => {
    const client = fakeClient(async () => ({ rows: [] }));
    await settleAttempt({ outcome: 'delivered' }, client);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('closing the right attempt', () => {
  it('closes by id when one is known', async () => {
    const client = fakeClient(async () => ({ rows: [], rowCount: 1 }));
    await settleAttempt({ eventId: 42, outcome: 'delivered' }, client);
    expect(client.query.mock.calls[0][0]).toMatch(/WHERE id = \$1/);
    expect(client.query.mock.calls[0][1][0]).toBe(42);
  });

  // A route that never learned to thread an id still produces correct data.
  // The window is seconds here — the same request — not the thirty minutes the
  // Reliability inference has to allow.
  it('falls back to the user’s most recent open attempt', async () => {
    const client = fakeClient(async () => ({ rows: [], rowCount: 1 }));
    await settleAttempt({ userId: 7, outcome: 'failed', reason: 'kie_threw: timeout' }, client);
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/user_id = \$1/);
    expect(sql).toMatch(/outcome = 'pending'/);
    expect(sql).toMatch(/ORDER BY created_at DESC LIMIT 1/);
  });

  it('measures duration from the row itself rather than trusting a caller', () => {
    const client = fakeClient(async () => ({ rows: [], rowCount: 0 }));
    settleAttempt({ eventId: 1, outcome: 'delivered' }, client);
    expect(client.query.mock.calls[0][0]).toMatch(/NOW\(\) - created_at/);
  });

  it('never re-closes an attempt that is already settled', async () => {
    const client = fakeClient(async () => ({ rows: [], rowCount: 0 }));
    await settleAttempt({ eventId: 1, outcome: 'delivered' }, client);
    expect(client.query.mock.calls[0][0]).toMatch(/outcome = 'pending'/);
  });
});

describe('wired into the paths every route already uses', () => {
  // Not fifteen call sites. One charge function and one refund function.
  it('opens an attempt from chargeCredits', () => {
    expect(credits).toMatch(/recordAttempt\(\{ userId, kind, note, provider/);
  });

  // Inside the transaction a failed insert would abort it and take the
  // customer's charge with it.
  it('records AFTER the charge commits, not inside its transaction', () => {
    const commit = credits.indexOf("await client.query('COMMIT');");
    const record = credits.indexOf('recordAttempt(');
    expect(commit).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(commit);
  });

  it('closes the attempt as failed from refundCredits', () => {
    expect(credits).toMatch(/settleAttempt\(\{ userId, outcome: 'failed', reason \}\)/);
  });

  // A 200 from the video route means "accepted", not "delivered" — settling
  // there would mark every stuck job a success.
  it('marks video delivered from settleVideoCharge, not from the HTTP response', () => {
    expect(videoCharges).toMatch(/settleAttempt\(\{ userId: rows\[0\]\.user_id, outcome: 'delivered' \}\)/);
    expect(videoCharges).toMatch(/RETURNING user_id/);
  });
});

describe('the schema', () => {
  it('exists with the three things nothing recorded before', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS generation_events/);
    for (const col of ['model_label', 'outcome', 'duration_ms']) {
      expect(schema).toMatch(new RegExp(col));
    }
  });

  // "We never found out" is its own answer. Counting a closed browser tab as
  // either success or failure would be a guess.
  it('has a distinct outcome for attempts that never reported back', () => {
    expect(schema).toMatch(/'unknown' is deliberate/);
  });

  it('indexes by model so the Reliability query stays fast', () => {
    expect(schema).toMatch(/generation_events_model_idx/);
  });
});
