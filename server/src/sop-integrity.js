// ─── sop-integrity.js ────────────────────────────────────────────────────────
// Finds the gap between what the interface PROMISES and what the database and
// server actually DO.
//
// This is the class of fault that has cost most on this project, and it never
// announces itself. Every one of these shipped green:
//   · /edit collected emails through a form that posted to NOTHING
//   · pending_video_charges.model_label — 3,046 rows, every one NULL, so
//     "which video model is fastest" had no answer for weeks
//   · a bulk-expiry control styled so faintly the owner reported the feature
//     as missing from production
// None is a crash. Each is a promise nothing keeps.
//
// ── EVERY FINDING HERE IS A WARNING, NEVER A FAILURE ────────────────────────
// These checks are heuristics over source text and statistics, and they have
// honest false positives: an endpoint called only by an external webhook, a
// column that is new and legitimately empty, a table written solely by a
// migration. A check that cries wolf gets switched off, so nothing here is
// allowed to be critical, and every finding says what would make it a
// non-issue.

import fs from 'node:fs';
import path from 'node:path';

/** Paths that legitimately have no frontend caller. */
export const EXPECTED_UNCALLED = [
  '/api/health',                    // uptime monitors and deploy checks
  // Called by UptimeRobot every 5 minutes from outside, which no amount of
  // scanning our own source can see. It is also the endpoint whose visits the
  // SOP tab records — so the one route we can PROVE is called was the one
  // being reported as called by nobody.
  '/api/ready',
  '/api/admin/sop',                 // this very screen; its UI lands in pass 3
  '/api/admin/sop/check-now',
  // Reached by a full-page navigation (window.location), not by fetch — so no
  // client source contains the path as a string. Real, and correctly silent.
  '/api/auth/google', '/api/auth/google/callback',
  '/api/auth/microsoft', '/api/auth/microsoft/callback',
  '/api/unsubscribe',               // followed from a link in an email
];

/** Tables written by migrations or infrastructure rather than a route. */
export const EXPECTED_UNREFERENCED_TABLES = ['pg_stat_statements'];

/** Columns allowed to be entirely NULL — say WHY, or it becomes a dumping ground. */
export const EXPECTED_NULL_COLUMNS = {
  // Filled only when an admin acts; empty is the healthy state.
  'admin_audit_log.target_email': 'only set for user-targeted admin actions',
  'users.last_login_ip': 'null until a first sign-in',
};

// ── source scanning ─────────────────────────────────────────────────────────

