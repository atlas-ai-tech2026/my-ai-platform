// ─── grid-media-weight.test.js ───────────────────────────────────────────────
// A grid of thumbnails must not download the full files.
//
// ── WHAT THIS COST ─────────────────────────────────────────────────────────
// Two video grids shipped with `preload="auto"`, which tells the browser to
// download the ENTIRE video for every card — including every card below the
// fold. A customer with twenty finished videos pulled tens of megabytes to
// paint one screen of thumbnails, and reported it as "my files take forever
// to open".
//
// `preload="metadata"` fetches only the header, about 13 KB, which is all
// `#t=0.1` needs to show a first frame. The Edit library had it right from the
// start; these two grids were the only ones left on "auto".
//
// ── WHY THIS IS A NAMED LIST AND NOT A SWEEP ───────────────────────────────
// I wrote the sweep first: walk every .jsx, find media tags inside a `.map(`,
// flag the eager ones. It reported forty-four, then twenty-one, then three —
// and the last three were ALL false positives. One was a <textarea>. The
// reason is that matching a `.map(` callback by counting parentheses breaks on
// JSX: arrow functions and nested calls unbalance the count, one range runs
// away to the end of the file, and everything after it looks "repeated".
//
// That is the same trap Tip.test.jsx already documents about capturing
// attributes with a regex. A guard that cries wolf is a guard somebody
// deletes, and then the real bug comes back — so this one names the surfaces
// that actually show a customer their own media, and checks those exactly.
//
// A NEW grid of customer media must be added here. That is a real cost of this
// approach and it is the lesser one.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Every surface that draws a LIST of the customer's own generations. */
const MEDIA_GRIDS = [
  'components/video/SeedanceRightPanel.jsx',
  'components/video/SeedanceMediaGrid.jsx',
  'components/edit/MediaLibrary.jsx',
  'pages/Image.jsx',
];

/** Comments stripped, so the note explaining the bug is not read as the bug. */
function code(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
}

describe('no media grid downloads whole videos to draw thumbnails', () => {
  for (const file of MEDIA_GRIDS) {
    it(`${file} never preloads a video eagerly`, () => {
      const src = code(file);
      if (!/<video\b/.test(src)) return;          // no videos here, nothing to check
      expect(
        /preload="auto"/.test(src),
        'preload="auto" downloads every file in full — tens of MB to paint one screen',
      ).toBe(false);
      expect(src, 'a grid video must say metadata explicitly, not rely on the default')
        .toMatch(/preload="metadata"/);
    });
  }
});

describe('no media grid loads its images eagerly', () => {
  for (const file of MEDIA_GRIDS) {
    it(`${file} defers off-screen images`, () => {
      const src = code(file);
      const remote = [...src.matchAll(/<img\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => /src=\{[^}]*(url|result_url|previewUrl|thumb)[^}]*\}/i.test(tag));
      if (!remote.length) return;
      const eager = remote.filter((tag) => !/loading="lazy"/.test(tag));
      expect(
        eager.map((t) => t.slice(0, 70).replace(/\s+/g, ' ')),
        'an eager grid image queues the first visible row behind every off-screen one',
      ).toEqual([]);
    });
  }
});

describe('the two that actually broke stay fixed', () => {
  // Named separately from the loop so that shortening MEDIA_GRIDS by accident
  // cannot silently un-guard the pair this whole file exists for.
  for (const f of ['components/video/SeedanceRightPanel.jsx', 'components/video/SeedanceMediaGrid.jsx']) {
    it(`${f} is on metadata`, () => {
      expect(code(f)).toMatch(/preload="metadata"/);
      expect(code(f)).not.toMatch(/preload="auto"/);
    });
  }
});
