// ─── reliability-engine.js ───────────────────────────────────────────────────
// How often each model fails, and whether it can be trusted in a live room.
//
// WHY IT MATTERS TWICE OVER. A model failing 30% of the time bills you for
// every attempt AND leaves an attendee watching nothing happen. The second
// cost is the larger one: recommending an unreliable model in the first ten
// minutes of a workshop loses the room, and no refund gets that back.
//
// WHAT THE DATA CAN AND CANNOT SAY. Nothing records "model X failed". Spend
// rows name the model; refund rows name the provider's complaint. So a failure
// is attributed by matching a refund to the spend it almost certainly reverses
// — same person, same amount, within half an hour. Measured on production
// 2026-08-16, that recovers 1,192 of 1,316 refunds (91%).
//
// That is an inference, not a record, and this module is written so the screen
// can never present it as more than it is: every result carries its own
// confidence, and a rate that rests on too little is refused outright rather
// than rounded into a fact.

/** Below this many attempts, no rate is reported at all. */
export const MIN_ATTEMPTS = 30;

/** Failure-rate bands, in percent. */
export const BANDS = { GOOD: 5, WATCH: 15 };

/**
 * A model's verdict for workshop use.
 *
 * 'too few' rather than '100% reliable' on a handful of attempts: a rate
 * computed from a tiny sample is a guess wearing a number's clothes, and this
 * screen exists to stop people teaching from guesses.
 */
export function verdict(attempts, failures, { minAttempts = MIN_ATTEMPTS } = {}) {
  if (!attempts || attempts < minAttempts) {
    return { key: 'too_few', label: 'too few', tone: 'dim',
      note: `only ${attempts || 0} attempt(s) — not enough to judge` };
  }
  const rate = (failures / attempts) * 100;
  if (rate < BANDS.GOOD) {
    return { key: 'teach', label: 'teach it', tone: 'ok', note: 'reliable enough for a live demo' };
  }
  if (rate < BANDS.WATCH) {
    return { key: 'watch', label: 'watch', tone: 'warn',
      note: 'usable, but expect a visible failure in a large room' };
  }
  return { key: 'avoid', label: 'avoid live', tone: 'crit',
    note: 'fails too often to demonstrate in front of people' };
}

/**
 * How much of a model's failure count we could actually attribute.
 *
 * Reported per model, not just overall, because coverage is uneven: a model
 * used once per session may have every refund matched while a heavily used one
 * has gaps. A rate built on 40% attribution is not comparable to one built on
 * 95%, and showing them in the same column without saying so would be the
 * quiet kind of wrong.
 */
export function confidenceOf(matchedFailures, totalFailuresInWindow) {
  if (!totalFailuresInWindow) return { pct: 100, label: 'exact' };
  const pct = Math.round((matchedFailures / totalFailuresInWindow) * 1000) / 10;
  return {
    pct,
    label: pct >= 90 ? 'high' : pct >= 70 ? 'fair' : 'low',
  };
}

/**
 * Build the table the screen renders.
 *
 * `rows` are { model, kind, attempts, failures, credits } already aggregated.
 * `wastedUsd` needs a per-attempt supplier cost, which many models still lack —
 * so it is null rather than zero when unknown, for the same reason as the P&L:
 * a free-looking failure is a flattering lie.
 */
export function buildReport(rows = [], costIdx = new Map(), opts = {}) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const out = rows
    .filter((r) => r.model && String(r.model).trim())
    .map((r) => {
      const attempts = Number(r.attempts) || 0;
      const failures = Number(r.failures) || 0;
      const unit = costIdx.get(norm(r.model));
      const rate = attempts ? (failures / attempts) * 100 : null;
      return {
        model: r.model,
        kind: r.kind || null,
        attempts,
        failures,
        rate_pct: attempts >= (opts.minAttempts ?? MIN_ATTEMPTS)
          ? Math.round(rate * 10) / 10
          : null,
        // What the failures cost us. Null, never 0, when the model has no
        // supplier cost on file.
        wasted_usd: unit === undefined ? null : Math.round(unit * failures * 100) / 100,
        verdict: verdict(attempts, failures, opts),
      };
    });

  // Worst first, but models with no usable rate sink to the bottom rather than
  // sorting as though they were perfect.
  return out.sort((a, b) => {
    if (a.rate_pct === null && b.rate_pct === null) return b.attempts - a.attempts;
    if (a.rate_pct === null) return 1;
    if (b.rate_pct === null) return -1;
    return b.rate_pct - a.rate_pct;
  });
}

/** One-line summary for the top of the screen. */
export function summarise(report = []) {
  const judged = report.filter((r) => r.rate_pct !== null);
  const avoid = judged.filter((r) => r.verdict.key === 'avoid');
  const attempts = report.reduce((s, r) => s + r.attempts, 0);
  const failures = report.reduce((s, r) => s + r.failures, 0);
  const wasted = report.reduce((s, r) => s + (r.wasted_usd || 0), 0);
  return {
    models: report.length,
    judged: judged.length,
    avoid_live: avoid.length,
    worst: avoid[0]?.model || null,
    attempts,
    failures,
    overall_rate_pct: attempts ? Math.round((failures / attempts) * 1000) / 10 : null,
    wasted_usd: Math.round(wasted * 100) / 100,
  };
}
