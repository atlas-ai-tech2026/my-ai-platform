// ─── text-image.js ───────────────────────────────────────────────────────────
// Turn a text clip into a transparent PNG the size of the output frame.
//
// ── WHY A PICTURE AND NOT ffmpeg's drawtext ────────────────────────────────
// drawtext needs libfreetype, and @ffmpeg/core 0.12 — the standard build we
// ship — is not compiled with it. Reaching for a custom core build to put a
// title on a video would be a large, fragile dependency for something the
// browser already does perfectly.
//
// The browser also has the fonts. Anton is already loaded on the page; getting
// it into a wasm filesystem would mean shipping the font file too, and then
// keeping the two in step.
//
// ── AND WHY IT IS A FULL-FRAME PNG ─────────────────────────────────────────
// The text is drawn at its final position INSIDE a transparent frame the exact
// size of the output, so ffmpeg overlays it at 0,0 and has no opinion about
// placement. That is deliberate: position is computed ONCE, by textLayout, the
// same call the preview makes. Passing x/y to ffmpeg instead would be a second
// implementation of the same geometry — and a preview that disagrees with the
// file is worse than no preview, because it is trusted.

import { textLayout, hasText } from './text-clip.js';

/** Break on the newlines a person typed. No auto-wrapping: a title that
 *  silently reflows differently in the file than on screen would be the exact
 *  mismatch this module exists to avoid. Long lines are the customer's choice
 *  and are shown to them in the preview at the same width. */
const linesOf = (text) => String(text).split('\n');

/**
 * Draw a text clip onto a canvas context.
 *
 * Split out from the blob-making so it can be tested against a recording
 * context — the drawing decisions are the part worth testing, and a real
 * canvas in jsdom draws nothing.
 */
export function drawText(ctx, clip, { width, height }) {
  const L = textLayout(clip, { width, height });
  if (!L.text) return L;

  const lines = linesOf(L.text);
  const lineHeight = Math.round(L.fontPx * 1.15);
  ctx.font = `${L.weight} ${L.fontPx}px ${L.font}`;
  ctx.textAlign = L.align;
  ctx.textBaseline = 'middle';

  // The block is centred on the anchor, so a two-line title grows in both
  // directions rather than dropping off the bottom of the frame.
  const blockTop = L.y - ((lines.length - 1) * lineHeight) / 2;

  if (L.background) {
    // A plate behind captions. Measured from the real text so it hugs the
    // words at any font — guessing a width would clip the last letter of a
    // long line, which is the one place it is most obvious.
    const widest = Math.max(...lines.map((ln) => ctx.measureText(ln).width));
    const padX = Math.round(L.fontPx * 0.36);
    const padY = Math.round(L.fontPx * 0.18);
    const boxW = widest + padX * 2;
    const boxH = lines.length * lineHeight + padY * 2;
    const boxX = L.align === 'center' ? L.x - boxW / 2 : L.align === 'right' ? L.x - boxW : L.x - padX;
    ctx.fillStyle = L.background;
    ctx.fillRect(Math.round(boxX), Math.round(blockTop - lineHeight / 2 - padY), Math.round(boxW), Math.round(boxH));
  }

  if (L.shadowPx) {
    // Set on the context rather than drawn twice: a manually offset copy
    // underneath is a hard black duplicate, which looks like a printing error
    // at large sizes. This is the same soft shadow the preview uses.
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = L.shadowPx;
    ctx.shadowOffsetY = Math.round(L.shadowPx / 2);
  }

  ctx.fillStyle = L.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, L.x, blockTop + i * lineHeight);
  });

  // Reset, so a caller reusing one canvas for several clips does not inherit
  // a shadow onto the next one.
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  return L;
}

/**
 * A transparent PNG of this text clip, at the output's exact size.
 *
 * @returns {Promise<Blob|null>} null when there is nothing to draw — an empty
 *          text clip must not become a transparent input ffmpeg still has to
 *          decode and overlay for nothing.
 */
export async function renderTextToBlob(clip, { width, height, makeCanvas } = {}) {
  if (!hasText(clip)) return null;
  const w = Math.max(1, Math.round(width || 0));
  const h = Math.max(1, Math.round(height || 0));

  const canvas = makeCanvas
    ? makeCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  drawText(ctx, clip, { width: w, height: h });

  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => { canvas.toBlob(resolve, 'image/png'); });
}

/**
 * Every text clip in the project, rendered and given an object URL.
 *
 * Returned as a map keyed by clip id, plus the urls to revoke afterwards —
 * object urls are not garbage collected, and an export of a long project would
 * otherwise leak one full-frame PNG per title for the life of the tab.
 */
export async function renderProjectText(project, { width, height, makeCanvas } = {}) {
  const images = {};
  const urls = [];
  for (const track of project?.tracks || []) {
    if (track.kind !== 'text' || track.hidden) continue;
    for (const clip of track.clips || []) {
      // eslint-disable-next-line no-await-in-loop
      const blob = await renderTextToBlob(clip, { width, height, makeCanvas });
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      images[clip.id] = url;
      urls.push(url);
    }
  }
  return { images, revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}
