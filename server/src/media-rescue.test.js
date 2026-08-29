// ─── media-rescue.test.js ────────────────────────────────────────────────────
// This is the only code in the platform that rewrites `result_url` — the field
// that decides whether a customer can see their own work.
//
// So almost every test below asks the same question in a different way: when
// something goes wrong, does it leave the record ALONE? A rescue that writes a
// broken link over a working one destroys exactly what it was written to save.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsRescue, rescueRows, RESCUE_SQL, MAX_BYTES, MARK_GONE_SQL, REMAINING_SQL, RESCUE_QUEUE_SQL} from './media-rescue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OURS = ['voxel-ai-store.nyc3.digitaloceanspaces.com', 'voxel-ai-store.nyc3.cdn.digitaloceanspaces.com'];
const PROVIDER = 'https://tempfile.aiquickdraw.com/k/abc_1784736686_7086.mp4';

const row = (url = PROVIDER, id = `e-${Math.random().toString(36).slice(2, 8)}`) =>
  ({ id, data: { type: 'video', status: 'completed', result_url: url } });

/** A working provider, a working bucket, an honest verifier. */
function harness(over = {}) {
  const writes = [];
  const body = Buffer.from('x'.repeat(2048));
  const deps = {
    ourHosts: OURS,
    fetchImpl: vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => body,
    })),
    persist: vi.fn(async () => `${OURS[1]}/generations/video/new.mp4`),
    verify: vi.fn(async () => body.length),
    setUrls: vi.fn(async (id, originUrl, newUrl) => { writes.push({ id, originUrl, newUrl }); }),
    ...over,
  };
  return { writes, deps, body };
}

describe('THE WRITE — what it can and cannot reach', () => {
  const src = fs.readFileSync(path.join(HERE, 'media-rescue.js'), 'utf8');
  const codeOnly = src.split('\n')
    .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
    .join('\n');

  it('touches exactly two fields, by explicit path', () => {
    expect(RESCUE_SQL).toMatch(/'\{origin_url\}'/);
    expect(RESCUE_SQL).toMatch(/'\{result_url\}'/);
  });

  it('is not a merge — a merge could reach anything', () => {
    expect(RESCUE_SQL).not.toMatch(/data\s*\|\|/);
  });

  it('is scoped to one row AND one user', () => {
    expect(RESCUE_SQL).toMatch(/id = \$3/);
    expect(RESCUE_SQL).toMatch(/user_id = \$4/);
  });

  it('never bumps updated_date — a rescue should be invisible', () => {
    expect(RESCUE_SQL).not.toMatch(/updated_date/);
  });

  it('deletes nothing, anywhere in the file', () => {
    // Not the provider copy, not ours. The provider removes theirs on their
    // own schedule; that is the thing being raced.
    for (const verb of ['DELETE', 'DROP ', 'TRUNCATE', 'DeleteObject']) {
      expect(codeOnly.toUpperCase()).not.toContain(verb.toUpperCase());
    }
  });
});

describe('which rows it touches', () => {
  it('takes a provider-hosted file', () => {
    expect(needsRescue(row(), { ourHosts: OURS })).toBe(true);
  });

  it('SKIPS one already in our bucket — re-copying is pure waste', () => {
    expect(needsRescue(row(`${OURS[0]}/generations/video/a.mp4`), { ourHosts: OURS })).toBe(false);
  });

  it('skips one already on our CDN', () => {
    expect(needsRescue(row(`${OURS[1]}/generations/video/a.mp4`), { ourHosts: OURS })).toBe(false);
  });

  it('is not fooled by our bucket name inside another host', () => {
    expect(needsRescue(row('https://voxel-ai-store.evil.com/a.mp4'), { ourHosts: OURS })).toBe(true);
  });

  it('skips a row with no usable url rather than trying', () => {
    for (const u of ['', null, 'data:image/png;base64,iVBOR', '/media/a.mp4']) {
      expect(needsRescue(row(u), { ourHosts: OURS })).toBe(false);
    }
  });

  it('does not throw on junk', () => {
    for (const junk of [null, undefined, {}, 42]) expect(() => needsRescue(junk, { ourHosts: OURS })).not.toThrow();
  });
});

describe('the happy path', () => {
  it('copies, verifies, then writes BOTH urls', async () => {
    const h = harness();
    const r = await rescueRows([row()], h.deps);
    expect(r.rescued).toBe(1);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].originUrl, 'the provider link must be kept').toBe(PROVIDER);
    expect(h.writes[0].newUrl).toContain('generations/video');
  });

  it('verifies our copy BEFORE writing, not after', async () => {
    const order = [];
    const h = harness({
      persist: vi.fn(async () => { order.push('upload'); return 'https://ours/new.mp4'; }),
      verify: vi.fn(async () => { order.push('verify'); return 2048; }),
      setUrls: vi.fn(async () => { order.push('write'); }),
    });
    await rescueRows([row()], h.deps);
    expect(order).toEqual(['upload', 'verify', 'write']);
  });
});

