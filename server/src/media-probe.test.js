// ─── media-probe.test.js ─────────────────────────────────────────────────────
// Motion Control is billed per second of the reference clip, and the number of
// seconds must come from the FILE, not from the browser that uploaded it.
// These build small real MP4 structures and serve them through a fake fetch
// that honours Range, so the walk (ftyp → mdat → moov) is exercised exactly as
// it will be against Spaces.

import { describe, it, expect } from 'vitest';
import { mp4DurationSeconds, probeVideoDurationSeconds } from './media-probe.js';

function box(type, payload) {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + payload.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, payload]);
}

function mvhd({ version = 0, timescale, duration }) {
  if (version === 1) {
    const p = Buffer.alloc(4 + 8 + 8 + 4 + 8 + 80);
    p[0] = 1;
    p.writeUInt32BE(timescale, 4 + 16);
    p.writeBigUInt64BE(BigInt(duration), 4 + 20);
    return box('mvhd', p);
  }
  const p = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 80);
  p.writeUInt32BE(timescale, 4 + 8);
  p.writeUInt32BE(duration, 4 + 12);
  return box('mvhd', p);
}

/** ftyp + mdat(N bytes) + moov(mvhd) — the phone layout, moov last. */
function mp4({ mdatBytes = 300_000, timescale = 1000, duration = 7345, version = 0, moovFirst = false } = {}) {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomiso2mp41', 'latin1'));
  const mdat = box('mdat', Buffer.alloc(mdatBytes, 7));
  const moov = box('moov', Buffer.concat([mvhd({ version, timescale, duration }), box('trak', Buffer.alloc(40))]));
  return Buffer.concat(moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}

/** A fetch that serves `file` with byte ranges, counting requests. */
function rangeServer(file, { ignoreRange = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(opts?.headers?.Range || null);
    if (ignoreRange) {
      return new Response(file, { status: 200, headers: { 'content-length': String(file.length) } });
    }
    const m = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), file.length - 1);
    return new Response(file.subarray(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${file.length}` },
    });
  };
  return { fetchImpl, calls };
}

describe('mp4DurationSeconds — reading the file that is in memory', () => {
  it('reads timescale + duration from a version-0 mvhd', () => {
    expect(mp4DurationSeconds(mp4({ timescale: 1000, duration: 7345 }))).toBeCloseTo(7.345, 3);
  });

  it('reads a version-1 (64-bit) mvhd too', () => {
    expect(mp4DurationSeconds(mp4({ version: 1, timescale: 90000, duration: 90000 * 12 }))).toBe(12);
  });

  it('finds moov whether it comes before or after mdat', () => {
    expect(mp4DurationSeconds(mp4({ moovFirst: true, duration: 5000 }))).toBe(5);
    expect(mp4DurationSeconds(mp4({ moovFirst: false, duration: 5000 }))).toBe(5);
  });

  it('answers null — never a number — for something that is not an MP4', () => {
    expect(mp4DurationSeconds(Buffer.from('\x1aE\xdf\xa3 webm-ish bytes', 'latin1'))).toBeNull();
    expect(mp4DurationSeconds(Buffer.alloc(0))).toBeNull();
    expect(mp4DurationSeconds('not a buffer')).toBeNull();
  });
});

describe('probeVideoDurationSeconds — reading the file where it lives', () => {
  it('walks past a large mdat and fetches only the moov box (phone layout)', async () => {
    const file = mp4({ mdatBytes: 5_000_000, duration: 21_400 });
    const { fetchImpl, calls } = rangeServer(file);
    const secs = await probeVideoDurationSeconds('https://cdn.example/ref.mp4', { fetchImpl });
    expect(secs).toBeCloseTo(21.4, 3);
    // head (64 KB) + one 16-byte header at the moov offset + the moov itself.
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls[0]).toBe('bytes=0-65535');
  });

  it('needs a single request when moov is at the head of the file', async () => {
    const { fetchImpl, calls } = rangeServer(mp4({ moovFirst: true, duration: 4000 }));
    expect(await probeVideoDurationSeconds('https://cdn.example/ref.mp4', { fetchImpl })).toBe(4);
    expect(calls.length).toBe(1);
  });

  it('copes with a server that ignores Range and returns the whole file', async () => {
    const { fetchImpl } = rangeServer(mp4({ duration: 9000 }), { ignoreRange: true });
    expect(await probeVideoDurationSeconds('https://cdn.example/ref.mp4', { fetchImpl })).toBe(9);
  });

  it('reads a data: URI directly, without any request', async () => {
    const file = mp4({ duration: 3000 });
    const calls = [];
    const fetchImpl = async () => { calls.push(1); throw new Error('must not be called'); };
    const url = `data:video/mp4;base64,${file.toString('base64')}`;
    expect(await probeVideoDurationSeconds(url, { fetchImpl })).toBe(3);
    expect(calls).toEqual([]);
  });

  it('returns null, not a throw, when the file cannot be read', async () => {
    const fetchImpl = async () => new Response('nope', { status: 403 });
    expect(await probeVideoDurationSeconds('https://cdn.example/ref.mp4', { fetchImpl })).toBeNull();
  });

  it('returns null for a container it does not parse (WebM)', async () => {
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 1)]);
    const { fetchImpl } = rangeServer(webm);
    expect(await probeVideoDurationSeconds('https://cdn.example/ref.webm', { fetchImpl })).toBeNull();
  });

  it('gives up rather than loop on a file that never yields a moov', async () => {
    // A chain of tiny boxes far longer than the request budget.
    const junk = Buffer.concat(Array.from({ length: 200 }, () => box('free', Buffer.alloc(HEAD_BYTES_PLUS))));
    const { fetchImpl, calls } = rangeServer(junk);
    expect(await probeVideoDurationSeconds('https://cdn.example/ref.mp4', { fetchImpl, maxRequests: 5 })).toBeNull();
    expect(calls.length).toBeLessThanOrEqual(5);
  });
});

// Each box larger than the 64 KB head, so every hop is a new request.
const HEAD_BYTES_PLUS = 70 * 1024;
