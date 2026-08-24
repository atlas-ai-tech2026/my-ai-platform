// ─── media-library.js ────────────────────────────────────────────────────────
// Turning what the customer has already generated into something they can cut.
//
// ── THIS IS WHERE THE DIFFERENTIATOR ACTUALLY ARRIVES ──────────────────────
// Every other editor's user turns up with a file. A file has pixels and a
// duration and nothing else. VOXEL's user turns up with a GENERATION — the
// words that made it, the model that ran, the camera, the lens, the focal
// length, the f-stop.
//
// If that metadata is dropped on the way onto the timeline, the editor becomes
// an ordinary editor with extra steps: no regenerating a shot in place, no
// agent that can reason about what a clip IS, no "make this one darker". So
// the whole job of this file is to carry it across intact, and it is the
// reason toSource is a tested function rather than an object literal written
// inline at the call site.
//
// ── AND THE ONE NUMBER THAT MUST NOT BE GUESSED ────────────────────────────
// A clip needs an out point. Get the duration wrong and the timeline lies:
// too long and the export ends in black or a frozen frame, too short and it
// cuts the shot off. Neither throws, and both are the kind of thing somebody
// notices after they have sent the file.
//
// So a record with no usable duration is NOT given a default. It is reported
// as needing one, and the caller measures it from the media before adding.

/** A record can be on the timeline only if a real file exists to point at. */
export function usability(record) {
  if (!record) return { ok: false, reason: 'missing', label: 'This item is missing.' };

  const status = record.status || 'completed';
  if (status === 'pending' || status === 'processing') {
    return { ok: false, reason: 'pending', label: 'Still generating' };
  }
  if (status === 'failed' || status === 'error') {
    return { ok: false, reason: 'failed', label: 'This generation failed' };
  }
  if (!record.result_url) {
    // Completed but with no file is the FAL-link-expiry case, and it is worth
    // its own words: the customer's history shows the item, so "nothing here"
    // would read as our bug rather than as an expired link.
    return { ok: false, reason: 'no-file', label: 'The file for this is no longer available' };
  }
  return { ok: true, reason: null, label: null };
}

/** Video or image, from whatever the record actually says. */
export function kindOf(record) {
  if (record?.type === 'image') return 'image';
  if (record?.type === 'video') return 'video';
  // Fall back to the URL rather than assuming video: an image dropped onto a
  // video track as a video would decode to nothing.
  const url = String(record?.result_url || '').split(/[?#]/)[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(url)) return 'image';
  return 'video';
}

/** Seconds, or null when it genuinely is not known. Never a guess. */
export function durationOf(record) {
  const n = Number(record?.duration);
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

/**
 * A GenerationHistory record as a timeline source.
 *
 * The camera block is copied field by field rather than by spreading the whole
 * record: a source is persisted into the saved project, and spreading would
 * quietly carry job ids, statuses and internal fields into every autosave —
 * growing the payload and, worse, making the document depend on the shape of
 * an API response that is free to change.
 */
export function toSource(record) {
  return {
    id: `gen:${record.id}`,
    url: record.result_url,
    kind: kindOf(record),

    // ── THE PART THAT MAKES REGENERATION POSSIBLE ──────────────────────
    prompt: record.prompt || '',
    model: record.model || '',
    model_id: record.model_id || null,
    ratio: record.ratio || null,

    // Camera metadata, in the snake_case the platform uses on the wire.
    camera: record.camera ?? null,
    lens: record.lens ?? null,
    lens_type: record.lens_type ?? null,
    focal_length: record.focal_length ?? null,
    fstop: record.fstop ?? null,

    // Where it came from, so a regenerated clip can be traced to its original.
    generation_id: record.id,
    created_date: record.created_date || null,
  };
}

/**
 * Ask the browser how long a video actually is.
 *
 * Used when the record carries no duration — older rows predate the column,
 * and kie does not always return one. Measuring costs one metadata request
 * (not the whole file), which is far cheaper than the alternative of guessing
 * and shipping an export that ends in black.
 *
 * `createVideo` is injectable so the failure paths can be tested. They matter:
 * an expired link neither loads nor errors quickly in every browser, so the
 * timeout is the difference between "could not read this clip" and a card that
 * spins forever.
 */
export function measureDuration(url, { createVideo, timeoutMs = 15000 } = {}) {
  const make = createVideo || (() => document.createElement('video'));
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    const el = make();
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      const d = Number(el.duration);
      // Infinity is a real answer from a stream with no declared length, and
      // it must not become an out point.
      done(Number.isFinite(d) && d > 0 ? d : null);
    };
    el.onerror = () => done(null);
    setTimeout(() => done(null), timeoutMs);
    el.src = url;
  });
}

