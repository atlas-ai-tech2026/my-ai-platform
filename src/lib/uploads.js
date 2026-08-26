// ─── uploads.js ──────────────────────────────────────────────────────────────
// Bringing your own footage, music and logos into Voxel Edit Cut.
//
// ── WHY THIS IS WORTH BUILDING NOW ─────────────────────────────────────────
// The Uploads tab has sat in the library greyed out since the editor shipped,
// which was honest but not useful: a workshop attendee wants their own logo
// and their own music, and the platform's answer was "not yet".
//
// It is cheap now because RECORDING already proved the whole chain — POST
// /api/upload stores to Spaces and returns a durable https url, and
// addRecording turns that url into a source and a clip. An upload is the same
// path with a file the customer picked instead of one they just made.
//
// ── THE LIST BELOW IS A COPY, AND THAT IS DELIBERATE ───────────────────────
// It mirrors server/src/upload-guard.js exactly. Two copies of a list is
// normally a smell; here the alternative is worse. Accepting something the
// server refuses means the customer waits through a 90 MB upload to be told
// no. Refusing something the server would have taken means a file that works
// is rejected for no reason. The list is small, it changes rarely, and a test
// asserts the two stay identical — so the duplication is checked rather than
// hoped about.

/** Mirrors ALLOWED_UPLOAD_MIME in server/src/upload-guard.js. */
export const ACCEPTED_MIME = [
  // images
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'image/avif', 'image/heic', 'image/heif',
  // video
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
  'video/x-msvideo', 'video/mpeg',
  // audio
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm',
  'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac',
];

/** multer's limit in server/src/index.js. Checked HERE first so a file that
 *  cannot possibly succeed is never uploaded — the customer finds out in a
 *  moment rather than after several minutes of their bandwidth. */
export const MAX_BYTES = 100 * 1024 * 1024;

/** What a file becomes on the timeline. */
export function kindOfFile(file) {
  const type = String(file?.type || '').toLowerCase().split('/')[0];
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  if (type === 'image') return 'image';
  return null;
}

const round1 = (n) => Math.round(n * 10) / 10;

export function humanSize(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1024 * 1024 * 1024) return `${round1(b / (1024 ** 3))} GB`;
  if (b >= 1024 * 1024) return `${round1(b / (1024 ** 2))} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/**
 * Can we take this file?
 *
 * Every refusal names the file and says what to do — a list of files where one
 * silently did not arrive is the worst version of this screen, because the
 * customer discovers it when the export is missing something.
 */
export function validateFile(file) {
  if (!file) return { ok: false, reason: 'No file.' };

  const name = file.name || 'That file';
  if (!file.size) return { ok: false, reason: `“${name}” is empty.` };

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      reason: `“${name}” is ${humanSize(file.size)} — the limit is ${humanSize(MAX_BYTES)}. `
        + 'Trim it or export it smaller and try again.',
    };
  }

  const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
  if (!mime) {
    // Some systems hand over an empty type for less common formats. Saying
    // "unsupported" would be a guess; the server sniffs the real bytes and is
    // the authority, so let it decide rather than refusing something valid.
    return { ok: true, kind: null, unknownType: true };
  }
  if (!ACCEPTED_MIME.includes(mime)) {
    return {
      ok: false,
      reason: `“${name}” is a ${mime} file. Voxel takes video, audio and images.`,
    };
  }
  return { ok: true, kind: kindOfFile(file) };
}

/** An image has no length of its own, so it needs one. Five seconds is the
 *  standard beat for a logo or a title card — long enough to read, short
 *  enough that nobody has to trim it before it is useful. */
export const IMAGE_SECONDS = 5;

/**
 * Sort what the customer dropped into what we will take and what we will not,
 * WITHOUT throwing any away silently.
 *
 * Returns both lists. A dropped folder of forty files with three unsupported
 * ones should upload the thirty-seven and say clearly which three it did not.
 */
export function sortDropped(files) {
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(files || [])) {
    const verdict = validateFile(file);
    if (verdict.ok) accepted.push({ file, kind: verdict.kind });
    else rejected.push({ file, reason: verdict.reason });
  }
  return { accepted, rejected };
}

/** A name a person recognises in a list, without the extension shouting. */
export function labelForFile(file, max = 40) {
  const name = String(file?.name || 'Untitled').replace(/\.[a-z0-9]{1,5}$/i, '');
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
