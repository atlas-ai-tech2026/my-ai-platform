// ─── sop-advisories.js ───────────────────────────────────────────────────────
// New dependency vulnerabilities — reported when they APPEAR, not counted.
//
// ── WHY IT REPORTS CHANGE, NOT TOTALS ──────────────────────────────────────
// There are 11 advisories today. Ten were reviewed and accepted deliberately;
// nothing in the system would report an eleventh, and nothing did.
//
// A line saying "11 advisories, 1 critical" is worse than no line. It is
// alarming, it is mostly noise, and it says the same thing every week — so
// people learn to dismiss it, and then dismiss the one that matters. Every
// check on this screen that survives contact with a real morning reports what
// CHANGED.
//
// ── SEVERITY IS NOT RISK ───────────────────────────────────────────────────
// Today's single CRITICAL is in vitest — a test framework that never runs in
// production. The advisory that actually matters is a HIGH in xlsx: prototype
// pollution, in a production dependency, with no upstream fix.
//
// Ranking by the badge npm prints would put the harmless one first every time.
// So production dependencies are separated from development ones, and a
// production advisory outranks a development one of higher severity.

/** Packages that reach a customer. Everything else runs on a laptop or a build box. */
export const RUNTIME_DEPS_KEY = 'dependencies';

/**
 * Flatten `npm audit --json` into something comparable.
 *
 * Defensive about shape: npm has changed this format more than once, and a
 * parser that throws on an unexpected field would take the whole SOP screen
 * down with it. An unreadable report is reported, never treated as "clean".
 */
