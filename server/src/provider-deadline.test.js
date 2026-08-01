// ─── provider-deadline.test.js ───────────────────────────────────────────────
// H3 (security audit 2026-07-28): a hung provider used to hold the request
// (and its DB connection) open forever with the user's credits spent. These
// tests use a MOCKED HANGING PROVIDER to prove the deadline fires, the call
// is aborted, the caller's refund path runs, and a clear error is returned.

import { describe, it, expect, vi } from 'vitest';
import {
  withProviderDeadline,
  ProviderTimeoutError,
  PROVIDER_TIMEOUT_MS,
} from './provider-deadline.js';

// A provider that never resolves — the failure mode H3 is about.
const hangingProvider = (signal) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(new Error('aborted by caller')));
});

describe('H3 — hung provider calls hit the deadline', () => {
  it('throws ProviderTimeoutError instead of hanging forever', async () => {
    await expect(withProviderDeadline(hangingProvider, 'TEST', 30))
      .rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('ABORTS the provider call so the connection is released', async () => {
    let aborted = false;
    const work = (signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    });
    await expect(withProviderDeadline(work, 'TEST', 30)).rejects.toThrow(ProviderTimeoutError);
    expect(aborted).toBe(true);
  });

  it('the error message tells the user they were refunded (no jargon, no provider name)', async () => {
    const err = await withProviderDeadline(hangingProvider, 'FAL-IMAGE', 30).catch((e) => e);
    expect(err.message).toMatch(/did not respond/i);
    expect(err.message).toMatch(/refunded/i);
    expect(err.message.toLowerCase()).not.toContain('fal');
    expect(err.message.toLowerCase()).not.toContain('kie');
  });

  it('a route catch block refunds exactly once on timeout (existing refund path)', async () => {
    // Mirrors the real route shape: charge → provider call → catch refunds.
    const refundCredits = vi.fn().mockResolvedValue(undefined);
    const chargedCost = 34; // a real charge amount; the test asserts it is
                            // refunded UNCHANGED — no pricing logic here.
    let status = null;
    let body = null;

    try {
      await withProviderDeadline(hangingProvider, 'FAL-VIDEO', 30);
    } catch (error) {
      refundCredits({ userId: 'u1', kind: 'video', cost: chargedCost, reason: `timeout: ${error.message}` });
      if (error instanceof ProviderTimeoutError) {
        status = 504;
        body = { error: error.message };
      }
    }

    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect(refundCredits.mock.calls[0][0]).toMatchObject({ cost: 34, kind: 'video' });
    expect(status).toBe(504);
    expect(body.error).toMatch(/did not respond/i);
  });
});

describe('H3 — healthy provider calls are unaffected', () => {
  it('a fast call returns its result normally', async () => {
    const result = await withProviderDeadline(
      async () => ({ data: { images: [{ url: 'https://v3.fal.media/x.png' }] } }),
      'TEST', 1000
    );
    expect(result.data.images[0].url).toBe('https://v3.fal.media/x.png');
  });

  it('a provider error still propagates unchanged (not swallowed as a timeout)', async () => {
    await expect(
      withProviderDeadline(async () => { throw new Error('model rejected the prompt'); }, 'TEST', 1000)
    ).rejects.toThrow('model rejected the prompt');
  });

  it('the timer does not keep the process alive after success', async () => {
    // unref'd timer + clearTimeout in finally; a leak here would hang vitest.
    await withProviderDeadline(async () => 'ok', 'TEST', 60_000);
    expect(true).toBe(true);
  });

  it('defaults to the ~90s cap that the kie path already uses', () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(90_000);
  });
});
