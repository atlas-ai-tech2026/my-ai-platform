// ─── text-clip.js ────────────────────────────────────────────────────────────
// What a text clip SAYS, and where it sits.
//
// ── WHY THIS DID NOT EXIST ─────────────────────────────────────────────────
// A text clip could already be added to the timeline. It just had nothing in
// it: `createClip` has no content field, the demo's text clip pointed at a
// source id ('title') that was never created, the viewer drew nothing, and the
// export listed it under "Not included". An orange rectangle that looked like
// a feature.
//
// So this is not "make captions render" — there was nothing to render. It is
// the content, the styling, and the geometry that both the viewer and the
// export have to agree on.
//
// ── EVERYTHING IS A FRACTION OF THE FRAME, NEVER A PIXEL ───────────────────
// A title set on a 1920×1080 preview and exported to a 1080×1920 Reel must
// land in the same PLACE and be the same SIZE RELATIVE to the picture. Store
// 32px and it is a bold headline on one and unreadable on the other. Store
// 0.08 of the frame height and it is the same title in both.
//
// This is also what lets the viewer and the export share one calculation
// rather than each having its own — two implementations of the same geometry
// is how a preview stops predicting the output, which is the whole point of a
// preview.

/** Sensible defaults, so a new text clip is legible the moment it appears
 *  rather than a transparent nothing the customer has to configure first. */
export const TEXT_DEFAULTS = {
  text: '',
  /** Fraction of FRAME HEIGHT. 0.08 ≈ a 86px title on 1080p. */
  size: 0.08,
  color: '#FFFFFF',
  /** Centre point, as fractions of width and height. */
  x: 0.5,
  y: 0.82,
  align: 'center',
  weight: 700,
  /** A dark plate behind the words. Off by default — but see `shadow`. */
  background: null,
  /** On by default, and deliberately: white text over a bright sky is
   *  invisible, and that is the single most common way a title is unreadable
   *  in a finished video. A shadow costs nothing and rescues every case. */
  shadow: true,
  font: 'Anton, Impact, sans-serif',
};

/**
 * Placements a person actually asks for, in the words they use.
 *
 * Named presets rather than four number fields, because "put it at the bottom"
 * is the request, and nobody wants to discover that 0.82 is where the bottom
 * is. The numbers stay editable underneath for anyone who wants them.
 */
export const TEXT_PRESETS = [
  { id: 'title',       label: 'Title',        patch: { size: 0.11, x: 0.5,  y: 0.5,  align: 'center' } },
  { id: 'lowerThird',  label: 'Lower third',  patch: { size: 0.06, x: 0.08, y: 0.80, align: 'left' } },
  { id: 'caption',     label: 'Caption',      patch: { size: 0.05, x: 0.5,  y: 0.88, align: 'center',
                                                       background: 'rgba(0,0,0,0.55)' } },
  { id: 'corner',      label: 'Corner note',  patch: { size: 0.035, x: 0.96, y: 0.06, align: 'right' } },
];

export const presetById = (id) => TEXT_PRESETS.find((p) => p.id === id) || null;

/** Merge stored fields over the defaults. Anything missing — an older clip, a
 *  hand-edited project — reads as the default rather than as undefined, which
 *  would render as the string "undefined" in the frame. */
export function textOf(clip) {
  const raw = clip?.text && typeof clip.text === 'object' ? clip.text : {};
  // Drop undefined BEFORE merging. `{ ...defaults, ...{ color: undefined } }`
  // yields color: undefined — the spread does not skip it — and an undefined
  // colour reaches the canvas as an invalid value and paints black on black.
  // A field that is present-but-undefined is exactly what a partially
  // serialised or hand-edited project produces.
  const t = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  return {
    ...TEXT_DEFAULTS,
    ...t,
    // A clip whose content was never set falls back to its NAME. The timeline
    // already shows that name, so the frame matching it is the least
    // surprising thing that can happen — and far better than an empty box.
    text: String(t.text ?? clip?.name ?? '').trim(),
  };
}

/** Is there anything to draw? An empty text clip must not produce a black
 *  plate over the picture. */
export const hasText = (clip) => textOf(clip).text.length > 0;

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * Where this text lands, in the pixels of a specific output.
 *
 * ONE function, used by the viewer AND the export. That is the point: the
 * preview is only worth having if it predicts the file.
 *
 * @returns {{ text, fontPx, x, y, align, color, weight, font, shadowPx, background }}
 *          x/y are the ANCHOR — what they anchor depends on `align`, exactly
 *          as canvas textAlign does, so both renderers can use them directly.
 */
export function textLayout(clip, { width, height }) {
  const t = textOf(clip);
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const fontPx = Math.max(1, Math.round(clamp01(t.size) * h));
  return {
    text: t.text,
    fontPx,
    x: Math.round(clamp01(t.x) * w),
    y: Math.round(clamp01(t.y) * h),
    align: ['left', 'center', 'right'].includes(t.align) ? t.align : 'center',
    color: t.color || TEXT_DEFAULTS.color,
    weight: t.weight || TEXT_DEFAULTS.weight,
    font: t.font || TEXT_DEFAULTS.font,
    // Scales with the type, so it is the same shadow at every output size.
    shadowPx: t.shadow ? Math.max(1, Math.round(fontPx * 0.06)) : 0,
    background: t.background || null,
  };
}

/** Apply a preset without losing the words already typed. */
export function applyPreset(clip, presetId) {
  const preset = presetById(presetId);
  if (!preset) return clip;
  return { ...clip, text: { ...textOf(clip), ...preset.patch } };
}

/** Set the words. Kept separate from styling so typing cannot disturb layout. */
export function setText(clip, words) {
  return { ...clip, text: { ...textOf(clip), text: String(words ?? '') } };
}
