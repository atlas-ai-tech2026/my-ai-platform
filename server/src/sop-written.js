// ─── sop-written.js ──────────────────────────────────────────────────────────
// Is each column that MATTERS still being written — right now, not historically?
//
// ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
// The existing structure check finds columns that are empty in EVERY row. It
// caught `pending_video_charges.model_label` (3,046 rows, all NULL) exactly as
// designed.
//
// It could not catch the second bug, found on 2026-08-19. The Node canvas
// wrote its ledger notes as `node: flux-dev`, the label parser required the
// string to start with image|video|audio, and so every generation made from
// the canvas stored NO label. The column was NOT 100% empty — direct
// generations filled it — so a whole surface of the product was missing from
// the Reliability and Speed screens while the check reported nothing wrong.
//
// A column can be 60% written and still be completely broken for one of the
// ways people use the product.
//
// ── WHY A ROLLING WINDOW, NOT ALL OF HISTORY ───────────────────────────────
// The question worth asking is "is this being written NOW", not "was it always
// written". `pending_video_charges` has 3,046 historical rows that will never
// be filled, and reporting those forever would be a permanent red mark nobody
// can clear — which is how a check becomes wallpaper. Looking only at recent
// rows also means the check heals itself once a fix ships.
//
// ── WHY AN EXPLICIT LIST, NOT A BLANKET THRESHOLD ──────────────────────────
// Most nullable columns are legitimately sparse: `blocked_by`, `failure_reason`
// and `done_at` are all SUPPOSED to be empty most of the time. Flagging every
// mostly-null column would bury the real finding in noise, and a noisy check
// gets ignored — which is worse than no check, because it still looks like
// coverage. So each entry below is a deliberate claim: this column should be
// populated, and here is what it costs when it is not.

/** Columns that must be written, with what it breaks when they are not. */
export const MUST_BE_WRITTEN = [
  {
    table: 'generation_events', column: 'model_label', maxNullPct: 10,
    why: 'Which model ran. Empty means the generation is invisible to both the Reliability '
      + 'and the Speed screens — this is exactly how every Node canvas generation disappeared.',
    action: 'Find the route whose ledger note the label parser cannot read (server/src/generation-events.js labelFrom).',
  },
  {
    table: 'generation_events', column: 'duration_ms', maxNullPct: 25,
    // Only attempts that actually REPORTED BACK. `outcome <> 'pending'` also
    // swept in `unknown` — the rows sweepStale marks when a browser tab closed
    // and the attempt never returned. Those have no duration deliberately;
    // inventing one would be making up the very number this column exists to
    // give honestly. They were 44.4% of the window on production, so the line
    // sat yellow pointing at a bug that was not there.
    where: "outcome IN ('delivered', 'failed')",
    why: 'How long a finished generation took. Empty means "which model is fastest" has no '
      + 'answer for it — the question clients actually ask.',
    action: 'A route is closing an attempt without settleAttempt(), or not closing it at all. '
      + 'Attempts that never reported back are counted separately and are not this.',
  },
  {
    table: 'pending_video_charges', column: 'model_label', maxNullPct: 10,
    // Nothing wrote this column until ea4ac90 on 2026-08-19. Judged over a
    // 7-day window it reported 79.5% missing the day after the fix shipped —
    // six days of rows that never could have had a value, described as a live
    // bug in call sites that all pass modelLabel correctly.
    //
    // A `since` self-expires: once the rolling window clears the date it stops
    // mattering, and a genuine regression after it is still caught in full.
    since: '2026-08-19',
    why: 'Which model a video job used. Empty means its failure can only ever be inferred by '
      + 'matching refunds to spends, never recorded.',
    action: 'A trackVideoCharge() call site is not passing modelLabel — see video-charge-model-id.test.js.',
  },
  {
    table: 'credits_history', column: 'reason', maxNullPct: 15,
    where: "action = 'spend'",
    why: 'What a charge was for. Empty means the spend cannot be attributed to any model, and '
      + 'it drops out of every cost and reliability figure.',
    action: 'A route is calling chargeCredits() without a note.',
  },
];

/** Below this many rows in the window, say nothing — a rate from four rows is noise. */
export const MIN_ROWS = 25;

const SAFE = /^[a-z_][a-z0-9_]*$/;

/**
 * Measure how much of each declared column is missing in the recent window.
 *
 * Table and column names are checked against a strict pattern before being
 * interpolated — they come from the constant above rather than from input, but
 * a list edited by hand is still worth validating, and `where` is never taken
 * from anywhere but this file.
 */
export async function measureWritten(pool, { days = 7, specs = MUST_BE_WRITTEN } = {}) {
  const out = [];
  for (const s of specs) {
    if (!SAFE.test(s.table) || !SAFE.test(s.column)) {
      out.push({ ...s, error: 'unsafe identifier in MUST_BE_WRITTEN' });
      continue;
    }
    // `since` is bound as a parameter, but it is still checked: everything in
    // this file is interpolated somewhere, and one exception is how the next
    // person learns it is optional.
    if (s.since && !/^\d{4}-\d{2}-\d{2}$/.test(s.since)) {
      out.push({ ...s, error: `since must be YYYY-MM-DD, got "${s.since}"` });
      continue;
    }
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total, COUNT("${s.column}")::int AS written
           FROM "${s.table}"
          WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
            ${s.since ? 'AND created_at >= $2::date' : ''}
            ${s.where ? `AND (${s.where})` : ''}`,
        s.since ? [days, s.since] : [days]);
      out.push({ ...s, total: rows[0].total, written: rows[0].written });
    } catch (e) {
      // A missing table is a finding, not a crash — but it is reported as
      // "could not check", never as "fine".
      out.push({ ...s, error: e.message });
    }
  }
  return out;
}

/**
 * Turn measurements into findings.
 *
 * Three outcomes, and the third is the one that matters most: a column we could
 * not measure is reported as UNKNOWN, never as passing. "We did not look" and
 * "we looked and it was fine" are different answers, and a screen that renders
 * them the same way is how a broken check goes unnoticed for months.
 */
export function judgeWritten(measured = [], { minRows = MIN_ROWS } = {}) {
  return measured.map((m) => {
    const name = `${m.table}.${m.column}`;
    if (m.error) {
      return { column: name, state: 'unknown', detail: `could not be checked: ${m.error}`,
        why: m.why, action: m.action };
    }
    if (m.total < minRows) {
      return { column: name, state: 'quiet', detail: `only ${m.total} row(s) in the window — too few to judge`,
        why: m.why, action: null };
    }
    const missing = m.total - m.written;
    const pct = Math.round((missing / m.total) * 1000) / 10;
    if (pct <= m.maxNullPct) {
      return { column: name, state: 'ok', detail: `${m.written} of ${m.total} written (${pct}% missing)`,
        why: m.why, action: null };
    }
    return {
      column: name, state: 'bad',
      detail: `${missing} of ${m.total} recent rows have no ${m.column} (${pct}% missing, limit ${m.maxNullPct}%)`,
      why: m.why, action: m.action,
    };
  });
}

/** One line for the SOP screen. */
export function summariseWritten(findings = []) {
  const by = (s) => findings.filter((f) => f.state === s).length;
  return {
    checked: findings.length,
    bad: by('bad'),
    unknown: by('unknown'),
    quiet: by('quiet'),
    ok: by('ok'),
  };
}

export async function runWrittenChecks(pool, opts = {}) {
  const findings = judgeWritten(await measureWritten(pool, opts), opts);
  return { findings, summary: summariseWritten(findings) };
}
