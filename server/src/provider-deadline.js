// ─── provider-deadline.js ────────────────────────────────────────────────────
// H3 (security audit 2026-07-28): synchronous provider calls (fal.subscribe)
// had no overall timeout. A hung provider held the HTTP request and its DB
// connection open indefinitely while the user's credits stayed spent — the
// user saw a spinner forever and never got their credits back.
//
// This wraps any provider call in a hard deadline. On expiry the call is
// ABORTED (via the AbortSignal handed to the worker) and a
// ProviderTimeoutError is thrown, which each route's EXISTING catch block
// turns into a refund through the EXISTING refund path.
//
// Mirrors the ~90s cap the kie polling path already uses; configurable via
// PROVIDER_TIMEOUT_MS so it can be tuned without a code change.

export const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 90_000);

export class ProviderTimeoutError extends Error {
  constructor(label, ms) {
    super(
      `The model did not respond within ${Math.round(ms / 1000)} seconds. ` +
      `Your credits have been refunded — please try again.`
    );
    this.name = 'ProviderTimeoutError';
    this.label = label;
    this.timeoutMs = ms;
  }
}

/**
 * Run a provider call under a deadline.
 *
 * @param {(signal: AbortSignal) => Promise<any>} work  receives an AbortSignal
 *        it must pass to the provider client so the call is really cancelled.
 * @param {string} label   log tag, e.g. 'FAL-IMAGE'
 * @param {number} timeoutMs
 * @returns the work's result; throws ProviderTimeoutError on expiry.
 */
export async function withProviderDeadline(work, label = 'provider', timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      console.error(`[${label}] provider deadline hit after ${timeoutMs}ms — aborting call, refunding user`);
      reject(new ProviderTimeoutError(label, timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