export function parseAudit(raw, { productionDeps = new Set() } = {}) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return { error: `could not parse the audit output: ${e.message}`, advisories: [] };
  }
  const vulns = data?.vulnerabilities;
  if (!vulns || typeof vulns !== 'object') {
    return { error: 'the audit output had no vulnerabilities section', advisories: [] };
  }

  const advisories = [];
  for (const [name, v] of Object.entries(vulns)) {
    const title = (v?.via || [])
      .map((x) => (typeof x === 'string' ? null : x?.title))
      .find(Boolean) || '';
    advisories.push({
      name,
      severity: v?.severity || 'unknown',
      fixAvailable: Boolean(v?.fixAvailable),
      title,
      production: productionDeps.has(name),
    });
  }
  return { advisories: advisories.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** A stable identity for one advisory, so "the same one" survives a re-run. */
export const advisoryKey = (a) => `${a.name}@${a.severity}`;

/**
 * What is new since last time, and what has gone away.
 *
 * RESOLVED matters as much as ADDED. A vulnerability disappearing means someone
 * upgraded something — worth knowing, and worth removing from the accepted list
 * so it is not silently re-accepted if it comes back.
 */
export function diffAdvisories(current = [], known = []) {
  const knownKeys = new Set(known.map((k) => (typeof k === 'string' ? k : advisoryKey(k))));
  const currentKeys = new Set(current.map(advisoryKey));
  return {
    added: current.filter((a) => !knownKeys.has(advisoryKey(a))),
    resolved: [...knownKeys].filter((k) => !currentKeys.has(k)),
    unchanged: current.filter((a) => knownKeys.has(advisoryKey(a))),
  };
}

const SEVERITY_RANK = { critical: 4, high: 3, moderate: 2, low: 1, info: 0, unknown: 0 };

/**
 * Order by what would actually hurt.
 *
 * A production dependency always outranks a development one, whatever npm's
 * badge says. Today that is the difference between a CRITICAL in the test
 * runner and a HIGH in a library that handles customer spreadsheets.
 */
export function byRealRisk(a, b) {
  if (a.production !== b.production) return a.production ? -1 : 1;
  const bySeverity = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
  if (bySeverity) return bySeverity;
  // Equal risk, so the tie-break is which one will still be here next week.
  // One with a fix needs a COMMAND; one without needs a DECISION — accept the
  // risk, or replace the library. Left alphabetical, "start with" recommended
  // vite (one npm audit fix away) over xlsx (production, prototype pollution,
  // no upstream fix), which is the opposite of useful.
  if (a.fixAvailable !== b.fixAvailable) return a.fixAvailable ? 1 : -1;
  return 0;
}

export function judgeAdvisories({ parsed, known = [], now = Date.now() }) {
  if (parsed?.error) {
    return {
      state: 'unknown',
      detail: parsed.error,
      action: 'The dependency audit could not be read. That is not the same as finding nothing.',
      now,
    };
  }
  const { added, resolved, unchanged } = diffAdvisories(parsed.advisories, known);

  // ── A FIRST RUN IS A BASELINE, NOT A CHANGE ──────────────────────────────
  // With nothing reviewed yet, every advisory diffs as "new" and the line reads
  // "11 NEW advisories since the last check" — CRITICAL, on a day when nothing
  // whatsoever happened. Seen for real on the dev deploy of 2026-08-20.
  //
  // That is this module's own stated failure mode arriving through the front
  // door: alarming, unchanging, and untrue, which is exactly what teaches
  // someone to dismiss the line that finally matters. Eleven unreviewed
  // advisories still deserve attention — they do not deserve to be described as
  // something that just happened.
  if (!known.length && parsed.advisories.length) {
    const prod = parsed.advisories.filter((a) => a.production);
    const worst = [...parsed.advisories].sort(byRealRisk)[0];
    return {
      state: 'warn',
      baseline: true,
      detail: `first check — ${parsed.advisories.length} advisories found, none reviewed yet`
        + (prod.length ? ` · ${prod.length} in production dependencies` : ''),
      action: `Review them once and accept them; from then on this reports only what is NEW. `
        + `Start with ${worst.name}${worst.production ? ' — a production dependency' : ''}`
        + `${worst.fixAvailable ? ', and it has a fix available' : ', which has no upstream fix'}.`,
      added: [], resolved: [], now,
    };
  }

  if (!added.length) {
    const prod = unchanged.filter((a) => a.production).length;
    const bits = [`no new advisories · ${unchanged.length} already reviewed`];
    if (prod) bits.push(`${prod} of them in production dependencies`);
    if (resolved.length) bits.push(`${resolved.length} resolved since last check`);
    return { state: 'ok', detail: bits.join(' · '), action: null, added, resolved, now };
  }

  const worst = [...added].sort(byRealRisk)[0];
  const prodAdded = added.filter((a) => a.production);
  const fixable = added.filter((a) => a.fixAvailable).length;

  return {
    // A NEW advisory in something customers touch is a different morning from
    // a new one in a build tool.
    state: prodAdded.length ? 'critical' : 'warn',
    detail: `${added.length} NEW advisor${added.length === 1 ? 'y' : 'ies'} since the last check — `
      + added.slice(0, 4).map((a) => `${a.name} (${a.severity}${a.production ? ', production' : ''})`).join(' · ')
      + (added.length > 4 ? ` and ${added.length - 4} more` : ''),
    action: `Start with ${worst.name}${worst.production ? ' — it is a production dependency' : ''}. `
      + `${fixable} of ${added.length} have a fix available; run npm audit fix for those and decide on the rest. `
      + 'Then accept them so this reports only what is new again.',
    added, resolved, now,
  };
}

export async function ensureAdvisoryTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS known_advisories (
      advisory_key VARCHAR(200) PRIMARY KEY,
      name         VARCHAR(160) NOT NULL,
      severity     VARCHAR(24)  NOT NULL,
      production   BOOLEAN      NOT NULL DEFAULT FALSE,
      title        TEXT,
      accepted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
}

export async function knownAdvisories(pool) {
  await ensureAdvisoryTable(pool);
  const { rows } = await pool.query(`SELECT advisory_key FROM known_advisories`);
  return rows.map((r) => r.advisory_key);
}

/**
 * Record advisories as reviewed.
 *
 * Deliberately a separate step from reporting them. Auto-accepting on first
 * sight would mean a new vulnerability is announced once and then never
 * mentioned again — which is how the eleventh advisory went unnoticed in the
 * first place.
 */
export async function acceptAdvisories(pool, advisories = []) {
  if (!advisories.length) return 0;
  await ensureAdvisoryTable(pool);
  let n = 0;
  for (const a of advisories) {
    await pool.query(
      `INSERT INTO known_advisories (advisory_key, name, severity, production, title)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (advisory_key) DO NOTHING`,
      [advisoryKey(a), a.name, a.severity, !!a.production, a.title || null]);
    n += 1;
  }
  return n;
}

// ── running it for real ─────────────────────────────────────────────────────

/**
 * Which packages actually reach a customer.
 *
 * Read from package.json rather than guessed, because the difference decides
 * whether an advisory is a Monday-morning problem or a footnote.
 */
export async function productionDependencies(root) {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    return new Set(Object.keys(pkg.dependencies || {}));
  } catch { return new Set(); }
}

/** npm audit is a network call. It gets a deadline, like everything else here. */
export const AUDIT_TIMEOUT_MS = 90_000;

/**
 * Run `npm audit --json`.
 *
 * NOTE npm exits NON-ZERO when it finds vulnerabilities — that is success, not
 * failure, and treating the exit code as an error would make every real finding
 * look like a broken check. Only an unparseable body is a failure.
 */