describe('EVERY failure leaves the record exactly as it was', () => {
  it('provider fetch fails → no write', async () => {
    const h = harness({ fetchImpl: vi.fn(async () => ({ ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) })) });
    const r = await rescueRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it('provider returns nothing → no write', async () => {
    const h = harness({ fetchImpl: vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) })) });
    await rescueRows([row()], h.deps);
    expect(h.writes).toHaveLength(0);
  });

  it('UPLOAD fails → no write. This is the one that would destroy data', async () => {
    // Writing here would point the record at an upload that never happened,
    // replacing a link that still worked.
    const h = harness({ persist: vi.fn(async () => { throw new Error('bucket refused'); }) });
    const r = await rescueRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(h.writes, 'it pointed a customer at a file that does not exist').toHaveLength(0);
  });

  it('upload returns no url → no write', async () => {
    const h = harness({ persist: vi.fn(async () => null) });
    await rescueRows([row()], h.deps);
    expect(h.writes).toHaveLength(0);
  });

  it('our copy cannot be read back → no write', async () => {
    // "The upload call returned" and "the bytes are readable" are different
    // claims, and this is not a place to assume the first implies the second.
    const h = harness({ verify: vi.fn(async () => null) });
    const r = await rescueRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it('our copy is the WRONG SIZE → no write', async () => {
    // A truncated upload is readable and still wrong.
    const h = harness({ verify: vi.fn(async () => 12) });
    const r = await rescueRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(h.writes).toHaveLength(0);
    expect(r.problems[0].why).toMatch(/expected/);
  });

  it('one bad row does not stop the others', async () => {
    let n = 0;
    const body = Buffer.from('x'.repeat(2048));
    const h = harness({
      fetchImpl: vi.fn(async () => {
        n += 1;
        if (n === 2) throw new Error('connection reset');
        return { ok: true, status: 200, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => body };
      }),
    });
    const r = await rescueRows([row(), row(), row()], h.deps);
    expect(r.rescued).toBe(2);
    expect(r.failed).toBe(1);
  });
});

describe('the ones it arrived too late for', () => {
  it('counts a 404 as ALREADY GONE, not as a failure', async () => {
    // The rescue did not lose these and could not have saved them. Reporting
    // them as failures would make it look broken when it is merely late.
    const h = harness({ fetchImpl: vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) })) });
    const r = await rescueRows([row()], h.deps);
    expect(r.alreadyGone).toBe(1);
    expect(r.failed).toBe(0);
    expect(h.writes).toHaveLength(0);
  });

  it('403 and 410 count the same way — expired links do both', async () => {
    for (const status of [403, 410]) {
      const h = harness({ fetchImpl: vi.fn(async () => ({ ok: false, status, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) })) });
      expect((await rescueRows([row()], h.deps)).alreadyGone).toBe(1);
    }
  });
});

describe('running it safely', () => {
  it('respects a limit, so a first run can be twenty rows', async () => {
    const h = harness();
    const r = await rescueRows([row(), row(), row(), row(), row()], { ...h.deps, limit: 2 });
    expect(r.considered).toBe(2);
    expect(h.writes).toHaveLength(2);
  });

  it('a second run does nothing, because the first moved them to our host', async () => {
    const h = harness();
    const rows = [row()];
    await rescueRows(rows, h.deps);
    rows[0].data.result_url = h.writes[0].newUrl.startsWith('http')
      ? h.writes[0].newUrl : `https://${h.writes[0].newUrl}`;
    rows[0].data.result_url = `https://${OURS[0]}/generations/video/new.mp4`;
    const second = await rescueRows(rows, h.deps);
    expect(second.considered).toBe(0);
  });

  it('refuses something absurd rather than pulling it into memory', async () => {
    const huge = Buffer.alloc(MAX_BYTES + 1);
    const h = harness({ fetchImpl: vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => huge })) });
    const r = await rescueRows([row()], h.deps);
    expect(r.failed).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it('reports what it saved, what was already lost, and what broke', async () => {
    const h = harness();
    const r = await rescueRows([row()], h.deps);
    expect(r).toHaveProperty('rescued');
    expect(r).toHaveProperty('alreadyGone');
    expect(r).toHaveProperty('failed');
    expect(r.movedMB).toBeGreaterThanOrEqual(0);
  });

  it('handles an account with nothing to rescue', async () => {
    const h = harness();
    const r = await rescueRows([], h.deps);
    expect(r).toMatchObject({ considered: 0, rescued: 0, failed: 0, alreadyGone: 0 });
  });
});

