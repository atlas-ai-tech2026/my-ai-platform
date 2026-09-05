// ─── reference-limits.js ─────────────────────────────────────────────────────
// How many reference images each image model actually accepts. ONE place.
//
// ☠ WHY THIS EXISTS. Amr, 2026-09-05: "When I try to upload many reference
// images in the prompt bar, there is an error and the images are not sent."
//
// Reading the path turned up something worse than an error: SILENCE. The
// caps live inside buildKieImageInput as bare `.slice(0, N)` calls, so a model
// that takes one image is handed four and quietly uses the first. Nothing on
// screen says a reference was ignored; the customer sees a picture that does
// not contain the person they uploaded, and no message anywhere.
//
//   Flux Kontext / Flux Kontext Max  →  imageUrls[0]      3 of 4 dropped
//   Midjourney                       →  imageUrls[0]      3 of 4 dropped
//   the FAL models                   →  imgParam, one url 3 of 4 dropped
//   Imagen 4, Flux 2, Seedream 4.5   →  never sent at ALL, every one ignored
//
// The last row is the worst: those are text-to-image models. A customer can
// upload four references to Imagen 4 and receive a picture built from none of
// them, with the credits spent.
//
// The numbers below are READ FROM buildKieImageInput, not invented — the test
// beside this file re-derives them from that function's source and fails if
// the two ever disagree. That is the point: a second copy of a limit is a
// second thing to forget.

/** Reference capacity for one model, from its MODEL_CONFIG entry. */
export function referenceLimit(cfg) {
  if (!cfg) return 0;

  // Text-to-image only: the request carries no image field at all, so every
  // reference is discarded. Zero is the honest number, not "1".
  if (cfg.t2iOnly) return 0;

  if (cfg.provider === 'kie') {
    if (cfg.family === 'jobs') {
      const m = String(cfg.kieModel || '');
      if (m.startsWith('nano-banana')) return m === 'nano-banana-2' ? 14 : 8;
      if (cfg.kieStyle === 'imagen4') return 0;        // t2i, no image field
      if (cfg.kieStyle === 'seedream5pro') return 10;  // image_urls
      if (m.startsWith('seedream/')) return 0;         // Lite / 4.5 are t2i
      if (m.startsWith('flux-2/')) return 0;           // t2i
      return 16;                                        // gpt-image family
    }
    if (cfg.family === 'gpt4o') return 5;               // filesUrl
    if (cfg.family === 'flux') return 1;                // inputImage
    if (cfg.family === 'mj') return 1;                  // fileUrl
    return 1;
  }

  // FAL models: i2i takes ONE image through imgParam.
  return cfg.imgParam ? 1 : 0;
}

/**
 * What to tell someone before they spend credits.
 *
 * Returns null when the references they have are fine. Otherwise a plain
 * sentence naming what will happen — never a silent trim.
 */
export function referenceWarning(cfg, count, modelName = 'This model') {
  const limit = referenceLimit(cfg);
  const n = Number(count) || 0;
  if (n === 0 || n <= limit) return null;
  if (limit === 0) {
    return `${modelName} does not use reference images — it generates from the prompt only. `
      + `Your ${n === 1 ? 'image' : `${n} images`} would be ignored. Choose a different model, `
      + 'or remove them.';
  }
  return `${modelName} uses at most ${limit} reference `
    + `${limit === 1 ? 'image' : 'images'}. You have ${n}; the `
    + `${n - limit === 1 ? 'extra one' : `extra ${n - limit}`} would be ignored.`;
}
