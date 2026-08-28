// ─── slow-image.js ───────────────────────────────────────────────────────────
// An image that arrives after we stopped waiting must still reach the customer.
//
// ── THE BUG THIS IS THE FIX FOR (production, 2026-08-28) ───────────────────
// Six customers were told "the image is taking longer than expected, so we
// stopped and refunded your credits". I took the six task ids out of the
// production log and asked kie what actually happened to them:
//
//     94s · 97s · 125s · 130s · 144s · 314s   — ALL SIX SUCCEEDED
//
// We give up at 90 seconds. The first one finished FOUR SECONDS later. That
// was 6 of 19 attempts in one afternoon — roughly one image in three — and we
// paid kie for every one of them. Our own code already said so out loud:
// "we refund the user but ate the kie cost".
//
// ── WHY NOT SIMPLY WAIT LONGER ─────────────────────────────────────────────
// Because the 90s is not arbitrary and raising it does not work. The comment
// at the call site gives the reason: Cloudflare cuts a proxied request at
// about 100 seconds. A longer timeout would just move the failure from our
// code, where it is visible and refundable, into the edge, where it is
// neither. The request has to END; the JOB must not.
//
// ── THE SHAPE ──────────────────────────────────────────────────────────────
// At the deadline the job is HANDED OFF rather than thrown away:
//
//   1. the row is written to pending_image_jobs BEFORE the response goes out
//   2. the response says "still working" and carries the job id
//   3. the browser polls and, when it wins the claim, writes history itself —
//      keeping the camera, lens, style and f-stop it is holding
//   4. a sweeper on the server finishes anything the browser never came back
//      for — a closed tab, a flat battery, a customer who walked away
//
// Step 4 is what makes the promise true. Step 3 only makes it pretty.
//
// ── EXACTLY ONCE, WITH TWO APP INSTANCES ───────────────────────────────────
// Production runs two instances and the customer may have two tabs open, so
// there can be four things racing to deliver one image. The lock is the same
// one the audit already verified for video charges: a CONDITIONAL UPDATE off
// 'pending'. Exactly one caller changes the row; everyone else gets rowCount 0
// and does nothing. No advisory locks, no leader election, no in-memory flag —
// process memory is what H4 lost in the first place.

/**
 * Where handed-off jobs live until they are resolved.
 *
 * It holds enough to rebuild a history row WITHOUT the browser: if the tab is
 * gone, the sweeper is the only thing left that knows what the customer asked
 * for. It deliberately does NOT hold the camera metadata — that lives in React
 * state, and inventing a default for it would write a lie into history. A
 * sweeper-written row is honestly sparse instead.
 */
export const SLOW_IMAGE_DDL = `
  CREATE TABLE IF NOT EXISTS pending_image_jobs (
    task_id     VARCHAR(255) PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family      VARCHAR(64)  NOT NULL,
    model_label VARCHAR(255),
    prompt      TEXT,
    ratio       VARCHAR(32),
    quality     VARCHAR(32),
    status      VARCHAR(16)  NOT NULL DEFAULT 'pending',
    result_url  TEXT,
    attempts    INTEGER      NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    settled_at  TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_pending_image_jobs_open
    ON pending_image_jobs (status, created_at) WHERE status = 'pending';
`;

export const RECORD_SQL = `
  INSERT INTO pending_image_jobs
         (task_id, user_id, family, model_label, prompt, ratio, quality)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (task_id) DO NOTHING`;

/**
 * The lock. Whoever wins this UPDATE owns delivering the image — and NOBODY
 * else may write a history row for it. rowCount 0 means "someone got there
 * first", which is a success, not an error.
 */
export const CLAIM_SQL = `
  UPDATE pending_image_jobs
     SET status = 'delivered', result_url = $2, settled_at = NOW()
   WHERE task_id = $1 AND status = 'pending'
  RETURNING user_id, model_label, prompt, ratio, quality`;

export const GIVE_UP_SQL = `
  UPDATE pending_image_jobs
     SET status = 'refunded', last_error = $2, settled_at = NOW()
   WHERE task_id = $1 AND status = 'pending'
  RETURNING user_id`;

export const TOUCH_SQL = `
  UPDATE pending_image_jobs
     SET attempts = attempts + 1, last_error = $2
   WHERE task_id = $1 AND status = 'pending'`;

/** Open jobs, oldest first — the ones closest to giving up get looked at first. */
export const DUE_SQL = `
  SELECT task_id, user_id, family, model_label, prompt, ratio, quality, created_at,
         EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS age_ms
    FROM pending_image_jobs
   WHERE status = 'pending'
   ORDER BY created_at ASC
   LIMIT $1`;

/** Does this user own this job? Read before ever returning a url to a browser. */
export const OWNS_SQL = `
  SELECT status, result_url FROM pending_image_jobs WHERE task_id = $1 AND user_id = $2`;

