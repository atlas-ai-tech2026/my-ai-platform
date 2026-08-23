// ─── history-loading.test.js ─────────────────────────────────────────────────
// A guard on HOW the library pages load, not on what they render.
//
// Both Image and Video used to loop through the entire history on every page
// load — 200 rows at a time, sequentially, until a page came back short. The
// customers who generate most waited longest, and it was the first thing an
// attendee saw in a workshop.
//
// The loop is easy to re-add by accident, because it is the obvious way to
// make a "show me everything" feature work: whoever next needs the full list
// for a filter, a count, or an export will reach for exactly this shape. So
// the rule is written down where it will fail loudly instead of living in a
// comment somebody has to read first.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

/**
 * Source with whole-line comments removed.
 *
 * Needed because the comments in these files QUOTE the old code they replaced
 * — the first version of this guard failed on its own explanation of what not
 * to do. Dropping whole comment lines only: stripping from the first `//`
 * anywhere would also truncate any line containing a URL, and a guard that
 * silently stops seeing code is worse than one that never existed.
 */
const code = (f) => read(f)
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  })
  .join('\n');

const PAGES = ['Image.jsx', 'Video.jsx'];

describe('no page downloads the whole history to paint a grid', () => {
  for (const file of PAGES) {
    it(`${file} does not loop until the pages run out`, () => {
      const src = code(file);

      // The exact shape that was here: a bounded for-loop around a paged
      // fetch, ending on a short page. Matching the SHAPE rather than the old
      // text, so a rewrite with different variable names still trips it.
      const loops = [...src.matchAll(/for\s*\(\s*(?:let|const|var)\s+\w+\s*=\s*0\s*;[^)]*\)/g)];
      const offenders = loops.filter((m) => {
        const body = src.slice(m.index, m.index + 700);
        return /History_\.filter|History_\.list|\.filter\(\s*\{/.test(body)
          && /offset|page/i.test(body);
      });

      expect(
        offenders.map((m) => `${file}:${src.slice(0, m.index).split('\n').length}`),
        'a loop that pages through the whole history is back',
      ).toEqual([]);
    });

    it(`${file} asks for one page at a time through the shared feed`, () => {
      expect(code(file), `${file} should load history via useHistoryFeed`)
        .toMatch(/useHistoryFeed\s*\(/);
    });
  }
});

describe('a subset the grid does not hold must be asked of the SERVER', () => {
  // This is the part that makes the change more than "load less". Three
  // features quietly depended on the whole history being in memory, and two
  // of them fail SILENTLY when it is not: a saved image from six months ago
  // vanishes, and a video still rendering never updates. Both read as lost
  // work, not as a paging limit.

  it('the Saved tab is a server query, not a filter over the loaded page', () => {
    const src = code('Image.jsx');

    expect(src, 'Saved must ask the server for saved rows')
      .toMatch(/filter\(\s*\{\s*type:\s*'image',\s*saved:\s*true\s*\}/);

    // The old line was `images.filter(img => img.saved)`. Over a full download
    // that was correct; over one page it hides somebody's favourites.
    expect(
      /\.filter\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.saved\b/.test(src),
      'Saved is filtering the loaded page again — an image saved months ago will be missing',
    ).toBe(false);
  });

  it('still-rendering videos are found by their own query, not by which page they landed on', () => {
    const src = code('Video.jsx');

    expect(src, 'pending videos must be fetched directly so depth cannot hide them')
      .toMatch(/filter\(\s*\{\s*type:\s*'video',\s*status:\s*'pending'\s*\}/);
  });

  it('polling the same video twice cannot leak an interval that never stops', () => {
    // Two callers can now reach pollVideo (the pending sweep and
    // handleGenerate). Without the guard the second overwrites the stored
    // interval id and the first runs forever.
    expect(code('Video.jsx')).toMatch(/if\s*\(\s*pollingRef\.current\[\s*recordId\s*\]\s*\)\s*return/);
  });
});
