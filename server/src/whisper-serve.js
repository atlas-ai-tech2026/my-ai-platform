// ─── whisper-serve.js ────────────────────────────────────────────────────────
// Serve the speech model from OUR OWN ORIGIN, as a fallback.
//
// ── WHY A FALLBACK EXISTS AT ALL ───────────────────────────────────────────
// The model already lives in the Spaces bucket, public and cached for a year,
// and the browser should fetch it straight from the CDN — that is the whole
// point of putting it there. But a cross-origin fetch can only be READ by the
// browser if the bucket returns an Access-Control-Allow-Origin header, and on
// 2026-08-30 the dev bucket returned none: `Vary: Origin` was present,
// allow-origin was absent, and a preflight answered 403.
//
// That is one admin button away from fixed (`/api/admin/media-cors`). But a
// feature that is silently dead until somebody remembers to press a button in
// a control panel is precisely the shape of failure this project keeps
// producing — six times in one day, at last count.
//
// So: the CDN is tried first and used when it works. This is what answers when
// it does not.
//
// ── AND WHY THIS IS NOT JUST "SERVE IT FROM HERE ALWAYS" ───────────────────
// Production is two 1-vCPU boxes. Twenty laptops in a workshop each pulling
// 40 MB through Express is 800 MB of streaming that the CDN would otherwise
// have absorbed for free, next to the box that is also answering /api/generate.
// The CDN is genuinely better; this is the safety net, and the lab page says
// out loud which of the two answered so the difference cannot go unnoticed.

import { MODEL_FILES, MODEL_PREFIX, keyFor } from './whisper-model.js';

/** Every key this route is allowed to return, built from the SAME list the
 *  installer uses — so the two cannot drift and a new model file cannot be
 *  reachable here without being an intended part of the model. */
export const SERVABLE = new Set(MODEL_FILES.map(keyFor));

/**
 * Turn a request path into a bucket key, or null.
 *
 * ── AN ALLOW-LIST, NOT PATH SANITISING ─────────────────────────────────────
 * The tempting version strips `..` and joins the prefix. This one checks
 * membership of a fixed set of seven strings. There is no traversal to get
 * wrong, no encoding trick to miss, and no way for this route to read anything
 * in the bucket that is not one of the model's own files — which matters,
 * because the same bucket holds every customer's media.
 */
export function keyForRequest(rest) {
  if (typeof rest !== 'string' || !rest) return null;
  // A single decode, and only to catch %2F-style encodings before the
  // membership test. Anything that does not decode is simply not a match.
  let path;
  try { path = decodeURIComponent(rest); } catch { return null; }
  const key = `${MODEL_PREFIX}/${path.replace(/^\/+/, '')}`;
  return SERVABLE.has(key) ? key : null;
}

/** Model files never change at a given path, so a browser should ask once and
 *  never again. Matches what uploadPublicAt already sets on the objects. */
export const CACHE_HEADER = 'public, max-age=31536000, immutable';

export const typeFor = (key) => (key.endsWith('.json')
  ? 'application/json'
  : 'application/octet-stream');

/**
 * The route body, with its one dependency injected so it is testable without a
 * bucket.
 *
 * ── `read` RETURNS A STREAM, NOT A BUFFER, AND THAT IS THE WHOLE POINT ──────
 * The first version of this took `Promise<Buffer>` and checked `buf.length`.
 * storage.readObject actually returns `{ body, contentLength, contentType }`
 * where body is a Readable — so `.length` was undefined, every valid file read
 * as empty, and the route answered "the speech model is not installed" for a
 * model that was sitting right there.
 *
 * Eleven unit tests passed while it did that, because they injected a fake
 * that returned a Buffer. THEY TESTED THIS FUNCTION, NOT ITS CALL SITE. It was
 * found by curling the route on dev after deploying, which is the only thing
 * that was ever going to find it.
 *
 * Streaming is also the right answer on its own merits: the decoder file is
 * 29 MB, production is two 1-vCPU boxes, and buffering that per request while
 * a workshop starts at once is how a box falls over.
 *
 * @param read (key) => Promise<{body, contentLength, contentType}>
 */
export async function serveModelFile(rest, { read, res }) {
  const key = keyForRequest(rest);
  if (!key) {
    // Deliberately not 403. A 404 says nothing about what else is in the
    // bucket, and there is no reason to confirm the shape of the storage to
    // somebody guessing at paths.
    res.status(404).json({ error: 'Not found' });
    return { served: false, why: 'not a model file' };
  }

  let out;
  try {
    out = await read(key);
  } catch (e) {
    console.error(`[whisper-serve] ${key} failed:`, e?.message || e);
    res.status(502).json({ error: 'The speech model could not be read from storage.' });
    return { served: false, why: 'read failed' };
  }

  const body = out?.body;
  if (!body) {
    // An installed-but-empty file is the failure mode that produces an
    // unreadable error inside a web worker. Say it here instead.
    console.error(`[whisper-serve] ${key} is missing or empty — the model is incomplete`);
    res.status(404).json({ error: 'The speech model is not installed.' });
    return { served: false, why: 'missing' };
  }

  res.setHeader('Content-Type', typeFor(key));
  res.setHeader('Cache-Control', CACHE_HEADER);
  // Content-Length so the browser can show real progress on a 29 MB file
  // rather than an indeterminate spinner. Omitted rather than guessed if
  // storage did not report one — a WRONG length truncates the download and
  // produces a corrupt model, which fails inside a worker.
  const len = Number(out.contentLength);
  if (Number.isFinite(len) && len > 0) res.setHeader('Content-Length', String(len));
  // Same-origin, so no CORS header is needed — which is the entire reason this
  // path works when the bucket's does not.

  // A stream that dies after the headers are out cannot be turned into a
  // status code. Destroy the response so the browser sees a truncated transfer
  // and retries, rather than caching 4 MB of a 29 MB file for a year.
  body.on?.('error', (e) => {
    console.error(`[whisper-serve] ${key} stream broke mid-send:`, e?.message || e);
    res.destroy(e);
  });

  body.pipe(res);
  return { served: true, key, bytes: Number.isFinite(len) ? len : null };
}