/** A short label for a card: the prompt is the name a person recognises. */
export function labelFor(record, max = 60) {
  const p = String(record?.prompt || '').trim();
  if (!p) return record?.model || 'Untitled';
  return p.length > max ? `${p.slice(0, max - 1)}…` : p;
}

/**
 * Newest first, unusable ones LAST but never removed.
 *
 * Hiding a failed or expired generation would be the tidier list and the worse
 * product: the customer knows they made that video, and a library that simply
 * does not contain it reads as lost work rather than as a known state.
 */
export function orderForLibrary(records = []) {
  return [...records].sort((a, b) => {
    const ua = usability(a).ok ? 0 : 1;
    const ub = usability(b).ok ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return String(b.created_date || '').localeCompare(String(a.created_date || ''));
  });
}

/** Can this clip be remade? The whole feature hangs on one field existing. */
export const canRegenerate = (source) => Boolean(source?.prompt && source?.model_id);

/**
 * The request body for remaking a shot.
 *
 * Every setting is carried forward and only the prompt changes, because the
 * point is "this shot, but at night" rather than "a new shot". Dropping the
 * ratio or the duration here is how a regenerated clip comes back a different
 * shape and no longer fits the hole it came from.
 */
export function regenerationRequest(source, { prompt, duration } = {}) {
  if (!canRegenerate(source)) return null;
  return {
    prompt: (prompt ?? source.prompt).trim(),
    model_id: source.model_id,
    ratio: source.ratio || undefined,
    duration: duration ?? undefined,
    camera: source.camera || undefined,
    lens: source.lens || undefined,
    lens_type: source.lens_type || undefined,
    focal_length: source.focal_length || undefined,
    fstop: source.fstop || undefined,
  };
}

// ─── FINDING ONE AMONG HUNDREDS ──────────────────────────────────────────────
// The library is the reason to use Voxel's editor rather than anyone else's —
// the customer's own generations, already there, carrying the prompt that made
// them. And until now the only way through it was scrolling.
//
// Kept here rather than in the component, and PURE, for the same reason
// filterProjects is: this is the logic that decides what somebody can find,
// and it should be testable without rendering anything.

/** How the library can be ordered. `label` is what the dropdown shows. */
export const LIBRARY_SORTS = {
  newest:  { label: 'Newest first',  fn: (a, b) => date(b) - date(a) },
  oldest:  { label: 'Oldest first',  fn: (a, b) => date(a) - date(b) },
  longest: { label: 'Longest first', fn: (a, b) => (durationOf(b) ?? 0) - (durationOf(a) ?? 0) },
  model:   { label: 'By model',      fn: (a, b) => String(a?.model || '').localeCompare(String(b?.model || '')) },
};

const date = (r) => new Date(r?.created_date || 0).getTime() || 0;

/** Every model present, so the filter only ever offers something that exists.
 *  A chip that can only return nothing is a control that wastes a click. */
export function modelsPresent(records = []) {
  return [...new Set(records.map((r) => r?.model).filter(Boolean))].sort();
}

/**
 * Search, filter and sort in one pass.
 *
 * The search looks at the PROMPT as well as the model, because that is how
 * anybody actually remembers a shot — "the castle one", not "the third Kling
 * from Tuesday". It is the field no upload-based editor has.
 *
 * `readyOnly` hides the ones that cannot be used. OFF by default, deliberately:
 * a failed generation stays visible with its reason, because the customer
 * remembers making it and a list that silently omits it reads as lost work.
 */
export function filterLibrary(records = [], { query = '', model = null, sort = 'newest', readyOnly = false } = {}) {
  const q = String(query).trim().toLowerCase();
  const out = records.filter((r) => {
    if (model && r?.model !== model) return false;
    if (readyOnly && !usability(r).ok) return false;
    if (!q) return true;
    return `${r?.prompt || ''} ${r?.model || ''}`.toLowerCase().includes(q);
  });
  const spec = LIBRARY_SORTS[sort] || LIBRARY_SORTS.newest;
  // Sorted on a COPY — mutating the caller's array would reorder the records
  // held in state and make the next render disagree with this one.
  return [...out].sort(spec.fn);
}
