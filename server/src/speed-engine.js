// ─── speed-engine.js ─────────────────────────────────────────────────────────
// How long each model actually takes, measured rather than assumed. Tier 2.3.
//
// WHY SPEED IS ITS OWN QUESTION. Reliability asks whether a model works. This
// asks whether it works FAST ENOUGH TO STAND IN FRONT OF. A model that
// succeeds every time but takes four minutes still kills a session: 170 people
// waiting three minutes is a different room from 170 people waiting twenty
// seconds, and the difference is not recoverable once you have lost them.
//
// THE MEASURE IS THE SLOW TAIL, NOT THE AVERAGE. An average hides exactly the
// case that derails a live demo — the one run in ten that takes three times as
// long, while you are standing there. So the headline pairs the median with
// the slowest-one-in-ten, and the verdict is driven by BOTH: a model whose
// median is fine but whose tail is five minutes is not safe to demonstrate.
//
// This module has no history to work from. Duration recording began on
// 2026-08-16; every figure is collected forward, and a model with too few
// timed runs is reported as unmeasured rather than guessed at.

/** Below this many timed runs, no figure is reported at all. */
export const MIN_TIMED = 8;

/** Seconds. Read off what a room can actually tolerate, not off a benchmark. */
export const BANDS = { IDEAL: 20, FINE: 60, BACKGROUND: 180 };

/**
 * Percentile from an unsorted list of milliseconds.
 *
 * Nearest-rank rather than interpolated: with eight samples an interpolated
 * "p90" invents a value between two real runs, and this screen is read as a
 * statement about runs that actually happened.
 */
export function percentile(values = [], p = 0.5) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const rank = Math.ceil(p * xs.length);
  return xs[Math.min(xs.length - 1, Math.max(0, rank - 1))];
}

/**
 * Can this model be demonstrated live?
 *
 * Both numbers matter. A median of 15s with a slow tail of six minutes is not
 * "ideal" — it is a model that will embarrass you once per session, and once
 * is enough.
 */
export function verdict(medianMs, slowMs, timed, { minTimed = MIN_TIMED } = {}) {
  if (!timed || timed < minTimed || medianMs === null) {
    return { key: 'unmeasured', label: 'not measured yet', tone: 'dim',
      note: `${timed || 0} timed run(s) — needs ${minTimed} before a figure means anything` };
  }
  const med = medianMs / 1000;
  const slow = (slowMs ?? medianMs) / 1000;

  if (slow > BANDS.BACKGROUND * 2) {
    return { key: 'no', label: 'not live', tone: 'crit',
      note: `usually ${fmt(med)}, but one run in ten takes ${fmt(slow)} — too long to wait in a room` };
  }
  if (med <= BANDS.IDEAL && slow <= BANDS.FINE) {
    return { key: 'ideal', label: 'ideal', tone: 'ok',
      note: `${fmt(med)} typically, ${fmt(slow)} at worst — fast enough to do repeatedly on stage` };
  }
  if (med <= BANDS.FINE) {
    return { key: 'fine', label: 'fine live', tone: 'ok',
      note: `${fmt(med)} typically — a natural pause, not an awkward one` };
  }
  if (med <= BANDS.BACKGROUND) {
    return { key: 'background', label: 'start it, move on', tone: 'warn',
      note: `${fmt(med)} typically — set it running and talk over it rather than watching` };
  }
  return { key: 'no', label: 'not live', tone: 'crit',
    note: `${fmt(med)} typically — set as homework, not a demonstration` };
}

export function fmt(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Build the table.
 *
 * `rows` are { model, kind, timed, median_ms, slow_ms } already aggregated in
 * SQL — percentiles over a whole table are the database's job, not JavaScript's.
 */
export function buildReport(rows = [], opts = {}) {
  return rows
    .filter((r) => r.model && String(r.model).trim())
    .map((r) => {
      const timed = Number(r.timed) || 0;
      const median = r.median_ms === null || r.median_ms === undefined ? null : Number(r.median_ms);
      const slow = r.slow_ms === null || r.slow_ms === undefined ? null : Number(r.slow_ms);
      const enough = timed >= (opts.minTimed ?? MIN_TIMED);
      return {
        model: r.model,
        kind: r.kind || null,
        timed,
        // Null rather than a number when the sample is too small: a median of
        // two runs is not a median, and printing one invites a decision.
        median_ms: enough ? median : null,
        slow_ms: enough ? slow : null,
        median_label: enough ? fmt(median / 1000) : null,
        slow_label: enough && slow !== null ? fmt(slow / 1000) : null,
        verdict: verdict(median, slow, timed, opts),
      };
    })
    // Slowest first — the models that threaten a session are what you came for.
    .sort((a, b) => {
      if (a.median_ms === null && b.median_ms === null) return b.timed - a.timed;
      if (a.median_ms === null) return 1;
      if (b.median_ms === null) return -1;
      return b.median_ms - a.median_ms;
    });
}

export function summarise(report = [], { since = null } = {}) {
  const measured = report.filter((r) => r.median_ms !== null);
  const notLive = measured.filter((r) => r.verdict.key === 'no');
  return {
    models: report.length,
    measured: measured.length,
    not_live: notLive.length,
    slowest: measured[0]?.model || null,
    slowest_label: measured[0]?.median_label || null,
    timed_runs: report.reduce((s, r) => s + r.timed, 0),
    // Stated so an empty screen reads as "too early", never as "no problems".
    collecting_since: since,
  };
}
