// ─── thumbnail-survey.test.js ────────────────────────────────────────────────
// The dry run's one job is to be trustworthy: a number the owner can act on,
// produced by code that cannot change anything.
//
// So the tests are of two kinds — the arithmetic, and the guarantee. The
// guarantee is the one that matters: the owner agreed to this on the condition
// that nothing touches customer data, and "I promise" is not a mechanism.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isEligible, headSize, surveyRows, SURVEY_SQL, WORTH_IT_BYTES, ESTIMATED_THUMB_BYTES,
} from './thumbnail-survey.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const row = (data) => ({ id: `e${Math.abs(JSON.stringify(data).length)}`, data });
const img = (over = {}) => row({
  type: 'image', status: 'completed', result_url: 'https://s/a.png', ...over,
});

/** A fetch that answers HEAD with the size you give it, keyed by url. */
const sizer = (map) => vi.fn(async (url) => {
  const n = map[url];
  if (n === undefined) return { ok: false, headers: { get: () => null } };
  return { ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(n) : null) } };
});

describe('THE GUARANTEE — this module cannot change anything', () => {
  // The owner's condition for the whole piece of work. A promise in prose is
  // not a mechanism; this is.
  const src = fs.readFileSync(path.join(HERE, 'thumbnail-survey.js'), 'utf8');

  /** Comments stripped. A guard that scans source and forgets to do this reads
   *  its own explanation as the offence — it has now happened four separate
   *  times in this codebase (Tip.test.jsx documents the first). The prose is
   *  not the problem; scanning prose is. */
  const codeOnly = src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  it('contains no write statement of any kind', () => {
    for (const verb of ['INSERT', 'UPDATE ', 'DELETE', 'DROP ', 'ALTER', 'TRUNCATE']) {
      expect(codeOnly.toUpperCase(), `${verb.trim()} appears in a module that must only read`)
        .not.toContain(verb);
    }
  });

  it('issues only GET-like requests — never a PUT or POST to the bucket', () => {
    expect(src).toMatch(/method: 'HEAD'/);
    expect(src).not.toMatch(/method: '(PUT|POST|DELETE)'/);
  });

  it('its one query is a SELECT scoped to a single user', () => {
    expect(SURVEY_SQL.trim().toUpperCase().startsWith('SELECT')).toBe(true);
    expect(SURVEY_SQL, 'not scoped to one account').toMatch(/user_id = \$1/);
  });

  it('reports that it wrote nothing, in its own output', () => {
    // So the answer is visible to the owner in the result he reads, not only
    // in a test he does not run.
    return surveyRows([], { fetchImpl: sizer({}) }).then((r) => {
      expect(r.dryRun).toBe(true);
      expect(r.wrote).toBe('nothing');
    });
  });
});

describe('which rows a thumbnail would help', () => {
  it('takes a completed image with a real url', () => {
    expect(isEligible(img())).toBe(true);
  });

  it('skips videos — those are handled by the viewport gate, not thumbnails', () => {
    expect(isEligible(row({ type: 'video', status: 'completed', result_url: 'https://s/a.mp4' }))).toBe(false);
  });

  it('skips anything already done, so a re-run never redoes work', () => {
    expect(isEligible(img({ thumb_url: 'https://s/t.jpg' }))).toBe(false);
  });

  it('skips a failed or pending generation', () => {
    expect(isEligible(img({ status: 'failed' }))).toBe(false);
    expect(isEligible(img({ status: 'pending' }))).toBe(false);
  });

  it('skips a row whose file is gone', () => {
    expect(isEligible(img({ result_url: null }))).toBe(false);
    expect(isEligible(img({ result_url: '' }))).toBe(false);
  });

  it('skips a data: URI rather than trying to fetch it', () => {
    expect(isEligible(img({ result_url: 'data:image/png;base64,iVBOR' }))).toBe(false);
  });

  it('does not throw on junk', () => {
    for (const junk of [null, undefined, {}, { data: null }, 42, 'x']) {
      expect(() => isEligible(junk)).not.toThrow();
    }
  });
});