function readAll(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readAll(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e)) && !entry.name.includes('.test.')) {
      out.push({ file: full, src: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}

/**
 * Routes the server registers.
 *
 * Extracting a quoted path is a much narrower job than parsing structure — the
 * reason this does not use a full parser is that the answer only feeds a
 * WARNING, and a missed route costs a false positive rather than a wrong fact.
 */
export function registeredRoutes(serverFiles) {
  const routes = new Set();
  // `all` is included, and so is the ARRAY form. Both were missing, and both
  // were being used: /api/history/models and /api/history/deleted are
  // registered as `app.all(['/api/history/models'], …)`. Invisible to a regex
  // that expected app.post('/api/…') exactly, they were reported as paths the
  // interface calls and nothing serves — while answering perfectly on
  // production. A check that reports live routes as dead is a check people
  // learn to dismiss, which is the failure this module exists to prevent,
  // arriving in the module itself.
  const re = /\bapp\.(get|post|put|patch|delete|all)\s*\(\s*(\[[^\]]*\]|['"`]\/api\/[^'"`]*['"`])/g;
  const strings = /['"`](\/api\/[^'"`]*)['"`]/g;
  for (const { src } of serverFiles) {
    for (const m of src.matchAll(re)) {
      const method = m[1].toUpperCase();
      // One registration, one or many paths — an array registers each of them.
      for (const p of m[2].matchAll(strings)) routes.add(`${method} ${p[1]}`);
    }
  }
  return routes;
}

/**
 * String literals beginning `/api/`, including template literals with NESTED
 * templates inside their placeholders.
 *
 * A regex cannot do this and the first version proved it: on
 * `` `/api/admin/live${q.toString() ? `?${q}` : ''}` `` it stopped at the inner
 * backtick and invented three paths that do not exist — which then appeared in
 * BOTH the dead-path and uncalled-route lists, the signature of a scanner
 * fault rather than a finding. A check that manufactures findings gets
 * switched off, so this walks the string and counts placeholder depth.
 */
export function extractApiStrings(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const q = src[i];
    if (q !== '`' && q !== "'" && q !== '"') continue;
    let j = i + 1, depth = 0, body = '';
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { body += c + (src[j + 1] || ''); j++; continue; }
      if (q === '`' && c === '$' && src[j + 1] === '{') { depth++; body += '${'; j++; continue; }
      if (q === '`' && depth > 0 && c === '}') { depth--; body += '}'; continue; }
      if (c === q && depth === 0) break;          // a real closing quote
      if (c === '\n' && q !== '`') break;         // unterminated ordinary string
      body += c;
    }
    if (body.startsWith('/api/')) out.push(body);
    i = j;
  }
  return out;
}

/**
 * Calls made through `base44.functions.invoke('name', …)`.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * invoke() builds its URL at RUNTIME — `api.post(\`/api/${funcName}\`)` — so the
 * string "/api/history/search" appears nowhere in the source. Scanning only
 * for literal /api/ strings therefore reported a dozen perfectly live
 * endpoints as "nothing calls this": the whole history search, the onboarding
 * screens, the edit agent, the pollers.
 *
 * A structural check that cries wolf twelve times is worse than no check. It
 * was reporting 22, of which most were this — so the number could never fall,
 * and a line that never changes is a line nobody reads. That is the exact
 * failure this module exists to catch, arriving in the module itself.
 */
export function extractInvokeNames(src) {
  const out = [];
  // invoke('name'  ·  invoke("name"  ·  invoke(`name`  — the closing quote is
  // required, so a template with ${…} inside is skipped rather than guessed at.
  const re = /\binvoke\(\s*(['"`])([^'"`$\\]+)\1/g;
  let m;
  while ((m = re.exec(src))) out.push(`/api/${m[2].replace(/^\/+/, '')}`);
  return out;
}

/** API paths the frontend asks for, literal AND via invoke(). */
export function requestedPaths(clientFiles) {
  const paths = new Set();
  for (const { src } of clientFiles) {
    for (const p of extractApiStrings(src)) paths.add(p);
    for (const p of extractInvokeNames(src)) paths.add(p);
  }
  return paths;
}

/** `/api/admin/users/${id}/history?x=1` → `/api/admin/users/:p/history` */
export function canonical(p) {
  // Collapse ${...} by counting braces, so a placeholder containing an object
  // or a nested template does not leave a fragment behind.
  let out = '';
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '$' && p[i + 1] === '{') {
      let depth = 1; i += 2;
      while (i < p.length && depth > 0) {
        if (p[i] === '{') depth++;
        else if (p[i] === '}') depth--;
        i++;
      }
      i--; out += ':p'; continue;
    }
    out += p[i];
  }
  return out.split('?')[0]
    .replace(/:[A-Za-z_]\w*/g, ':p')
    // A placeholder is a PATH SEGMENT only when it follows a slash. Glued
    // straight onto a segment — `/api/admin/live${qs}` — it is a query string
    // or a suffix, not another level of path, and treating it as one invents
    // a route that was never called.
    .replace(/([^/]):p/g, '$1')
    .replace(/\/+$/, '') || '/';
}

/**
 * A path the interface asks for that no route serves.
 * THE WAITLIST BUG, in one check.
 */
export function deadPaths({ requested, routes }) {
  const served = new Set();
  // A route registered with a placeholder in its PATH is built in a loop —
  // offers-routes.js does exactly this for pause/resume:
  //     app.post(`/api/offers/:id/${path}`, …)
  // At runtime those are real routes. Treating the static part as a prefix
  // stops the check inventing two dead paths that work perfectly.
  const prefixes = [];
  for (const r of routes) {
    const raw = r.split(' ')[1];
    // A WILDCARD serves everything beneath it. Express 5 spells it `*splat`
    // (path-to-regexp v8 dropped the bare `*`), and the speech model route is
    // exactly this: `/api/speech/model/*splat` serves
    // `/api/speech/model/whisper-tiny/config.json`. Not knowing that, the
    // check reported the one path I had just fetched from production with a
    // 200 as a screen calling something the server cannot do.
    const star = raw.search(/\*/);
    if (star > -1) prefixes.push(canonical(raw.slice(0, star)));
    else if (raw.includes('${')) prefixes.push(canonical(raw.slice(0, raw.indexOf('${'))));
    else served.add(canonical(raw));
  }
  return [...requested]
    .map(canonical)
    .filter((p) => p !== '/api' && !served.has(p))
    .filter((p) => !prefixes.some((pre) => pre && p.startsWith(pre)))
    // A REQUESTED path whose last segment is a placeholder is the mirror of
    // the case above: `/api/auth/${provider}` is one real call to one of two
    // real routes, and `/api/${funcName}` is invoke()'s own dispatcher, whose
    // actual destinations are extracted separately by extractInvokeNames().
    // Reporting either as "a screen calling nothing" is reporting the mechanism
    // instead of the call.
    .filter((p) => {
      if (!p.endsWith('/:p')) return true;
      const prefix = p.slice(0, -2);            // keep the trailing slash
      return ![...served].some((sv) => sv.startsWith(prefix));
    })
    .sort();
}

/** A route registered that nothing in the interface asks for. */
export function uncalledRoutes({ requested, routes, expected = EXPECTED_UNCALLED }) {
  const asked = new Set([...requested].map(canonical));
  const skip = new Set(expected.map(canonical));
  return [...routes]
    .filter((r) => {
      const raw = r.split(' ')[1];
      const p = canonical(raw);
      if (skip.has(p) || asked.has(p)) return false;
      // The mirror of deadPaths: a route that ends in a WILDCARD or is built
      // from a TEMPLATE is called whenever anything beneath it is called.
      // `/api/speech/model/*splat` is asked for as `/api/speech/model/`, and
      // `/api/offers/:id/${path}` is two real routes built in a loop. Without
      // this both were reported as called by nobody — one of them while I was
      // fetching it from production and getting 200s.
      const star = raw.search(/\*/);
      const tpl = raw.indexOf('${');
      const cut = star > -1 ? star : tpl;
      if (cut > -1) {
        const prefix = canonical(raw.slice(0, cut));
        if (prefix && [...asked].some((a) => a.startsWith(prefix))) return false;
      }
      return true;
    })
    .sort();
}

/** Tables no server source mentions — nothing reads or writes them. */
export function unreferencedTables({ tables, serverFiles, expected = EXPECTED_UNREFERENCED_TABLES }) {
  const blob = serverFiles.map((f) => f.src).join('\n');
  return tables
    .filter((t) => !expected.includes(t))
    // Word-boundary match so `users` does not match `failed_logins`.
    .filter((t) => !new RegExp(`\\b${t}\\b`).test(blob))
    .sort();
}

/**
 * Columns that exist and are empty in every single row.
 *
 * `model_label` is the reason this check exists: the column was added, the UI
 * depended on it, and nothing ever wrote to it. A column that is 100% NULL is
 * a promise nothing keeps.
 */
export function describeNullColumns(rows, expected = EXPECTED_NULL_COLUMNS) {
  return rows
    .filter((r) => r.total > 0 && Number(r.non_null) === 0)
    .map((r) => ({
      column: `${r.table_name}.${r.column_name}`,
      rows: Number(r.total),
      expected: expected[`${r.table_name}.${r.column_name}`] || null,
    }))
    .filter((r) => !r.expected)
    .sort((a, b) => b.rows - a.rows);
}

// ── the database half ───────────────────────────────────────────────────────

/**
 * Candidate all-NULL columns, cheaply.
 *
 * Postgres already tracks null_frac in pg_stats from ANALYZE, so candidates
 * cost nothing to find. Only those few are then counted exactly — checking
 * every column of every table directly would be hundreds of scans for a
 * weekly report.
 */
export async function findNullColumns(pool) {
  const { rows: candidates } = await pool.query(`
    SELECT s.tablename AS table_name, s.attname AS column_name
      FROM pg_stats s
      JOIN information_schema.columns c
        ON c.table_name = s.tablename AND c.column_name = s.attname
     WHERE s.schemaname = 'public'
       AND s.null_frac >= 1.0
       AND c.table_schema = 'public'
     ORDER BY 1, 2`);

  const out = [];
  for (const c of candidates) {
    // Statistics can be stale, so confirm before reporting it as fact.
    if (!/^[a-z_][a-z0-9_]*$/.test(c.table_name) || !/^[a-z_][a-z0-9_]*$/.test(c.column_name)) continue;
    const { rows } = await pool.query(
      `SELECT COUNT(*)::bigint AS total,
              COUNT("${c.column_name}")::bigint AS non_null
         FROM "${c.table_name}"`);
    out.push({ ...c, total: Number(rows[0].total), non_null: Number(rows[0].non_null) });
  }
  return out;
}

export async function listTables(pool) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY 1`);
  return rows.map((r) => r.table_name);
}

// ── assembling the zone ─────────────────────────────────────────────────────

/**
 * @param {string} root  repository root
 */
export async function runIntegrityChecks(pool, { root, now = new Date().toISOString() } = {}) {
  const serverFiles = readAll(path.join(root, 'server/src'), ['.js']);
  const clientFiles = readAll(path.join(root, 'src'), ['.js', '.jsx']);

  const routes = registeredRoutes(serverFiles);
  const requested = requestedPaths(clientFiles);
  const tables = await listTables(pool);
  const nullCols = describeNullColumns(await findNullColumns(pool));

  return {
    checked_at: now,
    dead_paths: deadPaths({ requested, routes }),
    uncalled_routes: uncalledRoutes({ requested, routes }),
    unreferenced_tables: unreferencedTables({ tables, serverFiles }),
    null_columns: nullCols,
    scanned: { server_files: serverFiles.length, client_files: clientFiles.length,
               routes: routes.size, tables: tables.length },
  };
}
