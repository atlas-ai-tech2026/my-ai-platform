// ─── wait-for-image.js ───────────────────────────────────────────────────────
// Keep waiting for an image the server handed off.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The server stops holding the request open at 90 seconds because Cloudflare
// cuts a proxied request at about 100. On 2026-08-28 that meant six customers
// were told their image had failed when all six had actually succeeded — at
// 94, 97, 125, 130, 144 and 314 seconds — and we had paid for every one.
//
// The server now hands the job off and keeps finishing it. This is the
// browser's half: it keeps asking until the picture arrives, so the customer
// sees it appear instead of reloading the page later and finding it there.
//
// ── THE ONE RULE ───────────────────────────────────────────────────────────
// GIVING UP HERE MUST NOT LOOK LIKE FAILING. If this stops asking, the image
// is still coming and the server's sweeper will still deliver it into history.
// So the timeout resolves to "still working", never to an error — telling a
// customer it failed while it is being delivered is the exact bug again,
// moved into the front end.
//
// A network blip is likewise not a failure. Only the SERVER saying FAILED is.

export const POLL_EVERY_MS = 4000;

/**
 * Wait a little longer than the server's own give-up window (20 minutes), so
 * the browser never announces a verdict the server has not reached yet.
 */
export const STOP_ASKING_AFTER_MS = 21 * 60 * 1000;

export class ImageFailed extends Error {}

/**
 * @param poll   (jobId) => {status, image_url?, already?, error?}
 * @param onTick (seconds) => void   for "still working, 2m 10s"
 * @returns {{done:false}}                     stopped asking; it is still coming
 *          {{done:true, url, already}}        it arrived
 * @throws  ImageFailed                        the SERVER said it failed
 */
export async function waitForImage(jobId, {
  poll,
  onTick,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  intervalMs = POLL_EVERY_MS,
  maxMs = STOP_ASKING_AFTER_MS,
} = {}) {
  const started = now();

  for (;;) {
    let answer = null;
    try {
      answer = await poll(jobId);
    } catch {
      // A blip, a sleeping laptop, a dropped connection. The job is unaffected
      // — swallow it and ask again. Treating this as failure would be the
      // front end inventing bad news about a healthy job.
      answer = null;
    }

    if (answer?.status === 'COMPLETED' && answer.image_url) {
      // `already` means something else — the sweeper, or another tab — has
      // written the history row. Writing a second one shows the customer the
      // same picture twice.
      return { done: true, url: answer.image_url, already: !!answer.already };
    }
    if (answer?.status === 'FAILED') {
      throw new ImageFailed(answer.error || 'That image could not be finished — your credits are back.');
    }

    const waited = now() - started;
    if (waited + intervalMs >= maxMs) return { done: false };

    onTick?.(Math.round(waited / 1000));
    await sleep(intervalMs);
  }
}

/** "2m 10s" — a wait with a number on it reads as progress; a spinner does not. */
export function waitedLabel(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
