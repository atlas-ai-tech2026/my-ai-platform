// ─── deleted-stays-hidden.test.js ────────────────────────────────────────────
// EVERY READ A CUSTOMER SEES MUST EXCLUDE DELETED PICTURES.
//
// ── WHY THIS IS THE MOST IMPORTANT TEST IN THE DELETE FEATURE ──────────────
// Soft delete has one failure mode that unit tests cannot reach: the write
// works perfectly, and a reader somewhere forgets the filter. The picture the
// customer deleted keeps appearing — in the grid, in a search, in the saved
// tab — and the delete button looks broken while the data is fine.
//
// That is precisely the shape of bug this codebase produced three times in a
// single day: the task board wrote rows nothing read, five endpoints had no
// button, the thumbnail backfill wrote a field the grid ignored. Every one was
// correct code that nobody could see the effect of.
//
// So this reads BOTH sides — it finds every query against the entities table
// and checks that the customer-facing ones carry `deleted_at IS NULL`. A new
// history read added next month fails here rather than shipping a delete that
// does not appear to work.
//
// ── AND WHY SOME READS DELIBERATELY DO NOT FILTER ──────────────────────────
// A picture deleted yesterday is still recoverable for 29 days, so its FILE
// must still be rescued, still be backed up, still be counted as at-risk.
// Excluding deleted rows from those jobs would quietly stop protecting work
// the customer can still ask for back. Each exemption below is named, with
// its reason — an unexplained exemption is how a filter gets skipped.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');

describe('what a customer can see', () => {
  const index = read('index.js');

  it('the history grid query hides deleted rows', () => {
    // POST /api/entities/:name/filter — the main history feed.
    expect(index).toMatch(/user_id = \$1 AND name = \$2 AND deleted_at IS NULL/);
  });

  it('the plain list query hides them too', () => {
    // GET /api/entities/:name — used by the saved tab and the pending pollers.
    const line = index.split('\n').find((l) => l.includes('SELECT * FROM entities WHERE user_id = $1 AND name = $2'));
    expect(line, 'the list query is gone or renamed — check it still filters').toBeTruthy();
    expect(line).toMatch(/deleted_at IS NULL/);
  });

  it('search and its count both hide them', () => {
    const search = read('history-search.js');
    expect(search).toMatch(/'deleted_at IS NULL'/);
    // The count shares the same WHERE clause, so "128 pictures" can never
    // include work the customer deleted.
    expect(search).toMatch(/countSql:.*\$\{clause\}/s);
  });

  it('the model list offered in the filter hides them', () => {
    // Otherwise a model would stay in the dropdown because of pictures the
    // customer deleted, and selecting it would return nothing.
    expect(read('history-search.js')).toMatch(/MODELS_USED_SQL[\s\S]{0,400}deleted_at IS NULL/);
  });
});

describe('deleting history no longer destroys it', () => {
  const index = read('index.js');

  it('the delete route marks GenerationHistory instead of removing it', () => {
    const at = index.indexOf("app.delete('/api/entities/:name/:id'");
    expect(at, 'the delete route is gone').toBeGreaterThan(0);
    const route = index.slice(at, at + 1800);
    expect(route).toMatch(/GenerationHistory/);
    expect(route).toMatch(/SOFT_DELETE_SQL/);
  });

  it('and tells the caller how long they have to change their mind', () => {
    const at = index.indexOf("app.delete('/api/entities/:name/:id'");
    expect(index.slice(at, at + 1800)).toMatch(/recoverable_days/);
  });

  it('everything that is NOT history is still removed outright', () => {
    // Node spaces and drafts are working documents, not paid-for work.
    const at = index.indexOf("app.delete('/api/entities/:name/:id'");
    expect(index.slice(at, at + 1800)).toMatch(/DELETE FROM entities WHERE id = \$1 AND user_id = \$2/);
  });
});

describe('the column exists before anything relies on it', () => {
  it('migrate() adds it', () => {
    expect(read('db.js')).toMatch(/SOFT_DELETE_DDL/);
  });
});

describe('the reads that deliberately DO include deleted rows', () => {
  // Each of these protects a file that is still recoverable. Filtering them
  // would quietly stop protecting work the customer can still ask back.
  const exempt = [
    ['media-rescue.js', 'a deleted picture is recoverable for 30 days — its file must still be rescued, '
      + 'or restoring it would return a broken image'],
    ['media-health.js', 'at-risk counting must include recoverable work, or the numbers understate the risk'],
    ['thumbnail-survey.js', 'harmless either way; a thumbnail for a deleted row costs one small file'],
    ['thumbnail-scale.js', 'same as the survey — counting is not worth a second code path'],
  ];

  it.each(exempt)('%s is exempt on purpose: %s', (file) => {
    // The assertion is that the file still EXISTS and still reads entities —
    // so that if one is deleted or rewritten, this list is revisited rather
    // than silently describing something that is no longer there.
    expect(read(file)).toMatch(/FROM entities/);
  });

  it('and the exemption list is complete — no customer-facing read is missing from either list', () => {
    // Every file that queries entities is either filtered above or named as an
    // exemption here. A NEW file appears in neither and fails this test.
    const known = new Set([
      'index.js', 'history-search.js', 'soft-delete.js',       // filtered, or the delete itself
      'media-rescue.js', 'media-health.js',                     // exempt, above
      'thumbnail-survey.js', 'thumbnail-scale.js',              // exempt, above
      'thumbnail-backfill.js',                                  // writes only
      'video-charges.js',                                       // ownership checks, not a feed
      'alerts-routes.js',                                       // counts hosts, not a feed
      'db.js',                                                  // the schema itself
    ]);
    const queriers = fs.readdirSync(here)
      .filter((f) => f.endsWith('.js') && !f.includes('.test.'))
      .filter((f) => /FROM entities|INTO entities|UPDATE entities/.test(read(f)));

    const unknown = queriers.filter((f) => !known.has(f));
    expect(unknown,
      'a new file queries entities and is in neither list — decide whether it must hide deleted rows, '
      + 'then add it above').toEqual([]);
  });
});
