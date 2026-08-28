// ─── slow-image.test.js ──────────────────────────────────────────────────────
// One property matters more than everything else here:
//
//   AN IMAGE THAT SUCCEEDED IS NEVER REFUNDED, AND NEVER LOST.
//
// That is the exact bug. Six customers on 2026-08-28 were refunded for images
// that finished at 94s, 97s, 125s, 130s, 144s and 314s — every one a success
// we had already paid for and then thrown away. So most of these tests exist
// to make that outcome impossible rather than unlikely.
//
// The second property is subtler and comes from running TWO app instances with
// a customer who may have two tabs open: four things can race to deliver one
// image. Delivering twice writes the picture into history twice; refunding a
// delivered one hands back credits for something the customer has.

import { describe, it, expect, vi } from 'vitest';
import {
  verdictFor, sweepJobs, historyRowFor, GIVE_UP_AFTER_MS,
  CLAIM_SQL, GIVE_UP_SQL, RECORD_SQL, DUE_SQL, SLOW_IMAGE_DDL,
} from './slow-image.js';

const ok = (url = 'https://kie/img.png') => ({ state: 'success', resultUrls: [url] });
const pending = { state: 'pending', resultUrls: [] };
const failed = (msg = 'nsfw') => ({ state: 'fail', resultUrls: [], failMsg: msg });

/** A working world: the provider answers, the bucket accepts, nobody races. */
function harness(over = {}) {
  const saved = []; const settled = []; const refunded = [];
  return {
    saved, settled, refunded,
    deps: {
      check: vi.fn(async () => ok()),
      persist: vi.fn(async (u) => ({ url: `https://spaces/${u.split('/').pop()}`, thumbUrl: `https://spaces/thumb-${u.split('/').pop()}` })),
      claim: vi.fn(async (_id, url) => ({ user_id: 7, model_label: 'Nano Banana Pro', prompt: 'a cat', ratio: '1:1', quality: '2K', url })),
      giveUp: vi.fn(async () => 7),
      saveRow: vi.fn(async (row, url, thumbUrl) => { saved.push({ row, url, thumbUrl }); }),
      settle: vi.fn(async (id) => { settled.push(id); }),
      refund: vi.fn(async (id, why) => { refunded.push({ id, why }); }),
      touch: vi.fn(async () => {}),
      ...over,
    },
  };
}
const job = (over = {}) => ({ task_id: 't1', family: 'jobs', age_ms: 120_000, ...over });

describe('THE PROPERTY — a success is never refunded', () => {
  it('the six real cases from production all deliver', async () => {
    // 94, 97, 125, 130, 144, 314 seconds. Every one was refunded on the day.
    for (const secs of [94, 97, 125, 130, 144, 314]) {
      const h = harness();
      const r = await sweepJobs([job({ age_ms: secs * 1000 })], h.deps);
      expect(r.delivered, `${secs}s should be delivered`).toBe(1);
      expect(r.refunded).toBe(0);
    }
  });

  it('even a success found AFTER the give-up deadline is delivered, not swept', async () => {
    // The deadline stops us WAITING. It must never discard an answer already
    // in hand — that would be the original bug with a longer fuse.
    const h = harness();
    const r = await sweepJobs([job({ age_ms: GIVE_UP_AFTER_MS + 60_000 })], h.deps);
    expect(r.delivered).toBe(1);
    expect(h.deps.refund).not.toHaveBeenCalled();
  });

  it('verdictFor puts success ahead of the age check', () => {
    expect(verdictFor(ok(), GIVE_UP_AFTER_MS * 10)).toMatchObject({ do: 'deliver' });
  });
});

describe('what each provider answer means', () => {
  it('still working, and young → wait', () => {
    expect(verdictFor(pending, 60_000)).toEqual({ do: 'wait' });
  });

  it('still working, and old → refund, saying how long it waited', () => {
    const v = verdictFor(pending, GIVE_UP_AFTER_MS);
    expect(v.do).toBe('refund');
    expect(v.why).toMatch(/20 minutes/);
  });

  it('a real failure → refund, carrying the provider’s own reason', () => {
    expect(verdictFor(failed('content flagged'), 5_000))
      .toEqual({ do: 'refund', why: 'content flagged' });
  });

  it('"success" with no image is a failure, not a delivery', () => {
    // Delivering this would write a history row pointing at nothing.
    const v = verdictFor({ state: 'success', resultUrls: [] }, 5_000);
    expect(v.do).toBe('refund');
    expect(v.why).toMatch(/no image/);
  });

  it('the give-up window is generous against the worst case seen (314s)', () => {
    expect(GIVE_UP_AFTER_MS).toBeGreaterThan(314_000 * 3);
  });
});

describe('exactly once, with two instances and two tabs', () => {
  it('losing the claim writes NO history row and settles nothing', async () => {
    // The browser got there first and has already written the row — with the
    // camera metadata this sweeper does not have.
    const h = harness({ claim: vi.fn(async () => null) });
    const r = await sweepJobs([job()], h.deps);
    expect(r.delivered).toBe(0);
    expect(h.deps.saveRow).not.toHaveBeenCalled();
    expect(h.deps.settle).not.toHaveBeenCalled();
  });

  it('losing the give-up race does NOT refund a delivered image', async () => {
    // The worst possible double-spend: credits handed back for a picture the
    // customer already has.
    const h = harness({ check: vi.fn(async () => failed()), giveUp: vi.fn(async () => null) });
    const r = await sweepJobs([job()], h.deps);
    expect(r.refunded).toBe(0);
    expect(h.deps.refund).not.toHaveBeenCalled();
  });

  it('the claim is a conditional UPDATE off pending — the lock, not a read', () => {
    expect(CLAIM_SQL).toMatch(/status\s*=\s*'delivered'/);
    expect(CLAIM_SQL).toMatch(/AND status = 'pending'/);
    expect(CLAIM_SQL).toMatch(/RETURNING/);
  });

  it('giving up is the same shape, so it cannot beat a delivery', () => {
    expect(GIVE_UP_SQL).toMatch(/AND status = 'pending'/);
  });

  it('recording a job twice is harmless', () => {
    expect(RECORD_SQL).toMatch(/ON CONFLICT \(task_id\) DO NOTHING/);
  });
});