describe('who the write is scoped to', () => {
  it("passes the ROW's owner, not a scoped one", async () => {
    // Running across every account there is no single user id. Passing null
    // would make the guarded UPDATE match nothing and silently rescue zero
    // files while reporting success — the worst kind of quiet failure.
    const seen = [];
    const body = Buffer.from('x'.repeat(2048));
    const r = await rescueRows(
      [{ id: 'e1', user_id: 42, data: { result_url: PROVIDER } },
       { id: 'e2', user_id: 99, data: { result_url: PROVIDER } }],
      {
        ourHosts: OURS,
        fetchImpl: vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => body })),
        persist: vi.fn(async () => 'https://ours/new.mp4'),
        verify: vi.fn(async () => body.length),
        setUrls: vi.fn(async (id, o, n, userId) => { seen.push({ id, userId }); }),
      });
    expect(r.rescued).toBe(2);
    expect(seen.sort((a, b) => a.userId - b.userId)).toEqual([
      { id: 'e1', userId: 42 }, { id: 'e2', userId: 99 },
    ]);
  });
});

// ─── THE BACKGROUND RESCUE CONVERGES (2026-08-29) ───────────────────────────
// 12,568 files are still on provider links. At 60 per press that is 210
// presses, which nobody will do — so it has to run on its own.
//
// And a background rescue has one failure a human pressing a button does not:
// the queue is "rows whose file is not ours", newest first. A row whose file
// died months ago NEVER LEAVES that queue. Without a marker the sweeper takes
// the same newest twenty every pass, finds them all gone, and never reaches
// the ones still alive — running forever and saving nothing.
describe('a sweeper can tell which rows it has already given up on', () => {
  it('rescueRows reports the ids it found already gone', async () => {
    const rows = [
      { id: 'dead', user_id: 1, data: { result_url: 'https://gone.example/a.png' } },
      { id: 'alive', user_id: 1, data: { result_url: 'https://live.example/b.png' } },
    ];
    const r = await rescueRows(rows, {
      ourHosts: ['ours.example'],
      fetchImpl: async (u) => (u.includes('gone')
        ? { status: 404, ok: false }
        : { status: 200, ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('xy') }),
      persist: async () => 'https://ours.example/b.png',
      verify: async () => 2,
      setUrls: async () => {},
    });
    expect(r.alreadyGone).toBe(1);
    expect(r.goneIds).toEqual(['dead']);
    expect(r.rescued).toBe(1);
  });

  it('the queue SKIPS rows already marked gone, so the sweep moves forward', () => {
    expect(RESCUE_QUEUE_SQL).toMatch(/data->>'rescue_gone_at' IS NULL/);
  });

  it('the mark is ADDITIVE — the picture and its link are untouched', () => {
    // A customer whose file is gone loses nothing here; the row still shows
    // exactly as it did. This is a note to ourselves, not a change to them.
    expect(MARK_GONE_SQL).toMatch(/jsonb_set\(data, '\{rescue_gone_at\}'/);
    expect(MARK_GONE_SQL).not.toMatch(/result_url/);
  });

  it('and the remaining count ignores the ones already given up on', () => {
    // Otherwise the number never falls and the job looks like it is failing.
    expect(REMAINING_SQL).toMatch(/rescue_gone_at' IS NULL/);
    expect(REMAINING_SQL).toMatch(/count\(\*\)/);
  });

  it('a rescue that SUCCEEDS is not marked gone', async () => {
    const r = await rescueRows(
      [{ id: 'x', user_id: 1, data: { result_url: 'https://live.example/b.png' } }],
      {
        ourHosts: ['ours.example'],
        fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('xy') }),
        persist: async () => 'https://ours.example/b.png',
        verify: async () => 2,
        setUrls: async () => {},
      });
    expect(r.goneIds).toEqual([]);
  });

  it('a rescue that FAILED for another reason is not marked gone either', async () => {
    // A network blip must not permanently retire a file that still exists.
    const r = await rescueRows(
      [{ id: 'x', user_id: 1, data: { result_url: 'https://live.example/b.png' } }],
      {
        ourHosts: ['ours.example'],
        fetchImpl: async () => { throw new Error('network down'); },
        persist: async () => 'u', verify: async () => 1, setUrls: async () => {},
      });
    expect(r.failed).toBe(1);
    expect(r.goneIds).toEqual([]);
  });
});