/**
 * How long a handed-off job is chased before the customer gets their credits
 * back instead of an image.
 *
 * Twenty minutes against a worst observed case of 314 seconds — roughly four
 * times the slowest real one. Generous on purpose: the failure we are fixing
 * was being too impatient, and a refund issued at nineteen minutes is a far
 * smaller mistake than one issued at ninety seconds.
 */
export const GIVE_UP_AFTER_MS = 20 * 60 * 1000;

/**
 * What to do with one job, given what the provider just said about it.
 *
 * Pure, and separated from all the plumbing, because the ONE thing that must
 * never happen is refunding a job that succeeded — which is the entire bug.
 *
 * @param task  {state:'success'|'fail'|'pending', resultUrls?, failMsg?}
 * @param ageMs how long since the customer pressed Generate
 * @returns {{do:'deliver', url}|{do:'refund', why}|{do:'wait'}}
 */
export function verdictFor(task, ageMs) {
  // Success first, and before ANY age check. A job that succeeded at minute
  // nineteen is delivered, not swept — the deadline exists to stop waiting
  // forever, never to discard an answer we already have.
  if (task?.state === 'success') {
    const url = task.resultUrls?.[0];
    // "Succeeded with nothing in it" is a failure wearing a success's clothes.
    // Delivering it would write a history row pointing at nothing.
    if (!url) return { do: 'refund', why: 'the provider reported success but returned no image' };
    return { do: 'deliver', url };
  }
  if (task?.state === 'fail') {
    return { do: 'refund', why: task.failMsg || 'the model could not complete this generation' };
  }
  // Still working. Only now does age matter.
  if (Number(ageMs) >= GIVE_UP_AFTER_MS) {
    return { do: 'refund', why: `still not finished after ${Math.round(GIVE_UP_AFTER_MS / 60000)} minutes` };
  }
  return { do: 'wait' };
}

/**
 * Work through the open jobs.
 *
 * Everything is injected so this runs under test without a database, a
 * network or a bucket. Returns a report rather than throwing: one bad job must
 * not stop the other nineteen from being delivered.
 *
 * @param deps.check    (family, taskId) => task           ask the provider
 * @param deps.persist  (url) => durableUrl                re-host to our bucket
 * @param deps.claim    (taskId, url) => row|null          the exactly-once lock
 * @param deps.giveUp   (taskId, why) => userId|null       the same lock, losing
 * @param deps.saveRow  (row, url) => void                 write the history row
 * @param deps.settle   (taskId) => void                   charge kept
 * @param deps.refund   (taskId, why) => void              credits back
 * @param deps.touch    (taskId, note) => void             record a failed look
 */
export async function sweepJobs(rows, deps) {
  const report = { looked: 0, delivered: 0, refunded: 0, waiting: 0, problems: [] };

  for (const row of rows || []) {
    report.looked += 1;
    try {
      const task = await deps.check(row.family, row.task_id);
      const verdict = verdictFor(task, row.age_ms);

      if (verdict.do === 'wait') { report.waiting += 1; continue; }

      if (verdict.do === 'refund') {
        const userId = await deps.giveUp(row.task_id, verdict.why);
        // Lost the race — somebody already delivered it. Refunding now would
        // hand back credits for an image the customer HAS.
        if (!userId) continue;
        await deps.refund(row.task_id, verdict.why);
        report.refunded += 1;
        continue;
      }

      // ── deliver ──
      // Re-host BEFORE claiming. kie's urls expire in about 14 days, so a
      // history row pointing at one is a picture with a fuse on it — the same
      // reason FAL outputs are re-hosted. If this throws we have NOT claimed,
      // the row stays 'pending', and the next sweep tries again.
      const durable = await deps.persist(verdict.url);

      const claimed = await deps.claim(row.task_id, durable);
      if (!claimed) continue;                       // the browser got there first

      // Order matters: history FIRST, then settle. If writing history throws,
      // the settle does not happen and the charge stays pending — visible and
      // refundable. Settling first would leave a paid-for image that exists
      // nowhere the customer can see, which is the bug we are fixing wearing a
      // different hat.
      await deps.saveRow(claimed, durable);
      await deps.settle(row.task_id);
      report.delivered += 1;
    } catch (e) {
      const why = e?.message || String(e);
      report.problems.push({ taskId: row.task_id, why });
      // Counted, so a job that fails to be looked at forever is visible rather
      // than quietly retried until it ages out.
      await deps.touch?.(row.task_id, why).catch?.(() => {});
    }
  }
  return report;
}

/**
 * The history row a SWEEPER writes — used only when the browser never came
 * back, so there is no camera metadata to be had.
 *
 * `late: true` is not decoration. It marks the rows written without a browser,
 * so "how often does the hand-off actually fire?" is answerable from the data
 * later instead of from a guess.
 */
export function historyRowFor(job, url) {
  return {
    type: 'image',
    model: job.model_label || 'Image',
    prompt: job.prompt || '',
    result_url: url,
    status: 'completed',
    ratio: job.ratio || null,
    quality: job.quality || null,
    late: true,
  };
}