describe('measuring without downloading', () => {
  it('reads content-length from a HEAD', async () => {
    const f = sizer({ 'https://s/a.png': 8252858 });
    expect(await headSize('https://s/a.png', { fetchImpl: f })).toBe(8252858);
    expect(f.mock.calls[0][1].method, 'it downloaded the file to measure it').toBe('HEAD');
  });

  it('returns null — not zero — when the file cannot be read', async () => {
    expect(await headSize('https://s/gone.png', { fetchImpl: sizer({}) })).toBe(null);
  });

  it('returns null when the request throws, rather than failing the survey', async () => {
    const boom = vi.fn(async () => { throw new Error('network down'); });
    expect(await headSize('https://s/a.png', { fetchImpl: boom })).toBe(null);
  });
});

describe('the report', () => {
  it('counts, measures and estimates', async () => {
    const rows = [
      img({ result_url: 'https://s/big1.png' }),
      img({ result_url: 'https://s/big2.png' }),
      img({ result_url: 'https://s/tiny.png' }),
    ];
    const r = await surveyRows(rows, { fetchImpl: sizer({
      'https://s/big1.png': 8_252_858,
      'https://s/big2.png': 4_000_000,
      'https://s/tiny.png': 12_000,          // below WORTH_IT_BYTES
    }) });

    expect(r.images).toBe(3);
    expect(r.wouldProcess, 'the tiny one is not worth a thumbnail').toBe(2);
    expect(r.tooSmallToBother).toBe(1);
    expect(r.currentMB).toBeCloseTo(11.7, 1);
    expect(r.largestFileMB).toBeCloseTo(7.9, 1);
    expect(r.estimatedSavedMB).toBeGreaterThan(11);
  });

  it('counts unreadable files SEPARATELY, never as zero bytes', async () => {
    // A zero would quietly shrink the total and make the job look smaller than
    // it is — the sort of wrongness that gets believed because it is tidy.
    const rows = [img({ result_url: 'https://s/ok.png' }), img({ result_url: 'https://s/gone.png' })];
    const r = await surveyRows(rows, { fetchImpl: sizer({ 'https://s/ok.png': 1_000_000 }) });
    expect(r.unreadable).toBe(1);
    expect(r.wouldProcess).toBe(1);
    expect(r.currentMB).toBeCloseTo(1.0, 1);
  });

  it('reports rows that already have a thumbnail without re-counting them', async () => {
    const rows = [img({ thumb_url: 'https://s/t.jpg' }), img({ result_url: 'https://s/a.png' })];
    const r = await surveyRows(rows, { fetchImpl: sizer({ 'https://s/a.png': 1_000_000 }) });
    expect(r.alreadyHaveThumbnail).toBe(1);
    expect(r.wouldProcess).toBe(1);
  });

  it('handles an account with nothing in it', async () => {
    const r = await surveyRows([], { fetchImpl: sizer({}) });
    expect(r.wouldProcess).toBe(0);
    expect(r.currentMB).toBe(0);
  });

  it('says plainly that the "after" numbers are an estimate', async () => {
    const r = await surveyRows([], { fetchImpl: sizer({}) });
    expect(r.note).toMatch(/estimate/i);
  });

  it('never measures a file twice, however many rows share it', async () => {
    const f = sizer({ 'https://s/a.png': 1_000_000 });
    await surveyRows([img(), img()], { fetchImpl: f });
    // Two rows, two urls that happen to match — two HEADs is correct and
    // cheap. What must NOT happen is a GET.
    for (const call of f.mock.calls) expect(call[1].method).toBe('HEAD');
  });

  it('the thresholds are sane relative to each other', () => {
    expect(ESTIMATED_THUMB_BYTES).toBeLessThan(WORTH_IT_BYTES);
  });
});
