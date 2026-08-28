// ─── thumbnails-are-used.test.js ─────────────────────────────────────────────
// A thumbnail nobody looks at is a wasted upload and a false success.
//
// ── WHAT THIS ALMOST WAS ───────────────────────────────────────────────────
// The backfill was built, tested, deployed to production and pointed at the
// owner with the words "the images should appear almost instantly". Nothing in
// the frontend read `thumb_url`. Running it would have made twenty thumbnails,
// reported success, and changed NOTHING on his screen.
//
// That is the exact shape of the task-board failure already recorded in
// CLAUDE.md: upsertTask was correct, the seed skipped existing rows, and what
// was written never reached the screen. A green result from the piece you
// built says nothing about whether anyone can see it.
//
// So the writer and the reader are held together here.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Every grid that draws a customer's own images. */
const GRIDS = [
  { file: 'src/pages/Image.jsx', field: 'thumbUrl' },
  { file: 'src/components/edit/MediaLibrary.jsx', field: 'thumb_url' },
];

describe('the thumbnail is actually READ, not just written', () => {
  for (const { file, field } of GRIDS) {
    it(`${file} prefers the thumbnail in the grid`, () => {
      const src = read(file);
      expect(src, `${file} never mentions the thumbnail — the backfill would change nothing`)
        .toContain(field);
      // The fallback matters as much as the preference: most rows have no
      // thumbnail yet, and they must keep showing the original rather than
      // a blank cell.
      expect(src, 'no fallback to the original — rows without a thumbnail would go blank')
        .toMatch(new RegExp(`${field}\\s*\\|\\|`));
    });
  }

  it('the server writes the SAME field name the client reads', () => {
    // A rename on one side is invisible until somebody looks at a grid.
    expect(read('server/src/thumbnail-backfill.js')).toContain("'{thumb_url}'");
    expect(read('src/pages/Image.jsx')).toContain('r.thumb_url');
  });
});

describe('opening a picture still gets the full original', () => {
  // The thumbnail is 320px wide. Showing it full-screen would be a blurry
  // rectangle, and the customer would think the platform had degraded their
  // work rather than that a grid cell got faster.
  for (const file of ['src/components/image/ImageLightbox.jsx', 'src/components/image/ImageDetailModal.jsx']) {
    it(`${file} shows the original, never the thumbnail`, () => {
      const src = read(file);
      expect(src, 'the full-size view is showing a 320px thumbnail').not.toMatch(/thumb/i);
    });
  }
});
