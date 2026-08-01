// ─── upload-guard.js ─────────────────────────────────────────────────────────
// H2 (security audit 2026-07-28): /api/upload accepted any file type from
// anyone. This module holds the content-type policy so it can be unit
// tested without booting Express.
//
// Two layers, because a client-declared MIME type is just a string:
//   1. the declared type must be an allowed image/video/audio type, and
//   2. the buffer's MAGIC BYTES must actually look like that media family.
// A .exe renamed to .png with Content-Type: image/png fails layer 2.

export const ALLOWED_UPLOAD_MIME = new Set([
  // images
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'image/avif', 'image/heic', 'image/heif',
  // video
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
  'video/x-msvideo', 'video/mpeg',
  // audio
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm',
  'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac',
]);

export function isAllowedUploadMime(mime) {
  return ALLOWED_UPLOAD_MIME.has(String(mime || '').toLowerCase().split(';')[0].trim());
}

const startsWith = (buf, bytes, offset = 0) =>
  bytes.every((b, i) => buf[offset + i] === b);

/**
 * Sniff the media family from magic bytes: 'image' | 'video' | 'audio' |
 * null (unrecognised). Deliberately conservative — only formats we accept.
 */
export function sniffMediaFamily(buf) {
  if (!buf || buf.length < 12) return null;

  // ---- images ----
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'image';            // PNG
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image';                  // JPEG
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'image';            // GIF8
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'image';         // RIFF....WEBP

  // ---- RIFF WAVE (audio) ----
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(buf, [0x57, 0x41, 0x56, 0x45], 8)) return 'audio';         // RIFF....WAVE

  // ---- ISO-BMFF (mp4/mov/heic/m4a): '....ftyp<brand>' ----
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buf.slice(8, 12).toString('latin1').toLowerCase();
    if (brand.startsWith('hei') || brand.startsWith('mif')) return 'image'; // HEIC/HEIF
    if (brand.startsWith('m4a') || brand.startsWith('m4b')) return 'audio';
    return 'video';                                                          // mp4, qt, isom…
  }

  // ---- Matroska / WebM (container is shared by video and audio) ----
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'matroska';

  // ---- audio ----
  if (startsWith(buf, [0x49, 0x44, 0x33])) return 'audio';                  // ID3 (mp3)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio';          // MPEG frame sync
  if (startsWith(buf, [0x66, 0x4c, 0x61, 0x43])) return 'audio';            // fLaC
  if (startsWith(buf, [0x4f, 0x67, 0x67, 0x53])) return 'audio';            // OggS

  // ---- video ----
  if (startsWith(buf, [0x00, 0x00, 0x01, 0xba]) ||
      startsWith(buf, [0x00, 0x00, 0x01, 0xb3])) return 'video';            // MPEG-PS/ES
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(buf, [0x41, 0x56, 0x49, 0x20], 8)) return 'video';         // RIFF....AVI

  // ---- explicitly dangerous shapes, so the caller can 415 them ----
  if (startsWith(buf, [0x4d, 0x5a])) return 'executable';                   // PE/DOS
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return 'executable';       // ELF
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'archive';          // zip/docx/xlsx
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return 'document';         // PDF

  return null;
}

/**
 * Validate an uploaded file against the declared MIME type.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function validateUpload({ mimetype, buffer } = {}) {
  if (!isAllowedUploadMime(mimetype)) {
    return { ok: false, reason: `Unsupported file type: ${mimetype || 'unknown'}. Only image, video and audio files are allowed.` };
  }
  const declaredFamily = String(mimetype).toLowerCase().split('/')[0];
  const actual = sniffMediaFamily(buffer);

  if (actual === null) {
    return { ok: false, reason: 'File content is not a recognised image, video or audio format.' };
  }
  if (actual === 'executable' || actual === 'archive' || actual === 'document') {
    return { ok: false, reason: 'File content is not an image, video or audio file.' };
  }
  // WebM/Matroska legitimately carries both video and audio.
  if (actual === 'matroska') {
    return declaredFamily === 'video' || declaredFamily === 'audio'
      ? { ok: true }
      : { ok: false, reason: 'File content does not match the declared type.' };
  }
  if (actual !== declaredFamily) {
    return { ok: false, reason: `File content does not match the declared type (${mimetype}).` };
  }
  return { ok: true };
}
