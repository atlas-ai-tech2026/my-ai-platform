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
  // NOTE: `failures` here must already EXCLUDE failures caused by our own
  // supplier account being empty. See splitFailures below — judging a model on
  // those would be the difference between useful advice and harmful advice.
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
 * Separate "the model failed" from "our account was empty".
 *
 * THE MISTAKE THIS EXISTS TO PREVENT. The first run of this report said
 * "avoid live — Nano Banana Pro, 28.2% failure". But 1,234 of the platform's
 * failures came from fal and kie refusing because OUR OWN balance was
 * exhausted — which fails whatever model happens to be running. Judging a
 * model on those is not merely inaccurate; it is advice to stop teaching your
 * best image model because of a billing problem.
 *
 * So the verdict is computed from model failures ONLY, and the account-dry
 * count is shown separately — where it is a prompt to top up, not to change
 * the syllabus.
 */
export function splitFailures(rows = []) {
  return rows.map((r) => {
    const ours = Number(r.account_dry_failures) || 0;
    const total = Number(r.failures) || 0;
    return { ...r, failures: Math.max(0, total - ours), account_dry_failures: ours, total_failures: total };
  });
}

/**
 * Build the table the screen renders.
 *
 * `rows` are { model, kind, attempts, failures, account_dry_failures } already
 * aggregated. `wastedUsd` needs a per-attempt supplier cost, which many models
 * still lack — so it is null rather than zero when unknown, for the same
 * reason as the P&L: a free-looking failure is a flattering lie.
 */
export function buildReport(rows = [], costIdx = new Map(), opts = {}) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const out = splitFailures(rows)
    .filter((r) => r.model && String(r.model).trim())
    .map((r) => {
      const attempts = Number(r.attempts) || 0;
      const failures = Number(r.failures) || 0;      // model's own failures
      const unit = costIdx.get(norm(r.model));
      const rate = attempts ? (failures / attempts) * 100 : null;
      return {
        model: r.model,
        kind: r.kind || null,
        attempts,
        failures,
        // Shown in its own column: a prompt to top up, not to change the
        // syllabus. Never folded into the verdict.
        account_dry_failures: r.account_dry_failures,
        total_failures: r.total_failures,
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

/**
 * Replace a model's INFERRED numbers with RECORDED ones, once there are enough.
 *
 * Video failures used to be a deduction: match each refund to the spend it
 * probably reverses, same person, same amount, within thirty minutes. That
 * recovers 91% and is honest, but it is still arithmetic about what likely
 * happened. `pending_video_charges` now carries the model name and the failure
 * reason on the row itself, so for those models the answer is simply known.
 *
 * TWO RULES, both of which exist to stop this being an improvement that quietly
 * makes the screen worse:
 *
 *   · A recorded row only wins when it has at least `minAttempts` of its own.
 *     Recording started at a point in time; for a while the recorded sample is
 *     tiny while the inferred one spans the whole window. Preferring three
 *     exact attempts to nine hundred inferred ones would be precision used as
 *     a substitute for evidence.
 *   · Account-dry failures are excluded from the recorded count exactly as they
 *     are from the inferred one. Being exact about the wrong number is not an
 *     improvement.
 *
 * Every row carries `basis` so the screen can say which it is showing. A screen
 * that silently mixes measured and deduced figures in one column is the quiet
 * kind of wrong this module was written to avoid.
 */
export function applyRecorded(report = [], recorded = [], opts = {}) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const min = opts.minAttempts ?? MIN_ATTEMPTS;
  const idx = new Map();
  for (const r of recorded) {
    if (r?.model) idx.set(norm(r.model), r);
  }

  return report.map((row) => {
    const rec = idx.get(norm(row.model));
    if (!rec) return { ...row, basis: 'inferred' };

    const attempts = Number(rec.attempts) || 0;
    const dry = Number(rec.account_dry_failures) || 0;
    const failures = Math.max(0, (Number(rec.failures) || 0) - dry);

    // Always reported, so the screen can show the exact figures building up
    // even while the verdict still rests on the inference.
    const recordedBlock = {
      attempts,
      failures,
      account_dry_failures: dry,
      rate_pct: attempts >= min ? Math.round((failures / attempts) * 1000) / 10 : null,
    };

    if (attempts < min) {
      return { ...row, basis: 'inferred', recorded: recordedBlock };
    }
    return {
      ...row,
      basis: 'recorded',
      recorded: recordedBlock,
      attempts,
      failures,
      account_dry_failures: dry,
      total_failures: failures + dry,
      rate_pct: recordedBlock.rate_pct,
      verdict: verdict(attempts, failures, opts),
      // The inferred figures are kept rather than discarded: when a recorded
      // and a deduced rate disagree sharply, that gap is itself worth seeing.
      inferred: {
        attempts: row.attempts,
        failures: row.failures,
        rate_pct: row.rate_pct,
      },
    };
  });
}

/** How much of the table is measured rather than deduced. */
export function basisSummary(report = []) {
  const recorded = report.filter((r) => r.basis === 'recorded').length;
  return {
    recorded,
    inferred: report.length - recorded,
    // Null, not 0, for an empty table: "nothing to say" is not "nothing is
    // measured".
    recorded_pct: report.length ? Math.round((recorded / report.length) * 1000) / 10 : null,
  };
}

/** One-line summary for the top of the screen. */
export function summarise(report = []) {
  const judged = report.filter((r) => r.rate_pct !== null);
  const avoid = judged.filter((r) => r.verdict.key === 'avoid');
  const attempts = report.reduce((s, r) => s + r.attempts, 0);
  const failures = report.reduce((s, r) => s + r.failures, 0);
  const accountDry = report.reduce((s, r) => s + (r.account_dry_failures || 0), 0);
  const wasted = report.reduce((s, r) => s + (r.wasted_usd || 0), 0);
  return {
    models: report.length,
    judged: judged.length,
    avoid_live: avoid.length,
    worst: avoid[0]?.model || null,
    attempts,
    failures,
    // Reported separately and prominently: this is the number that is fixable
    // by topping up an account, and the only one that is nobody's model's
    // fault. Rolling it into the headline rate hides a billing problem inside
    // what looks like a quality problem.
    account_dry_failures: accountDry,
    overall_rate_pct: attempts ? Math.round((failures / attempts) * 1000) / 10 : null,
    wasted_usd: Math.round(wasted * 100) / 100,
  };
}
