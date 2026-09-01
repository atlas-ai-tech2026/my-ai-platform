// ─── onboarding.js ───────────────────────────────────────────────────────────
// The first-run questions: storing the answers, and answering the questions
// Amr will ask about them.
//
// ── WHY A COLUMN AND NOT THE BROWSER ───────────────────────────────────────
// `onboarded_at` on users, NULL meaning "show it". There are FOUR signup paths
// — email, Google, Microsoft and admin-created — and a new column defaults to
// NULL for every one of them, so no path can forget. If each had to set a flag
// the Microsoft one would eventually miss it and nobody would notice.
//
// localStorage was the alternative and is wrong: sign up on a phone, open a
// laptop, and it appears twice.
//
// ── AND WHY ANSWERS ARE JSONB ──────────────────────────────────────────────
// Amr will change these questions once he sees what people answer. A column
// per question would make every reword a migration; jsonb keyed by the ids in
// src/lib/onboarding-questions.js makes it an edit to one file.

/** Bumped only if the stored shape changes, so old rows are never misread. */
export const SCHEMA_VERSION = 1;

/** Written when somebody REACHES a question and declines it. */
export const SKIPPED = '__skipped';

export const MIGRATION_SQL = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding   JSONB;`,
  // ── THE EXISTING CUSTOMERS DO NOT SEE IT ─────────────────────────────
  // Asking somebody who has used Voxel for months how they found it gets a
  // guess, not a fact — and it would poison the very statistics this exists to
  // produce. Runs once: after this, every existing row is non-NULL, so a
  // re-run matches nothing.
  `UPDATE users SET onboarded_at = created_at WHERE onboarded_at IS NULL;`,
];

/** Answers so far, plus how far they got. */
export const READ_SQL = `SELECT onboarded_at, onboarding FROM users WHERE id = $1`;

/**
 * Merge one screen's answers into whatever is stored.
 *
 * ── SAVED PER SCREEN, NOT AT THE END ───────────────────────────────────────
 * Somebody who quits on screen 2 still tells us where they came from. Saving
 * only on completion loses exactly the people worth understanding.
 */
export const SAVE_STEP_SQL = `
  UPDATE users
     SET onboarding = COALESCE(onboarding, '{}'::jsonb) || $2::jsonb
   WHERE id = $1
  RETURNING onboarding`;

export const FINISH_SQL = `
  UPDATE users SET onboarded_at = NOW(),
         onboarding = COALESCE(onboarding, '{}'::jsonb) || $2::jsonb
   WHERE id = $1`;

/**
 * Build the jsonb patch for one screen.
 *
 * @param screenId  which screen
 * @param answers   { questionId: value }  — value may be SKIPPED
 * @param index     0-based screen number, for the furthest-reached counter
 * @param ms        how long they spent on this screen
 */
export function stepPatch({ screenId, answers = {}, index = 0, ms = null } = {}) {
  const at = new Date().toISOString();
  const out = { v: SCHEMA_VERSION, reached: index + 1, answers: {} };
  for (const [id, value] of Object.entries(answers)) {
    // A timestamp per answer is what makes "seconds per screen" possible. A
    // question averaging forty seconds is one people are struggling with, and
    // counts alone would never show it.
    out.answers[id] = { value, at, screen: screenId };
    if (Number.isFinite(Number(ms))) out.answers[id].ms = Math.max(0, Math.round(Number(ms)));
  }
  return out;
}

/**
 * Merge a patch into the stored object the same way Postgres's `||` does, so a
 * test and the database cannot disagree about the result.
 *
 * `||` is a SHALLOW merge, which would replace the whole `answers` object and
 * lose every earlier screen. So `answers` is merged by hand here and the SQL
 * is given the already-merged object.
 */
export function merge(existing, patch) {
  const prev = existing && typeof existing === 'object' ? existing : {};
  return {
    ...prev,
    ...patch,
    reached: Math.max(Number(prev.reached) || 0, Number(patch.reached) || 0),
    answers: { ...(prev.answers || {}), ...(patch.answers || {}) },
  };
}

/**
 * Should this customer see the first-run flow?
 *
 * @param row      { onboarded_at }
 * @param isDev    on a dev host, ALWAYS show it — Amr asked to be able to test
 *                 it repeatedly without making a new account each time.
 */
export function shouldShow(row, isDev = false) {
  if (isDev) return true;
  return !row?.onboarded_at;
}

// ─── STATISTICS ─────────────────────────────────────────────────────────────

/**
 * Everyone who was ever shown the flow, with what they answered.
 *
 * Scoped to rows that HAVE an onboarding object: a customer who was backfilled
 * by the migration has onboarded_at set and onboarding NULL, and counting them
 * as "finished without answering" would be a lie that makes the completion
 * rate look terrible forever.
 */
export const STATS_SQL = `
  SELECT id, onboarded_at, onboarding, created_at
    FROM users
   WHERE onboarding IS NOT NULL
   ORDER BY created_at DESC`;

/**
 * Turn the rows into the numbers behind each chart.
 *
 * Pure, so every edge case below is testable without a database — and there
 * are more edge cases here than anywhere else in this feature, because the
 * difference between "skipped" and "never got there" is the whole point.
 */
/**
 * How many screens the flow has.
 *
 * ── IT LIVES IN TWO FILES AND MUST NOT DRIFT ─────────────────────────────
 * The questions are defined in src/lib/onboarding-questions.js, which is
 * front-end and has no business being imported by the server. So the count is
 * repeated here — and onboarding-count.test.js reads BOTH files and fails if
 * they disagree, because a mismatch draws a funnel bar for a screen that does
 * not exist and it would read as "everybody quits at the end".
 */
export const SCREEN_COUNT = 3;

export function summarise(rows = [], screenCount = SCREEN_COUNT) {
  const total = rows.length;
  // reached[i] = how many people got at least as far as screen i+1
  const reached = new Array(screenCount).fill(0);
  const finished = [];
  const perQuestion = new Map();   // id -> { answered, skipped, values:Map, msTotal, msCount }

  for (const r of rows) {
    const ob = r?.onboarding || {};
    const got = Math.min(screenCount, Math.max(0, Number(ob.reached) || 0));
    for (let i = 0; i < got; i += 1) reached[i] += 1;
    if (r.onboarded_at) finished.push(r);

    for (const [qid, a] of Object.entries(ob.answers || {})) {
      if (!perQuestion.has(qid)) {
        perQuestion.set(qid, { answered: 0, skipped: 0, values: new Map(), msTotal: 0, msCount: 0 });
      }
      const q = perQuestion.get(qid);
      const v = a?.value;
      if (v === SKIPPED) { q.skipped += 1; continue; }
      q.answered += 1;
      // Multi-select answers count once per chosen option, which is what a bar
      // chart of "what people make" has to mean.
      for (const one of (Array.isArray(v) ? v : [v])) {
        if (one === undefined || one === null || one === '') continue;
        const key = String(one);
        q.values.set(key, (q.values.get(key) || 0) + 1);
      }
      if (Number.isFinite(Number(a?.ms))) { q.msTotal += Number(a.ms); q.msCount += 1; }
    }
  }

  const questions = {};
  for (const [id, q] of perQuestion) {
    const seen = q.answered + q.skipped;
    questions[id] = {
      answered: q.answered,
      skipped: q.skipped,
      // ── THE NUMBER AMR ASKED FOR ──────────────────────────────────────
      // Out of people who REACHED this question, not out of everybody. A rate
      // over the whole population would fall every time somebody quit on an
      // earlier screen, which says nothing about this question at all.
      skipRate: seen ? Math.round((q.skipped / seen) * 1000) / 10 : null,
      avgSeconds: q.msCount ? Math.round(q.msTotal / q.msCount / 100) / 10 : null,
      values: [...q.values.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  return {
    total,
    finished: finished.length,
    // Null rather than 0 when nobody has been through it. "0% completion" on an
    // empty screen reads as a catastrophe; "no data yet" reads as the truth.
    completionRate: total ? Math.round((finished.length / total) * 1000) / 10 : null,
    funnel: reached.map((n, i) => ({
      screen: i + 1,
      reached: n,
      // Of the people who got to the PREVIOUS screen, how many carried on.
      keptFrom: i === 0 ? null : (reached[i - 1] ? Math.round((n / reached[i - 1]) * 1000) / 10 : null),
    })),
    questions,
  };
}