export async function runAudit({ root, exec, timeoutMs = AUDIT_TIMEOUT_MS } = {}) {
  const { execFile } = exec ? { execFile: exec } : await import('node:child_process');
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(
      () => finish({ error: `npm audit did not finish within ${Math.round(timeoutMs / 1000)}s` }),
      timeoutMs);
    try {
      execFile('npm', ['audit', '--json'], { cwd: root, maxBuffer: 20 * 1024 * 1024 },
        (_err, stdout) => {
          clearTimeout(timer);
          // stdout is what matters; a non-zero exit merely means "found some".
          finish(stdout && stdout.trim() ? { stdout } : { error: 'npm audit produced no output' });
        });
    } catch (e) {
      clearTimeout(timer);
      finish({ error: e.message });
    }
  });
}

/** The whole check: run, parse, diff against what has been reviewed, judge. */
export async function runAdvisoryCheck(pool, { root, exec } = {}) {
  const res = await runAudit({ root, exec });
  if (res.error) return judgeAdvisories({ parsed: { error: res.error, advisories: [] } });
  const parsed = parseAudit(res.stdout, { productionDeps: await productionDependencies(root) });
  let known = [];
  try { known = await knownAdvisories(pool); } catch { /* first run, or no table yet */ }
  return { ...judgeAdvisories({ parsed, known }), parsed };
}

// ── RUNNING IT WEEKLY, NOT ON EVERY PAGE LOAD ───────────────────────────────
// runAdvisoryCheck spawns `npm audit`, which is a network call to the registry
// with a 90-second ceiling. It was wired into the integrity zone, which is
// rebuilt on EVERY load of the SOP screen — so opening the screen twice ran it
// twice, and the whole page waited for the slower of them.
//
// The result changes when a new advisory is published, which is a thing that
// happens a few times a month. Weekly is the honest cadence, and #35 asked for
// weekly. Between runs the screen shows the STORED result together with WHEN it
// was taken — never "checked just now" over an answer from Tuesday, which is
// the same lie as reporting a value nobody read.

export async function ensureAdvisoryRunTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS advisory_runs (
      id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      state      VARCHAR(16)  NOT NULL,
      detail     TEXT         NOT NULL,
      action     TEXT,
      added      JSONB        NOT NULL DEFAULT '[]'::jsonb,
      checked_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
}

export async function saveAdvisoryRun(pool, judged) {
  await ensureAdvisoryRunTable(pool);
  await pool.query(
    `INSERT INTO advisory_runs (id, state, detail, action, added, checked_at)
     VALUES (1, $1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       state = EXCLUDED.state, detail = EXCLUDED.detail, action = EXCLUDED.action,
       added = EXCLUDED.added, checked_at = EXCLUDED.checked_at`,
    [judged.state, judged.detail, judged.action || null,
     JSON.stringify(judged.added || [])]);
}

export async function latestAdvisoryRun(pool) {
  await ensureAdvisoryRunTable(pool);
  const { rows } = await pool.query(`SELECT * FROM advisory_runs WHERE id = 1`);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    state: r.state, detail: r.detail, action: r.action || '',
    added: r.added || [], checkedAt: new Date(r.checked_at).toISOString(),
  };
}

/** Age at which a stored result stops being worth showing without a caveat. */
export const RESULT_STALE_AFTER_MS = 10 * 864e5;   // a weekly job that missed a week

/**
 * What the screen should render: the stored result, or an honest "not yet".
 *
 * Deliberately does NOT run the audit as a fallback. A cache that silently
 * refills itself on read is the page-load cost coming back through a side door
 * — and it would run under whichever request happened to arrive first, which is
 * not a schedule.
 */
export function presentAdvisoryRun(run, { now = Date.now() } = {}) {
  if (!run) {
    return {
      state: 'unknown',
      detail: 'not checked yet — this runs with the weekly structure checks',
      action: 'Press “Check now” on the weekly checks to run it immediately.',
      checkedAt: null,
    };
  }
  const ageMs = now - new Date(run.checkedAt).getTime();
  const days = Math.floor(ageMs / 864e5);
  const age = days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  if (ageMs > RESULT_STALE_AFTER_MS) {
    return {
      ...run,
      state: 'unknown',
      detail: `last checked ${age} — the weekly run has not happened since. ${run.detail}`,
      action: 'A result this old is a record, not a check. Find out why the weekly job stopped.',
    };
  }
  return { ...run, detail: `${run.detail} · checked ${age}` };
}

/** Run it for real and store the result. Called by the weekly job. */
export async function refreshAdvisories(pool, { root, exec } = {}) {
  const judged = await runAdvisoryCheck(pool, { root, exec });
  await saveAdvisoryRun(pool, judged).catch((e) =>
    console.error('[sop-advisories] could not store the run:', e.message));
  return judged;
}
