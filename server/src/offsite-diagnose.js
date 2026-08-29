// ─── offsite-diagnose.js ─────────────────────────────────────────────────────
// When the offsite listing fails, say WHICH of two very different things broke.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// For three nights the log has said exactly one thing:
//
//     [media-sync] could not list the offsite bucket: the request socket did
//     not establish a connection with the server within the configured timeout
//
// That single sentence covers two problems with completely different fixes:
//
//   A. BACKBLAZE IS UNREACHABLE from our server — network, routing, throttling,
//      or their side refusing us. Nothing about listing is special; everything
//      would fail.
//   B. BACKBLAZE IS REACHABLE and LISTING SPECIFICALLY fails — the assumption
//      we have been working from for a week, and the reason two connection
//      pools were tried last night. That fix made no difference.
//
// We have guessed between them three times. From this laptop Backblaze answers
// in 0.14 seconds, so the endpoint itself is healthy — but that says nothing
// about the route from a DigitalOcean container in New York.
//
// So instead of a fourth guess: when a listing fails, immediately make the
// CHEAPEST possible request — one HEAD for one key — and let the two outcomes
// separate themselves.
//
// ── IT MUST NOT MAKE ANYTHING WORSE ────────────────────────────────────────
// One extra request every fifteen minutes, only after something has already
// failed, with its own short deadline. It never throws, never writes, and its
// result is only ever a log line. A diagnostic that can break the thing it is
// diagnosing is worse than no diagnostic.

/** Short on purpose. This runs after a failure, to characterise it — not to
 *  succeed at anything. Waiting a long time here would delay the next sync. */
export const PROBE_TIMEOUT_MS = 8000;

/** A key that certainly does not exist. NotFound is the SUCCESS case: it proves
 *  the round trip worked, credentials and all, without listing anything. */
export const PROBE_KEY = '__voxel_reachability_probe__/does-not-exist';

/**
 * Ask the cheapest possible question.
 *
 * @param head  (key) => Promise  — resolves if the object exists, throws
 *              NotFound if it does not. BOTH mean reachable.
 * @returns {{reachable:boolean|null, ms:number, error:string|null}}
 *          null = the probe itself could not run, which is not the same as
 *          unreachable and must not be reported as if it were.
 */
export async function probeOffsite({ head, timeoutMs = PROBE_TIMEOUT_MS, now = () => Date.now() }) {
  const started = now();
  if (typeof head !== 'function') return { reachable: null, ms: 0, error: 'no probe available' };

  let timer;
  try {
    await Promise.race([
      head(PROBE_KEY),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { reachable: true, ms: now() - started, error: null };
  } catch (e) {
    // ALL THREE, joined. The first version read `name || Code || message`,
    // and a plain `new Error('NotFound')` has name 'Error' — so the strongest
    // possible proof of reachability was being read as a connection failure,
    // inverting the entire diagnosis. Found by the test, not by reasoning.
    const msg = [e?.name, e?.Code, e?.$metadata?.httpStatusCode, e?.message]
      .filter(Boolean).join(' ');
    // NotFound / NoSuchKey is a COMPLETE round trip: DNS, TCP, TLS, signature,
    // and an answer.
    if (/NotFound|NoSuchKey|404/i.test(msg)) {
      return { reachable: true, ms: now() - started, error: null };
    }
    return { reachable: false, ms: now() - started, error: e?.message || msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn "listing failed" plus a probe into a sentence somebody can act on.
 *
 * @returns {{verdict, detail, action}}
 */
export function diagnose(listError, probe) {
  const why = listError?.message || String(listError || 'unknown');

  if (!probe || probe.reachable === null) {
    // Could not even ask. NOT reported as either answer — that is the mistake
    // this module exists to stop.
    return {
      verdict: 'unknown',
      detail: `listing failed (${why}) and the reachability probe could not run`,
      action: 'No conclusion. Do not treat this as either cause.',
    };
  }

  if (probe.reachable) {
    return {
      verdict: 'listing-only',
      detail: `Backblaze ANSWERED a single-object request in ${probe.ms}ms, but listing failed: ${why}`,
      action: 'The connection is fine and LISTING specifically is not. That points at the size of '
        + 'the listing — tens of thousands of objects — rather than at the network. Next step: page '
        + 'the listing in smaller chunks, or stop needing a full listing at all.',
    };
  }

  return {
    verdict: 'unreachable',
    detail: `Backblaze could not be reached at all — a single-object request also failed after `
      + `${probe.ms}ms (${probe.error}). Listing failed with: ${why}`,
    action: 'Nothing about listing is special; the route from this container to Backblaze is the '
      + 'problem. Next step: their side, or the network between — NOT our listing code. Three '
      + 'nights of fixes have assumed the opposite.',
  };
}

/** One line for the log. Deliberately loud: it is the answer to a question
 *  that has been open for a week. */
export function diagnosisLine(d) {
  return `[offsite-diagnosis] ${d.verdict.toUpperCase()} — ${d.detail} · ${d.action}`;
}
