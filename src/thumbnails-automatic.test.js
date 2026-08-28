// ─── thumbnails-automatic.test.js ────────────────────────────────────────────
// A small version is FIVE pieces of code, and it is worth nothing unless all
// five are joined:
//
//   1. the server makes one when the picture is saved
//   2. the generate response CARRIES it to the browser
//   3. the browser puts it in the history row it writes
//   4. the late-delivery path (status route + sweeper) does the same
//   5. the grid reads it
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
// Because this exact thing has now half-shipped TWICE.
//
// First: the backfill wrote `thumb_url` and NOTHING in the frontend read it. I
// told Amr "the images should appear almost instantly". They could not have.
//
// Second, today: the grid read it, the button wrote it, and nothing created
// one at generation time — so the control-panel card I wrote saying "new
// generations already get one automatically" was false while it sat on
// production.
//
// Twice is the point at which a rule stops being enough and has to become a
// check. Every link below is one that has already been the broken one.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
/** Comments here NAME the broken values, so scan code only. */
const code = (f) => read(f).split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .join('\n');

const server = code('server/src/index.js');
const page = code('src/pages/Image.jsx');

describe('1 — the server makes one at save time', () => {
  it('the image path calls persistWithThumb, not the plain re-host', () => {
    expect(server).toMatch(/persistWithThumb\(/);
  });

  it('and uses the SAME resizer as the backfill button', () => {
    // Two resizers would drift and the grid would show two sizes of "small".
    expect(server).toMatch(/import \{ makeThumbnail \} from '\.\/thumbnail-backfill\.js'/);
  });
});

describe('2 — the response carries it', () => {
  it('/api/generate returns thumb_url', () => {
    expect(server).toMatch(/thumb_url: thumbUrl/);
  });

  it('and omits the field rather than sending an empty one', () => {
    // `thumb_url: ''` makes the grid render a broken image instead of falling
    // back to the original.
    expect(server).toMatch(/\.\.\.\(thumbUrl \? \{ thumb_url: thumbUrl \} : \{\}\)/);
  });
});

describe('3 — the browser writes it into history', () => {
  it('Image.jsx reads thumb_url off the response', () => {
    expect(page).toMatch(/response\.data\?\.thumb_url/);
  });

  it('and includes it in the History_.create call — THE LINK THAT WAS MISSING', () => {
    const at = page.indexOf('History_.create({');
    expect(at, 'nothing creates a history row any more').toBeGreaterThan(0);
    expect(page.slice(at, at + 700)).toMatch(/thumb_url/);
  });
});

describe('4 — a LATE picture gets one too', () => {
  it('the status route re-hosts with a thumbnail', () => {
    const at = server.indexOf("'/api/image-status'");
    expect(server.slice(at, at + 3000)).toMatch(/persistWithThumb/);
  });

  it('and sends it to the browser', () => {
    const at = server.indexOf("'/api/image-status'");
    expect(server.slice(at, at + 3000)).toMatch(/thumb_url: thumbUrl/);
  });

  it('the sweeper — which writes its own row — re-hosts with one as well', () => {
    const at = server.indexOf('async function sweepSlowImages');
    expect(server.slice(at, at + 2500)).toMatch(/persistWithThumb/);
  });

  it('and passes it into the row it writes', () => {
    const at = server.indexOf('async function sweepSlowImages');
    expect(server.slice(at, at + 2500)).toMatch(/historyRowFor\(job, url, thumbUrl\)/);
  });

  it('the waiting client passes the thumbnail back to the page', () => {
    expect(code('src/lib/wait-for-image.js')).toMatch(/thumbUrl: answer\.thumb_url/);
  });
});

describe('5 — the grid reads it, and falls back safely', () => {
  it('the image grid prefers the small version', () => {
    expect(page).toMatch(/src=\{img\.thumbUrl \|\| img\.url\}/);
  });

  it('the history mapping carries it', () => {
    expect(page).toMatch(/thumbUrl: r\.thumb_url \|\| null/);
  });

  it('the Edit library reads it too', () => {
    expect(code('src/components/edit/MediaLibrary.jsx')).toMatch(/r\.thumb_url \|\| r\.result_url/);
  });

  it('EVERY reader falls back to the full-size file — a missing thumbnail is slow, never broken', () => {
    for (const [file, re] of [
      ['src/pages/Image.jsx', /img\.thumbUrl \|\| img\.url/],
      ['src/components/edit/MediaLibrary.jsx', /r\.thumb_url \|\| r\.result_url/],
    ]) {
      expect(code(file), `${file} must fall back`).toMatch(re);
    }
  });
});

describe('and the control panel no longer claims something untrue', () => {
  it('the card does not say new generations get one automatically... unless they do', () => {
    // This assertion flips meaning once the automatic path is live: the claim
    // is now TRUE, so the card may state it. It exists to make sure the two
    // are never out of step again in EITHER direction.
    const card = read('src/components/admin/MaintenancePanel.jsx');
    const claimsAutomatic = /already get one automatically/.test(card);
    const isAutomatic = /persistWithThumb\(/.test(server);
    expect(claimsAutomatic && !isAutomatic,
      'the panel claims automatic thumbnails that nothing creates').toBe(false);
  });
});
