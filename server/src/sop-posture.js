// ─── sop-posture.js ──────────────────────────────────────────────────────────
// The security zone: what is still OPEN, and what could silently come UNDONE.
//
// ── WHY THIS IS NOT A LIST OF THE 18 FINDINGS ──────────────────────────────
// N1–N18 and C1–M6 are completed code changes. Re-listing them weekly produces
// eighteen permanently-green ticks, which is a plaque, not a check — and
// eighteen of them would bury the handful of things that are genuinely open.
//
// So each finding becomes an ASSERTION THAT FAILS IF THE FIX WERE UNDONE, plus
// the items that are still outstanding. The question is never "was this fixed?"
// but "is it still true?".
//
// The strongest one by far is the admin-gate scan. Routes get added to this
// codebase most weeks; a new /api/admin/* route registered without adminGate is
// an unauthenticated hole in the control panel, and nothing else would catch it.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Admin paths that are deliberately NOT behind adminGate, with the reason.
 * An unexplained entry here is how an exception list becomes a hiding place.
 */
export const UNGATED_BY_DESIGN = {
  // (none today — every /api/admin/* route is gated)
};

/** Items known to be open. Each needs an owner action, not a code change. */
export const OPEN_ITEMS = [
  {
    key: 'anthropic-key',
    label: 'Rotate the Anthropic API key',
    detail: 'OCR_LLM_AUTH_TOKEN was reachable by an unpinned CI action before that was fixed.',
    action: 'Generate a new key and replace it in DigitalOcean.',
  },
  {
    key: 'cloudflare-origin',
    label: 'The origin answers without Cloudflare',
    detail: 'voxel-ai.ai sits behind DIGITALOCEAN\'S Cloudflare, not your own account, and the '
      + '.ondigitalocean.app hostname answers the public internet directly.',
    action: 'Move DNS to your own Cloudflare account, then set ORIGIN_SHARED_SECRET. The guard is '
      + 'already deployed and inert, waiting for it.',
  },
  // ── REMOVED 2026-08-21: THERE ARE NO PRE-M1 BACKUPS ───────────────────────
  // This asked the owner to decide what to do about backups taken before the M1
  // fix, which "still hold those passwords in the clear". No such backup exists.
  //
  //   M1 — passwords scrubbed      2026-08-01 23:20
  //   M3 — backups first written   2026-08-01 23:41
  //
  // Twenty-one minutes apart, and git confirms no backup mechanism existed
  // before that commit. Every archive was written after the scrub.
  //
  // It sat here for three weeks as an open decision with no subject, and on
  // 2026-08-21 the owner was about to download and store encrypted archives to
  // protect data that had never been in them. A hand-maintained list can show a
  // false RED — sop-sources.js says exactly that, as the reason the kind is
  // permitted at all — and this is what one looks like in practice.
  //
  // Deliberately NOT replaced with a green "nothing to decide" line. A screen
  // that lists resolved non-problems is how the real ones get lost.
  {
    key: 'xlsx',
    label: 'Decide on the xlsx dependency',
    detail: 'Its advisories are unfixable upstream. Porting to exceljs is 1–2 hours.',
    action: 'Port it, or accept and record the decision.',
  },
];

// ── the assertions ──────────────────────────────────────────────────────────

/**
 * Every `/api/admin/*` route must carry adminGate.
 *
 * PURE over source text so it is exhaustively testable. This is the assertion
 * most likely to catch a real regression: routes are added often, and one
 * registered without the gate is an unauthenticated hole that no test, lint or
 * type check would notice.
 */
export function findUngatedAdminRoutes(serverFiles, expected = UNGATED_BY_DESIGN) {
  const bad = [];
  // Capture the registration up to the handler, so the middleware list is visible.
  const re = /\bapp\.(get|post|put|patch|delete)\s*\(\s*['"`](\/api\/admin\/[^'"`]*)['"`]\s*,([^)]*?)(?:async\s*)?\(/g;
  for (const { file, src } of serverFiles) {
    for (const m of src.matchAll(re)) {
      const [, method, routePath, middleware] = m;
      if (expected[routePath]) continue;
      if (/\badminGate\b|\brequireAdmin\b/.test(middleware)) continue;
      bad.push(`${method.toUpperCase()} ${routePath} (${path.basename(file)})`);
    }
  }
  return bad.sort();
}

/** Config that must be true for the system to be safe, checked live. */
export function checkSecurityConfig(env = process.env) {
  const problems = [];
  const notes = [];

  if (String(env.MAIL_TEST_MODE || '').toLowerCase() === 'true') {
    problems.push('MAIL_TEST_MODE is TRUE — password resets are not being delivered');
  }
  if (!(env.JWT_SECRET || '').trim()) problems.push('JWT_SECRET is unset');
  if (!(env.BACKUP_ENCRYPTION_PASSPHRASE || '').trim()) {
    problems.push('BACKUP_ENCRYPTION_PASSPHRASE is unset — backups would be unreadable');
  }

  const secret = (env.ORIGIN_SHARED_SECRET || '').trim();
  // Stated as a NOTE, so this line stays green — and it was printing a live
  // weakness under a FINE badge, two lines above the same fact in yellow.
  // It is genuinely tracked elsewhere (#54, blocked on the DNS move), so the
  // fix is to say that rather than to raise a second alarm for one problem.
  if (!secret) notes.push('origin guard inert until the DNS move — see \u201cThe origin answers without Cloudflare\u201d below');
  else if (secret.length < 16) problems.push('ORIGIN_SHARED_SECRET is too short to be a secret');

  const ttl = String(env.ADMIN_JWT_EXPIRES_IN || '2h');
  notes.push(`admin session ${ttl} of inactivity`);

  return { problems, notes };
}

/**
 * Node runtime still supported?
 *
 * Production ran Node 20 for 110 days after it stopped receiving security
 * patches, and nothing said so. A version being newer is noise; a version
 * being past END OF LIFE is a deadline with a security consequence.
 */
export const NODE_EOL = { 18: '2025-04-30', 20: '2026-04-30', 22: '2027-04-30', 24: '2028-04-30' };

export function checkRuntimeSupport(version = process.version, now = new Date()) {
  const major = Number(/(\d+)/.exec(String(version))?.[1]);
  const eol = NODE_EOL[major];
  if (!eol) return { state: 'unknown', detail: `Node ${major} is not in the schedule — add it.` };
  const days = Math.floor((Date.parse(eol) - now.getTime()) / 864e5);
  if (days < 0) {
    return { state: 'critical', days,
      detail: `Node ${major} reached end of life on ${eol} — it receives NO security patches.` };
  }
  if (days < 120) {
    return { state: 'warn', days,
      detail: `Node ${major} loses security support in ${days} days (${eol}).` };
  }
  return { state: 'ok', days, detail: `Node ${major}, supported until ${eol} (${days} days).` };
}

// ── assembling the zone ─────────────────────────────────────────────────────

function readServerFiles(root) {
  const dir = path.join(root, 'server/src');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !f.includes('.test.'))
    .map((f) => ({ file: path.join(dir, f), src: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

export function runPostureChecks({ root, env = process.env, version = process.version, now = new Date() }) {
  const files = readServerFiles(root);
  return {
    checked_at: now.toISOString(),
    ungated_admin_routes: findUngatedAdminRoutes(files),
    config: checkSecurityConfig(env),
    runtime: checkRuntimeSupport(version, now),
    open_items: OPEN_ITEMS,
    scanned_files: files.length,
  };
}
