// ─── prompt-draft.js ─────────────────────────────────────────────────────────
// What you typed survives leaving the page.
//
// Amr, 2026-09-05: "I write the prompt and upload pictures, then I click Video
// to do something, and when I come back to Images the prompt and the images
// are gone. I need it kept as long as I am logged in."
//
// Confirmed in the code the same day: Image and Video are separate routes, so
// leaving one unmounts it, and nothing anywhere persisted the draft. Not a bug
// in the code — an absence.
//
// ── WHY THE REFERENCES CAN BE KEPT AT ALL ──────────────────────────────────
// By the time an image is attached it is already a durable Spaces URL, not a
// blob: or data: URI. A blob URL dies with the page and would come back as a
// broken thumbnail; a Spaces URL is still there tomorrow. So the draft stores
// the URLs and nothing has to be re-uploaded.
//
// ── THE THREE THINGS THAT ARE ACTUALLY HARD ────────────────────────────────
// Taken from editor-autosave.js, which learned them first:
//
//   1. STORAGE THROWS. Not "returns null" — the property access itself throws
//      when cookies are blocked, and Safari private browsing throws on the
//      first setItem. Every path here is wrapped, and storage is injected so
//      each one can be PROVEN rather than asserted about.
//
//   2. A DAMAGED DRAFT MUST NOT BE SILENTLY REPLACED. If the stored payload
//      will not parse, it is moved aside rather than deleted. BUILD BEFORE YOU
//      DELETE applies to bytes in storage.
//
//   3. A NEWER SCHEMA IS REFUSED, NOT GUESSED. Two tabs during a deploy is a
//      Tuesday. Old code reading a v2 draft keeps the fields it recognises,
//      drops the rest, and saves the truncated version back over the good one.
//
// ── AND THE ONE THIS FILE ADDS ─────────────────────────────────────────────
//   4. IT MUST DIE AT LOGOUT. A workshop laptop is shared. The next person to
//      sign in must not find the last person's prompt and their uploaded
//      photographs sitting in the box. AuthContext.logout() calls clearDrafts()
//      for exactly this reason, and there is a test that fails if that call is
//      ever removed.

export const DRAFT_PREFIX = 'voxel-draft:';
export const DRAFT_SCHEMA = 1;

/** Pages that keep a draft. Anything else is refused — a typo'd page name
 *  would otherwise write a key nobody ever reads or clears. */
export const DRAFT_PAGES = ['image', 'video'];

const defaultStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // The ACCESS throws, before any read. Not hypothetical — it is the default
    // in an embedded webview and in a browser set to block site data.
    return null;
  }
};

const keyFor = (page) => `${DRAFT_PREFIX}${page}`;

/**
 * Save a draft. Returns { ok } — never throws, and never claims success it
 * did not have.
 */
export function saveDraft(page, fields, { storage = defaultStorage() } = {}) {
  if (!DRAFT_PAGES.includes(page)) return { ok: false, reason: 'unknown page' };
  if (!storage) return { ok: false, reason: 'storage unavailable' };
  try {
    storage.setItem(keyFor(page), JSON.stringify({
      v: DRAFT_SCHEMA,
      at: Date.now(),
      fields: fields || {},
    }));
    return { ok: true };
  } catch (e) {
    // Quota full, or private browsing. The draft is a convenience, so this is
    // not worth interrupting anyone over — but it must not be reported as
    // saved either.
    return { ok: false, reason: e?.name === 'QuotaExceededError' ? 'storage full' : 'storage refused' };
  }
}

/**
 * Load a draft. Returns the fields, or null when there is nothing usable.
 *
 * A draft that will not parse is MOVED ASIDE, not deleted — see (2) above.
 * A draft from a newer schema is left completely alone — see (3).
 */
export function loadDraft(page, { storage = defaultStorage() } = {}) {
  if (!DRAFT_PAGES.includes(page) || !storage) return null;
  let raw;
  try {
    raw = storage.getItem(keyFor(page));
  } catch {
    return null;
  }
  if (!raw) return null;

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    try { storage.setItem(`${keyFor(page)}:damaged`, raw); } catch { /* nothing more to try */ }
    try { storage.removeItem(keyFor(page)); } catch { /* nothing more to try */ }
    return null;
  }

  // Newer than we understand: leave it exactly as it is. Loading it would mean
  // saving a truncated version back over the good one.
  if (!doc || typeof doc !== 'object' || Number(doc.v) > DRAFT_SCHEMA) return null;
  if (Number(doc.v) !== DRAFT_SCHEMA) return null;
  return doc.fields && typeof doc.fields === 'object' ? doc.fields : null;
}

/**
 * Remove every draft. Called from AuthContext.logout().
 *
 * ☠ A SHARED WORKSHOP LAPTOP IS THE WHOLE REASON. The next person to sign in
 * must not find the last person's prompt — or their uploaded photographs —
 * waiting in the box.
 */
export function clearDrafts({ storage = defaultStorage() } = {}) {
  if (!storage) return { ok: false, cleared: 0 };
  let cleared = 0;
  for (const page of DRAFT_PAGES) {
    for (const k of [keyFor(page), `${keyFor(page)}:damaged`]) {
      try {
        if (storage.getItem(k) != null) { storage.removeItem(k); cleared += 1; }
      } catch { /* a storage that refuses to clear cannot be forced */ }
    }
  }
  return { ok: true, cleared };
}
