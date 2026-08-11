// ─── video-charges.test.js ───────────────────────────────────────────────────
// H4 (security audit 2026-07-28): async video charges lived in an in-memory
// Map, so a restart between "job submitted" and "job failed" erased the
// record and the user was never refunded. These tests run the real module
// against an in-memory fake of the pending_video_charges table, and prove:
//
//   • a restart between submission and failure still refunds (the finding)
//   • the refund happens EXACTLY once under concurrent pollers
//   • a completed job is settled and never refunded
//   • the refunded amount is the amount charged, unchanged

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory stand-in for the table, honouring the conditional UPDATE
//    semantics the exactly-once guarantee relies on. ──
const rows = new Map();
const refunds = [];
let dbUp = true;

const fakePool = {
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('INSERT INTO pending_video_charges')) {
      const [job_id, user_id, kind, amount, model_id, model_label] = params;
      if (!rows.has(job_id)) {                       // ON CONFLICT DO NOTHING
        rows.set(job_id, {
          job_id, user_id, kind, amount, model_id, model_label,
          status: 'pending', created_at: new Date(0), settled_at: null,
        });
      }
      return { rowCount: 1, rows: [] };
    }

    if (s.startsWith("UPDATE pending_video_charges SET status = 'settled'")) {
      const r = rows.get(params[0]);
      if (!r || r.status !== 'pending') return { rowCount: 0, rows: [] };
      r.status = 'settled'; r.settled_at = new Date();
      return { rowCount: 1, rows: [] };
    }

    if (s.startsWith("UPDATE pending_video_charges SET status = 'refunded'")) {
      const r = rows.get(params[0]);
      // The conditional claim: only a 'pending' row can be taken.
      if (!r || r.status !== 'pending') return { rowCount: 0, rows: [] };
      r.status = 'refunded'; r.settled_at = new Date();
      return { rowCount: 1, rows: [{ user_id: r.user_id, kind: r.kind, amount: r.amount }] };
    }

    if (s.startsWith("UPDATE pending_video_charges SET status = 'pending'")) {
      const r = rows.get(params[0]);
      if (r) { r.status = 'pending'; r.settled_at = null; }
      return { rowCount: r ? 1 : 0, rows: [] };
    }

    if (s.startsWith('SELECT job_id, user_id, kind, amount, model_id, model_label, status FROM pending_video_charges')) {
      const r = rows.get(params[0]);
      return { rowCount: r ? 1 : 0, rows: r ? [r] : [] };
    }

    if (s.includes("WHERE status = 'pending'")) {   // listUnresolvedCharges
      return { rows: [...rows.values()].filter((r) => r.status === 'pending') };
    }

    throw new Error('unexpected SQL in test: ' + s);
  },
};

vi.mock('./db.js', () => ({
  pool: { query: (...a) => fakePool.query(...a) },
  isReady: () => dbUp,
}));

vi.mock('./credits.js', () => ({
  refundCredits: vi.fn(async (args) => { refunds.push(args); }),
}));

const {
  trackVideoCharge, settleVideoCharge, refundFailedVideo,
  getVideoCharge, reconcilePendingCharges,
} = await import('./video-charges.js');

beforeEach(() => { rows.clear(); refunds.length = 0; dbUp = true; });

