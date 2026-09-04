// ─── video-prompt.js ─────────────────────────────────────────────────────────
// The one prompt adjustment the server makes for video, and why.
//
// Owner, 2026-08-25: "When the user uploads an image to Kling, the video must
// be generated from THAT image — one shot. Why is it multiple shots?"
//
// Voxel's request was already correct for Kling 3.0 on kie (multi_shots:false,
// verified against kie's schema), yet customers still received cut-up clips.
// Two things can do that with a correct request: the model deciding on its own
// to "storyboard" a prompt that reads like several scenes, or a provider whose
// default leans multi-shot for the Omni tier. Neither can be fixed by a flag we
// are already sending — but both respond to the prompt itself.
//
// So for every Kling-family image-to-video request where the customer has NOT
// switched Multi Shot on, the prompt the PROVIDER sees ends with a continuity
// instruction. The customer's own prompt is never modified — it is stored as
// typed and shown as typed; this rides only in the provider payload, exactly
// like the camera-motion merge on the Video page (CLAUDE.md conventions).

export const CONTINUITY_SUFFIX =
  'Single continuous shot animated from the provided image — no cuts, no scene changes, no camera switches.';

const ALREADY_SAYS_SO = /continuous shot|single shot|no cuts|one shot|one take/i;

/**
 * @param prompt     the customer's prompt, as typed
 * @param hasImage   a start frame was uploaded (image-to-video)
 * @param multiShots the customer explicitly turned Multi Shot ON
 * @param model      display name, e.g. "Kling 3.0", "Kling 3.0 Omni"
 */
export function withContinuity(prompt, { hasImage, multiShots, model } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return p;
  if (!hasImage || multiShots) return p;
  if (!/^kling/i.test(String(model || ''))) return p;
  if (ALREADY_SAYS_SO.test(p)) return p;
  return `${p.replace(/[.\s]+$/, '')}. ${CONTINUITY_SUFFIX}`;
}