describe('the order that stops an image going missing', () => {
  it('re-hosts BEFORE claiming, so a bucket failure leaves it retryable', async () => {
    const h = harness({ persist: vi.fn(async () => { throw new Error('spaces down'); }) });
    const r = await sweepJobs([job()], h.deps);
    expect(h.deps.claim).not.toHaveBeenCalled();
    expect(r.delivered).toBe(0);
    expect(r.problems[0].why).toMatch(/spaces down/);
  });

  it('a provider url is never written to history — it expires in ~14 days', async () => {
    const h = harness();
    await sweepJobs([job()], h.deps);
    expect(h.saved[0].url).toMatch(/spaces/);
    expect(h.saved[0].url).not.toMatch(/kie/);
  });

  it('writes history BEFORE settling, so a paid image is never invisible', async () => {
    const order = [];
    const h = harness({
      saveRow: vi.fn(async () => { order.push('history'); }),
      settle: vi.fn(async () => { order.push('settle'); }),
    });
    await sweepJobs([job()], h.deps);
    expect(order).toEqual(['history', 'settle']);
  });

  it('if history fails the charge stays pending — visible, still refundable', async () => {
    const h = harness({ saveRow: vi.fn(async () => { throw new Error('db down'); }) });
    const r = await sweepJobs([job()], h.deps);
    expect(h.deps.settle).not.toHaveBeenCalled();
    expect(r.problems).toHaveLength(1);
  });
});

describe('one bad job does not stop the rest', () => {
  it('keeps going after a throw, and names what broke', async () => {
    let n = 0;
    const h = harness({
      check: vi.fn(async () => { n += 1; if (n === 2) throw new Error('kie 500'); return ok(); }),
    });
    const r = await sweepJobs([job({ task_id: 'a' }), job({ task_id: 'b' }), job({ task_id: 'c' })], h.deps);
    expect(r.looked).toBe(3);
    expect(r.delivered).toBe(2);
    expect(r.problems).toEqual([{ taskId: 'b', why: 'kie 500' }]);
  });

  it('an empty sweep is a clean report, not a crash', async () => {
    const h = harness();
    expect(await sweepJobs([], h.deps)).toMatchObject({ looked: 0, delivered: 0, problems: [] });
    expect(await sweepJobs(null, h.deps)).toMatchObject({ looked: 0 });
  });
});

describe('a late picture still gets its small version', () => {
  it('the thumbnail from the re-host reaches saveRow', async () => {
    // Otherwise a late-delivered image is a full-size download in the grid —
    // the slow-grid bug re-entering one row at a time.
    const h = harness();
    await sweepJobs([job()], h.deps);
    expect(h.saved[0].thumbUrl).toMatch(/thumb-/);
  });

  it('and lands in the history row', () => {
    expect(historyRowFor({}, 'u', 'https://spaces/t.jpg').thumb_url).toBe('https://spaces/t.jpg');
  });

  it('no thumbnail is an ABSENT field, never an empty string', () => {
    // `thumb_url: ''` would make the grid render a broken image instead of
    // falling back to the original.
    expect(historyRowFor({}, 'u', null)).not.toHaveProperty('thumb_url');
    expect(historyRowFor({}, 'u')).not.toHaveProperty('thumb_url');
  });
});

describe('the row a sweeper writes', () => {
  it('carries what it actually knows', () => {
    const row = historyRowFor(
      { model_label: 'Nano Banana Pro', prompt: 'a cat', ratio: '16:9', quality: '2K' },
      'https://spaces/x.png');
    expect(row).toMatchObject({
      type: 'image', model: 'Nano Banana Pro', prompt: 'a cat',
      result_url: 'https://spaces/x.png', status: 'completed', ratio: '16:9',
    });
  });

  it('INVENTS NO camera metadata — that lives in the browser', () => {
    // A made-up lens or f-stop would be a lie written into the customer's own
    // history, and indistinguishable from one they chose.
    const row = historyRowFor({ model_label: 'X' }, 'u');
    for (const f of ['camera', 'lens', 'lens_type', 'focal_length', 'fstop', 'style']) {
      expect(row, `${f} must not be invented`).not.toHaveProperty(f);
    }
  });

  it('marks itself late, so the hand-off rate is answerable from the data', () => {
    expect(historyRowFor({}, 'u').late).toBe(true);
  });

  it('never writes an undefined model into history', () => {
    expect(historyRowFor({}, 'u').model).toBeTruthy();
  });
});

describe('the table', () => {
  it('holds enough to rebuild a history row without the browser', () => {
    for (const col of ['task_id', 'user_id', 'family', 'model_label', 'prompt', 'ratio', 'quality']) {
      expect(SLOW_IMAGE_DDL).toContain(col);
    }
  });

  it('cascades with the user — a deleted account leaves no orphan jobs', () => {
    expect(SLOW_IMAGE_DDL).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/);
  });

  it('the sweeper reads only open jobs, oldest first', () => {
    expect(DUE_SQL).toMatch(/status = 'pending'/);
    expect(DUE_SQL).toMatch(/ORDER BY created_at ASC/);
    expect(DUE_SQL).toMatch(/LIMIT/);
  });
});
