// ─── provider-error.js ───────────────────────────────────────────────────────
// Getting the PROVIDER's actual words out of a thrown error.
//
// ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
// Earned on 2026-08-23. The Edit Cut agent failed twice on dev and the entire
// record of it was:
//
//     [EDIT-AGENT] ❌ Forbidden
//     [EDIT-AGENT] ❌ Forbidden
//
// No status, no body, nothing to act on. `e.message` on a fal-client error is
// frequently just the HTTP reason phrase; the REASON — an exhausted balance, a
// key without access to that endpoint, a rejected input — is in `e.body`.
// Logging only the message turned a fixable account problem into a mystery,
// and cost a round trip through the owner to even start diagnosing.
//
// So: extracted here, unit tested against the shapes these errors really
// arrive in, rather than living inline where nothing can check it.

/**
 * Pull the useful parts out of whatever was thrown.
 *
 * Providers reach us through two clients with different shapes — the fal
 * client puts things on the error itself, axios nests them under `response` —
 * and a plain Error has neither. All three have to work; the whole point is
 * that this never makes a bad situation harder to read.
 */
export function providerErrorParts(error) {
  const status = error?.status ?? error?.response?.status ?? null;
  const body = error?.body ?? error?.response?.data ?? null;
  return { status, message: error?.message || 'unknown error', body };
}

/**
 * 401/403 from a provider is an ACCOUNT problem: a key without access to the
 * endpoint, or a spent balance.
 *
 * Worth separating because it is never the customer's fault and never worth
 * "please try again" — which is exactly what a generic 500 invites them to do,
 * forever, against something that cannot start working until somebody changes
 * a key or pays a bill.
 */
export const isProviderRefusal = (status) => status === 401 || status === 403;

/**
 * One line for the log, plus the body on a second line when there is one.
 *
 * Truncated: a provider that answers an error with an entire HTML page should
 * not push everything else out of a log buffer that only holds a few hundred
 * lines — which is exactly how the first two failures ended up with no
 * surrounding context to read.
 */
export function formatProviderError(tag, error, { limit = 1000 } = {}) {
  const { status, message, body } = providerErrorParts(error);
  const lines = [`[${tag}] ❌ ${status ?? '???'} ${message}`];
  if (body !== null && body !== undefined) {
    let text;
    try { text = typeof body === 'string' ? body : JSON.stringify(body); }
    catch { text = String(body); }
    if (text && text !== '{}' && text !== '""') {
      lines.push(`[${tag}]    provider said: ${text.slice(0, limit)}`);
    }
  }
  return lines;
}