describe('H4 — the refund survives a server restart', () => {
  it('a job submitted, then the server restarts, then the provider fails → still refunded', async () => {
    // 1. Submit: the charge is recorded (this is the part that used to live
    //    only in process memory).
    await trackVideoCharge('job-restart-1', {
      userId: 7, kind: 'video', cost: 34, modelId: 'kie:jobs:kling-3.0/video',
    });

    // 2. RESTART. Nothing in this test carries process state across — the
    //    record's only home is the table.
    expect((await getVideoCharge('job-restart-1')).status).toBe('pending');

    // 3. Boot reconcile asks the provider, which reports failure.
    const verdict = vi.fn().mockResolvedValue('failed');
    const summary = await reconcilePendingCharges(verdict);

    expect(verdict).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ checked: 1, refunded: 1 });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ userId: 7, kind: 'video', cost: 34 });
    expect((await getVideoCharge('job-restart-1')).status).toBe('refunded');
  });

  it('reconcile settles a job the provider says completed — no refund', async () => {
    await trackVideoCharge('job-ok', { userId: 1, cost: 12, modelId: 'fal-ai/x' });
    const summary = await reconcilePendingCharges(vi.fn().mockResolvedValue('completed'));
    expect(summary).toMatchObject({ refunded: 0, settled: 1 });
    expect(refunds).toHaveLength(0);
    expect((await getVideoCharge('job-ok')).status).toBe('settled');
  });

  it('reconcile leaves a still-rendering job pending for the next pass', async () => {
    await trackVideoCharge('job-slow', { userId: 1, cost: 8, modelId: 'fal-ai/x' });
    const summary = await reconcilePendingCharges(vi.fn().mockResolvedValue('pending'));
    expect(summary).toMatchObject({ refunded: 0, settled: 0, stillPending: 1 });
    expect((await getVideoCharge('job-slow')).status).toBe('pending');
  });

  it('a provider error during reconcile leaves the row pending (retried next boot)', async () => {
    await trackVideoCharge('job-err', { userId: 1, cost: 8, modelId: 'fal-ai/x' });
    await reconcilePendingCharges(vi.fn().mockRejectedValue(new Error('provider 503')));
    expect(refunds).toHaveLength(0);
    expect((await getVideoCharge('job-err')).status).toBe('pending');
  });
});

