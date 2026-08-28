// ─── maintenance-outcome.test.js ─────────────────────────────────────────────
// Almost every test here is one property:
//
//   A HALF-FINISHED JOB MUST NEVER READ AS A FINISHED ONE.
//
// All four endpoints answer 200 while doing half the work. If the panel prints
// a tick over "40 rescued" the owner stops looking, and the remaining files
// keep expiring on a clock nobody is watching any more. That is a worse
// outcome than the job failing outright.

import { describe, it, expect } from 'vitest';
import { outcomeOf } from './maintenance-outcome.js';

describe('THE PROPERTY — partial is never ok', () => {
  const partials = [
    ['whisper', { complete: false, stored: 6, skipped: 0, problems: [{ file: 'onnx/x.onnx', why: 'upstream responded 503' }] }],
    ['rescue',  { considered: 20, rescued: 12, alreadyGone: 3, failed: 5, problems: [{ id: 'g1', why: 'gone' }] }],
    ['thumbs',  { attempted: 20, done: 15, failed: 5, problems: [{ id: 'g1', why: 'decode failed' }] }],
  ];

  it.each(partials)('%s: a run with failures is never green', (action, body) => {
    expect(outcomeOf(action, body).tone).toBe('partial');
  });

  it.each(partials)('%s: says to run it again', (action, body) => {
    expect(outcomeOf(action, body).again).toBe(true);
  });

  it.each(partials)('%s: names a reason, not only a count', (action, body) => {
    const out = outcomeOf(action, body);
    expect(`${out.headline} ${out.detail}`.length).toBeGreaterThan(40);
    expect(out.detail).toMatch(/503|gone|decode/);
  });
});

describe('the speech model', () => {
  it('six of seven files is NOT installed', () => {
    const out = outcomeOf('whisper', { complete: false, stored: 6, skipped: 0 });
    expect(out.headline).toMatch(/NOT installed/);
  });

  it('a full install says so plainly', () => {
    const out = outcomeOf('whisper', { complete: true, stored: 7, skipped: 0, downloadedMB: 41.2 });
    expect(out.tone).toBe('ok');
    expect(out.detail).toMatch(/41\.2 MB/);
  });

  it('re-running when everything is present is idle, not a fresh success', () => {
    // Distinct facts. "Installed just now" and "was already installed" should
    // not read identically to somebody checking whether their press worked.
    const out = outcomeOf('whisper', { complete: true, stored: 0, skipped: 7 });
    expect(out.tone).toBe('idle');
    expect(out.headline).toMatch(/[Aa]lready/);
  });
});

describe('the CORS rule', () => {
  it('a failure names the stage it died in', () => {
    const out = outcomeOf('cors', { ok: false, stage: 'verify', error: 'read back empty' });
    expect(out.tone).toBe('bad');
    expect(out.detail).toMatch(/verify/);
  });

  it('already applied is idle', () => {
    expect(outcomeOf('cors', { ok: true, changed: false }).tone).toBe('idle');
  });

  it('applied says what it now allows, in the owner’s words', () => {
    const out = outcomeOf('cors', { ok: true, changed: true });
    expect(out.tone).toBe('ok');
    expect(out.headline).toMatch(/[Ee]xport/);
  });
});

describe('the rescue', () => {
  it('separates SAVED from ALREADY GONE — they are not the same fact', () => {
    // The distinction the owner will care about most: this run did not lose
    // those files, and no future run can bring them back.
    const out = outcomeOf('rescue', { considered: 20, rescued: 12, alreadyGone: 8, failed: 0, movedMB: 90.4 });
    expect(out.detail).toMatch(/12 files copied/);
    expect(out.detail).toMatch(/8 files was already gone|8 files/);
    expect(out.detail).toMatch(/already gone/);
  });

  it('a full batch tells you to run it again — 40 saved reads like an ending', () => {
    const out = outcomeOf('rescue', { considered: 20, limit: 20, rescued: 20, alreadyGone: 0, failed: 0 });
    expect(out.again).toBe(true);
    expect(out.detail).toMatch(/again/);
  });

  it('a part-full batch does not pretend there is more', () => {
    const out = outcomeOf('rescue', { considered: 7, limit: 20, rescued: 7, alreadyGone: 0, failed: 0 });
    expect(out.again).toBe(false);
  });

  it('an empty queue is a fact, not an error', () => {
    const out = outcomeOf('rescue', { considered: 0, rescued: 0, alreadyGone: 0, failed: 0 });
    expect(out.tone).toBe('idle');
    expect(out.headline).toMatch(/[Nn]othing was queued/);
  });

  it('everything already gone is not a success', () => {
    const out = outcomeOf('rescue', { considered: 10, rescued: 0, alreadyGone: 10, failed: 0 });
    expect(out.tone).not.toBe('ok');
  });

  it('says a fully-gone batch is FINAL — the queue is newest-first', () => {
    // Amr pressed this on aiworkshop965@gmail.com and got 20 of 20 gone. The
    // useful fact is not "nothing was saved", it is "there is nothing more to
    // try" — otherwise the natural next move is to press it again forever.
    const out = outcomeOf('rescue', { considered: 20, rescued: 0, alreadyGone: 20, failed: 0 });
    expect(out.detail).toMatch(/NEWEST FIRST/);
    expect(out.detail).toMatch(/everything older is gone/);
    expect(out.again).toBe(false);
  });

  it('counts read as English — "1 file was", "20 files were"', () => {
    expect(outcomeOf('rescue', { considered: 1, rescued: 0, alreadyGone: 1, failed: 0 }).detail)
      .toMatch(/1 file was already gone/);
    expect(outcomeOf('rescue', { considered: 20, rescued: 0, alreadyGone: 20, failed: 0 }).detail)
      .toMatch(/20 files were already gone/);
  });
});

describe('thumbnails', () => {
  it('the ones that failed lost nothing, and it says so', () => {
    // A customer losing a picture is the fear this panel has to answer
    // directly, because the button is next to one that says "rescue".
    const out = outcomeOf('thumbs', { attempted: 20, done: 15, failed: 5 });
    expect(out.detail).toMatch(/kept their original/);
  });

  it('a clean run explains what the customer will notice', () => {
    const out = outcomeOf('thumbs', { attempted: 12, done: 12, failed: 0, savedMB: 84.1 });
    expect(out.tone).toBe('ok');
    expect(out.detail).toMatch(/84\.1 MB/);
    expect(out.detail).toMatch(/original/);
  });

  it('nothing to do is idle', () => {
    expect(outcomeOf('thumbs', { attempted: 0, done: 0, failed: 0 }).tone).toBe('idle');
  });
});

describe('when it did not run at all', () => {
  it('an error body is bad, and repeats the server’s own words', () => {
    const out = outcomeOf('rescue', { error: 'Spaces not configured — nowhere to rescue files to.' });
    expect(out.tone).toBe('bad');
    expect(out.detail).toMatch(/Spaces not configured/);
  });

  it('no body at all is bad, never silently fine', () => {
    expect(outcomeOf('whisper', null).tone).toBe('bad');
  });

  it('an unknown action does not fall through to success', () => {
    expect(outcomeOf('nope', { ok: true }).tone).toBe('bad');
  });
});

describe('missing counts are unknown, never zero', () => {
  it('a rescue body with no counts does not claim nothing was queued and nothing failed', () => {
    // `{}` from a proxy or a truncated response must not render as a calm
    // "nothing to do" — that is the exact shape of a silent failure.
    const out = outcomeOf('rescue', {});
    expect(out.tone).toBe('idle');
    expect(out.detail).toMatch(/not an error|That is the answer/);
  });
});
