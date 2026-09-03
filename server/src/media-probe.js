// ─── media-probe.js ──────────────────────────────────────────────────────────
// How long is this video? Answered from the file itself, never from the client.
//
// Motion Control is billed per second of the reference clip — by kie, and so
// by us (owner, 2026-09-03: every Kling choice runs on kie, priced through the
// 40% calculator). The browser already knows the length (it read the metadata
// to enforce 3–30 s) and sends it along, but a price resting on a number the
// customer's browser supplies is the C1 hole again: declare duration:3 for a
// 30-second clip and pay a tenth. So the server reads the length itself from
// the MP4/MOV container — the `mvhd` box inside `moov` carries timescale and
// duration — and the browser's figure is only a cross-check.
//
// Reads by HTTP Range, so a 100 MB upload costs a few kilobytes: walk the
// top-level boxes (ftyp, free, mdat, moov, …) from the head of the file and
// fetch only the `moov` box once found. Phones write moov AFTER the mdat, so
// it usually sits near the end; the walk skips mdat by its declared size.
//
// WebM/Matroska is not parsed (it is EBML, a different container). For those
// the probe returns null and the caller falls back to the declared duration,
// saying so in the log — an honest fallback, not a silent one.

const HEAD_BYTES = 64 * 1024;      // first request: most desktop encoders put moov here
const MAX_MOOV_BYTES = 16 * 1024 * 1024;
const MAX_FULL_BODY = 64 * 1024 * 1024; // a server that ignores Range hands back the whole file
const REQUEST_TIMEOUT_MS = 8000;

/** Box header at `off`: { size, type, header } — size 0 means "to end of file". */
function readBoxHeader(buf, off) {
  if (off + 8 > buf.length) return null;
  let size = buf.readUInt32BE(off);
  const type = buf.toString('latin1', off + 4, off + 8);
  let header = 8;
  if (size === 1) {
    if (off + 16 > buf.length) return null;
    size = Number(buf.readBigUInt64BE(off + 8));
    header = 16;
  }
  return { size, type, header };
}

/** Duration from a complete `moov` box buffer, or null. */
function durationFromMoov(moov) {
  const top = readBoxHeader(moov, 0);
  if (!top || top.type !== 'moov') return null;
  let off = top.header;
  const end = top.size === 0 ? moov.length : Math.min(moov.length, top.size);
  while (off + 8 <= end) {
    const box = readBoxHeader(moov, off);
    if (!box || box.size < 8 && box.size !== 0) return null;
    if (box.type === 'mvhd') {
      const b = off + box.header;              // version(1) flags(3) follow the header
      const version = moov[b];
      // v0: creation(4) modification(4) timescale(4) duration(4)
      // v1: creation(8) modification(8) timescale(4) duration(8)
      if (version === 1) {
        if (b + 4 + 16 + 4 + 8 > moov.length) return null;
        const timescale = moov.readUInt32BE(b + 4 + 16);
        const duration = Number(moov.readBigUInt64BE(b + 4 + 20));
        return timescale > 0 ? duration / timescale : null;
      }
      if (b + 4 + 8 + 4 + 4 > moov.length) return null;
      const timescale = moov.readUInt32BE(b + 4 + 8);
      const duration = moov.readUInt32BE(b + 4 + 12);
      return timescale > 0 ? duration / timescale : null;
    }
    if (box.size === 0) break;
    off += box.size;
  }
  return null;
}

/**
 * Duration in seconds of an MP4/MOV held entirely in memory, or null when the
 * buffer is not an ISO-BMFF file or carries no readable mvhd.
 */
export function mp4DurationSeconds(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  let off = 0;
  while (off + 8 <= buf.length) {
    const box = readBoxHeader(buf, off);
    if (!box) return null;
    if (box.type === 'moov') return durationFromMoov(buf.subarray(off, box.size === 0 ? buf.length : off + box.size));
    if (box.size === 0) return null;
    if (box.size < 8) return null;
    off += box.size;
  }
  return null;
}

function decodeDataUri(url) {
  const m = /^data:([^;,]*);base64,(.+)$/s.exec(url);
  return m ? Buffer.from(m[2], 'base64') : null;
}

/**
 * Duration in seconds of the video at `url`, read from the file with Range
 * requests. Returns null when the container is not MP4/MOV, the server cannot
 * be read, or the moov box is unreasonably large — the caller decides what a
 * null means (Motion Control: fall back to the declared length, logged).
 *
 * `fetchImpl` is injectable for tests. Never throws.
 */
export async function probeVideoDurationSeconds(url, { fetchImpl = fetch, maxRequests = 12, tag = 'MEDIA-PROBE' } = {}) {
  try {
    if (typeof url !== 'string' || !url) return null;
    if (url.startsWith('data:')) {
      const buf = decodeDataUri(url);
      return buf ? mp4DurationSeconds(buf) : null;
    }

    let requests = 0;
    const range = async (start, endInclusive) => {
      if (++requests > maxRequests) throw new Error('too many range requests');
      const resp = await fetchImpl(url, {
        headers: { Range: `bytes=${start}-${endInclusive}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (resp.status === 200) {
        // Range ignored — the whole file came back. Bounded, then parsed whole.
        const len = Number(resp.headers.get('content-length') || 0);
        if (len > MAX_FULL_BODY) throw new Error('file too large to read whole');
        return { whole: true, buf: Buffer.from(await resp.arrayBuffer()), total: len || null };
      }
      if (resp.status !== 206) throw new Error(`HTTP ${resp.status}`);
      const cr = /\/(\d+)\s*$/.exec(resp.headers.get('content-range') || '');
      return { whole: false, buf: Buffer.from(await resp.arrayBuffer()), total: cr ? Number(cr[1]) : null };
    };

    const head = await range(0, HEAD_BYTES - 1);
    if (head.whole) return mp4DurationSeconds(head.buf);
    const total = head.total;

    let off = 0;
    let buf = head.buf;   // the bytes we hold, starting at file offset `base`
    let base = 0;
    for (;;) {
      if (off - base + 16 > buf.length) {
        if (total != null && off + 8 > total) return null;
        const chunk = await range(off, off + 15);
        if (chunk.whole) return mp4DurationSeconds(chunk.buf);
        buf = chunk.buf; base = off;
      }
      const box = readBoxHeader(buf, off - base);
      if (!box) return null;
      if (box.type === 'moov') {
        const size = box.size === 0 ? (total != null ? total - off : 0) : box.size;
        if (size <= 0 || size > MAX_MOOV_BYTES) return null;
        const have = buf.length - (off - base);
        const moov = have >= size
          ? buf.subarray(off - base, off - base + size)
          : (await range(off, off + size - 1)).buf;
        return durationFromMoov(moov);
      }
      if (box.size === 0 || box.size < 8) return null;
      off += box.size;
      if (total != null && off >= total) return null;
    }
  } catch (e) {
    console.error(`[${tag}] could not read duration: ${e.message}`);
    return null;
  }
}