describe('H4 — refunds are exactly-once', () => {
  it('concurrent pollers (two browser tabs) refund only once', async () => {
    await trackVideoCharge('job-race', { userId: 3, kind: 'video', cost: 20 });
    const results = await Promise.all([
      refundFailedVideo('job-race', 'poller A'),
      refundFailedVideo('job-race', 'poller B'),
      refundFailedVideo('job-race', 'poller C'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].cost).toBe(20);
  });

  it('a poller refund and the boot reconcile cannot double-refund', async () => {
    await trackVideoCharge('job-both', { userId: 3, cost: 15, modelId: 'fal-ai/x' });
    const [pollerRefunded] = await Promise.all([
      refundFailedVideo('job-both', 'status poll saw FAILED'),
      reconcilePendingCharges(vi.fn().mockResolvedValue('failed')),
    ]);
    expect(pollerRefunded).toBe(true);
    expect(refunds).toHaveLength(1);
  });

  it('a settled job can never be refunded afterwards', async () => {
    await trackVideoCharge('job-done', { userId: 3, cost: 15 });
    await settleVideoCharge('job-done');
    expect(await refundFailedVideo('job-done', 'late failure claim')).toBe(false);
    expect(refunds).toHaveLength(0);
  });

  it('an unknown job id refunds nothing', async () => {
    expect(await refundFailedVideo('never-existed', 'x')).toBe(false);
    expect(refunds).toHaveLength(0);
  });

  it('duplicate submissions of the same job id keep ONE record', async () => {
    await trackVideoCharge('job-dup', { userId: 5, cost: 10 });
    await trackVideoCharge('job-dup', { userId: 5, cost: 10 });
    expect(rows.size).toBe(1);
    await refundFailedVideo('job-dup', 'failed');
    expect(refunds).toHaveLength(1);
  });
});

describe('H4 — the charged amount is refunded unchanged', () => {
  it('refunds exactly what was charged, for several amounts', async () => {
    for (const [job, amount] of [['a', 34], ['b', 7.5], ['c', 41.5]]) {
      await trackVideoCharge(job, { userId: 1, cost: amount });
      await refundFailedVideo(job, 'failed');
    }
    expect(refunds.map((r) => r.cost)).toEqual([34, 7.5, 41.5]);
  });

  it('never records a charge with a missing or invalid amount', async () => {
    expect(await trackVideoCharge('bad-1', { userId: 1, cost: 0 })).toBe(false);
    expect(await trackVideoCharge('bad-2', { userId: 1, cost: undefined })).toBe(false);
    expect(await trackVideoCharge('', { userId: 1, cost: 5 })).toBe(false);
    expect(rows.size).toBe(0);
  });
});

describe('H4 — degrades safely without a database', () => {
  it('tracking and refunding no-op (do not throw) when the DB is down', async () => {
    dbUp = false;
    expect(await trackVideoCharge('job-nodb', { userId: 1, cost: 5 })).toBe(false);
    expect(await refundFailedVideo('job-nodb', 'x')).toBe(false);
    expect(await getVideoCharge('job-nodb')).toBe(null);
    expect(await reconcilePendingCharges(vi.fn())).toMatchObject({ checked: 0 });
  });
});

// ─── WHY a charge stays pending (added 2026-08-11) ───────────────────────────
// Production had been logging "refunded 0, settled 0, still pending 124" on
// every boot for days, with no errors anywhere. The cause was structural: every
// give-up path in the verdict function returned the bare string 'pending' and
// logged nothing, so a pass that resolved NOTHING looked identical to one that
// was working normally. 124 charges — real, paid-for subscription credits —
// sat behind that silence.
//
// The verdict function may now answer {verdict, reason}, and the summary
// aggregates the reasons. These tests exist so the diagnosis cannot go quiet
// again.
describe('a pass that resolves nothing must say why', () => {
  it('counts each distinct reason', async () => {
    await trackVideoCharge('j1', { userId: 1, cost: 5, modelId: '' });
    await trackVideoCharge('j2', { userId: 1, cost: 5, modelId: '' });
    await trackVideoCharge('j3', { userId: 1, cost: 5, modelId: 'fal-ai/x' });

    const summary = await reconcilePendingCharges(async (row) =>
      row.model_id
        ? { verdict: 'pending', reason: 'fal-status:IN_QUEUE' }
        : { verdict: 'pending', reason: 'no-model-id' });

    expect(summary.stillPending).toBe(3);
    expect(summary.reasons).toEqual({ 'no-model-id': 2, 'fal-status:IN_QUEUE': 1 });
  });

  // The exact shape of the production mystery: a full pass, nothing resolved,
  // no errors. The summary must name the cause instead of shrugging.
  it('names the cause when NOTHING resolves — the production case', async () => {
    for (let i = 0; i < 5; i++) await trackVideoCharge(`stuck-${i}`, { userId: 1, cost: 5, modelId: '' });

    const summary = await reconcilePendingCharges(async () =>
      ({ verdict: 'pending', reason: 'no-model-id' }));

    expect(summary).toMatchObject({ refunded: 0, settled: 0, stillPending: 5 });
    expect(summary.reasons).toEqual({ 'no-model-id': 5 });
    // Never an empty explanation for a pass that achieved nothing.
    expect(Object.keys(summary.reasons).length).toBeGreaterThan(0);
  });

  it('records a thrown provider error as a reason too, not just a log line', async () => {
    await trackVideoCharge('boom', { userId: 1, cost: 5, modelId: 'fal-ai/x' });
    const summary = await reconcilePendingCharges(vi.fn().mockRejectedValue(new Error('provider 503')));
    expect(Object.keys(summary.reasons).join()).toMatch(/threw:provider 503/);
  });

  // Backward compatibility: the old bare-string contract must keep working, or
  // this change would break the very refunds it is meant to protect.
  it('still accepts a bare string verdict', async () => {
    await trackVideoCharge('old-fail', { userId: 2, cost: 9, modelId: 'fal-ai/x' });
    expect(await reconcilePendingCharges(vi.fn().mockResolvedValue('failed')))
      .toMatchObject({ refunded: 1 });

    await trackVideoCharge('old-pending', { userId: 2, cost: 9, modelId: 'fal-ai/x' });
    const s = await reconcilePendingCharges(vi.fn().mockResolvedValue('pending'));
    expect(s.stillPending).toBe(1);
    expect(s.reasons).toEqual({ unknown: 1 });   // unexplained, but counted
  });
});
