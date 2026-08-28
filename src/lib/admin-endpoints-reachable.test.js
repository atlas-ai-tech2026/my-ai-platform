// ─── admin-endpoints-reachable.test.js ───────────────────────────────────────
// EVERY MUTATING ADMIN ENDPOINT MUST HAVE SOMETHING THAT CAN CALL IT.
//
// ── THE BUG THIS IS THE FIX FOR ────────────────────────────────────────────
// Five endpoints — the file rescue, the thumbnail backfill, the bucket's CORS
// rule, the speech model, the backup passphrase check — were written, tested,
// reviewed and deployed, and NOT ONE OF THEM COULD BE PRESSED. The owner was
// told each was ready. Each was unreachable.
//
// The reason is specific and easy to repeat: a GET can be run by pasting its
// url in the address bar while signed in as admin, which is how the media
// health check was run. A POST cannot — it needs the CSRF header, and the only
// thing that sends that header is src/lib/adminApi.js. So a mutating endpoint
// with no entry in that file is code that exists and cannot be reached.
//
// This is the same shape as the task board: upsertTask was correct and tested,
// the seed skipped existing rows, and nothing ever reached the screen. RULE 2
// in CLAUDE.md — verify the EFFECT, not the change — is written because of it.
// A unit test on the handler cannot see this. Only a test that looks at both
// sides can.
//
// ── IF THIS FAILS ──────────────────────────────────────────────────────────
// Either add a line to adminApi.js and a control that calls it, or delete the
// endpoint. An endpoint nobody can reach is not a feature.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const server = fs.readFileSync(path.join(root, 'server/src/index.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/lib/adminApi.js'), 'utf8');

/** Route files registered separately still ship their own client callers. */
const MUTATING = /app\.(post|put|patch|delete)\(\s*'(\/api\/admin\/[^']*)'/g;

function endpoints(src) {
  return [...src.matchAll(MUTATING)].map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));
}

/**
 * Does the client mention every literal segment of this path?
 *
 * Deliberately loose. adminApi builds several paths by template
 * (`/api/admin/users/${id}/credits`), so an exact string match would fail on
 * working code — and a guard that cries wolf gets deleted. Matching every
 * literal segment is enough to catch a route NOTHING references, which is the
 * actual failure.
 */
function reachable(p) {
  return p.split('/').filter(Boolean)
    .filter((seg) => !seg.startsWith(':'))
    .every((seg) => client.includes(seg));
}

describe('every admin endpoint that WRITES can be pressed', () => {
  const found = endpoints(server);

  it('finds the routes at all — a guard watching nothing is worse than none', () => {
    expect(found.length).toBeGreaterThan(10);
  });

  it.each(found.map((e) => [`${e.method} ${e.path}`, e.path]))(
    '%s has a caller in adminApi.js',
    (_label, p) => {
      expect(
        reachable(p),
        'This endpoint cannot be reached from any screen. A POST needs the CSRF header, '
        + 'and adminApi.js is the only thing that sends it — pasting the url in the address '
        + 'bar will not work. Add a client method and a control, or delete the route.',
      ).toBe(true);
    },
  );
});

describe('the five that were unreachable stay reachable', () => {
  // Named individually so a regression says WHICH one went dark, rather than
  // making somebody re-derive the story from a generic failure.
  it.each([
    ['the file rescue', '/api/admin/media-rescue'],
    ['the thumbnail backfill', '/api/admin/thumbnails/backfill'],
    ['the bucket CORS rule', '/api/admin/media-cors'],
    ['the speech model', '/api/admin/whisper-model'],
    ['the backup passphrase check', '/api/admin/backup/passphrase-check'],
  ])('%s', (_name, p) => {
    expect(server, 'the endpoint itself is gone').toContain(`'${p}'`);
    expect(reachable(p)).toBe(true);
  });
});

describe('and something actually renders the buttons', () => {
  // adminApi.js having a method is necessary and not sufficient — a client
  // method nobody calls is exactly as unreachable as no method at all.
  const panel = fs.readFileSync(
    path.join(root, 'src/components/admin/MaintenancePanel.jsx'), 'utf8');
  const sop = fs.readFileSync(path.join(root, 'src/components/admin/SopTab.jsx'), 'utf8');

  it.each(['mediaRescue', 'thumbsBackfill', 'mediaCors', 'whisperModel', 'passphraseCheck'])(
    'the panel calls adminApi.%s',
    (method) => { expect(panel).toContain(`adminApi.${method}`); },
  );

  it('and the panel is on a screen the owner opens', () => {
    // Rendered, not merely imported. This is the step that was missed.
    expect(sop).toMatch(/<MaintenancePanel/);
  });
});
