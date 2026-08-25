// ─── editor-autosave.js ──────────────────────────────────────────────────────
// The work survives the tab closing.
//
// ── WHAT THIS IS ACTUALLY DEFENDING AGAINST ────────────────────────────────
// Not a crash. The ordinary case: twenty minutes of trimming, a reload, a
// laptop lid, a browser update. Nobody forgives an editor for that once, and
// nobody who has been bitten leaves work in it again.
//
// ── SAVING IS NOT THE HARD PART ────────────────────────────────────────────
// Writing JSON to localStorage is four lines. The three things that are
// actually hard, and that this file exists to get right:
//
//   1. A FAILED SAVE MUST BE VISIBLE. localStorage throws when the quota is
//      full and Safari private browsing throws on the first setItem. A save
//      that fails quietly is worse than no autosave at all, because the
//      customer stops taking their own precautions on the strength of a
//      promise the software is not keeping.
//
//   2. A DAMAGED SAVE MUST NOT BE OVERWRITTEN. If the stored payload will not
//      parse, the instinct is to clear it and carry on. That throws away the
//      only copy of somebody's project at the exact moment it is in trouble.
//      It is moved aside instead — BUILD BEFORE YOU DELETE applies to bytes in
//      storage the same way it applies to database columns.
//
//   3. A NEWER SCHEMA MUST BE REFUSED, NOT GUESSED. Two tabs, one on a
//      deployment ahead of the other, is not exotic — it is a Tuesday during a
//      deploy. Old code reading a v2 document keeps the fields it recognises
//      and silently drops the rest, then saves the truncated version back over
//      the good one. Refusing to load is the only safe answer.
//
// Storage is injected so every one of those paths can be PROVEN rather than
// asserted about — a quota error is otherwise close to untestable, which is
// precisely why nobody handles it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SCHEMA_VERSION, seedIdsFrom } from './timeline.js';
import { migrateAudio } from './timeline.js';


export const AUTOSAVE_KEY = 'voxel-edit-cut:project';

/** Long enough that a drag is one write, short enough to lose nothing worth
 *  having. A drag emits a change every frame; 60 writes a second would pin the
 *  main thread and serialise the whole document each time. */
export const SAVE_DELAY = 800;

const defaultStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Accessing localStorage THROWS outright when cookies are blocked — the
    // property access itself, before any read. This is not hypothetical; it is
    // the default in an embedded webview.
    return null;
  }
};

/** Human sentence for a failure. One place, so the UI cannot invent its own
 *  wording for a case it has not thought about. */
export function explain(reason) {
  switch (reason) {
    case 'no-storage':
      return 'Your browser is blocking storage, so this project is not being saved. Export before you close the tab.';
    case 'quota':
      return 'There is no room left in browser storage — this project is not being saved. Export before you close the tab.';
    case 'corrupt':
      return 'The saved project could not be read. It has been kept aside rather than deleted.';
    case 'future-schema':
      return 'That project was saved by a newer version of Voxel Edit Cut. Reload the page to get it.';
    case 'empty':
      return 'No saved project.';
    default:
      return 'The project could not be saved.';
  }
}

/**
 * @returns {{ok: true, at: number} | {ok: false, reason: string, message: string}}
 */
export function saveProject(project, { key = AUTOSAVE_KEY, storage = defaultStorage() } = {}) {
  if (!storage) return { ok: false, reason: 'no-storage', message: explain('no-storage') };
  const at = Date.now();
  try {
    storage.setItem(key, JSON.stringify({ schema: SCHEMA_VERSION, savedAt: at, project }));
    return { ok: true, at };
  } catch (err) {
    // QuotaExceededError is the name in Chrome/Firefox; Safari uses code 22 and
    // its own private-mode error. Anything that throws here means not saved,
    // and the only thing that matters is that the customer is told.
    const quota = err?.name === 'QuotaExceededError' || err?.code === 22 || /quota/i.test(err?.message || '');
    const reason = quota ? 'quota' : 'no-storage';
    console.error('[edit-cut] autosave failed:', err);   // silent failures are bugs
    return { ok: false, reason, message: explain(reason) };
  }
}

/**
 * @returns {{ok: true, project: object, savedAt: number}
 *         | {ok: false, reason: 'empty'|'corrupt'|'future-schema'|'no-storage', message: string}}
 */
export function loadProject({ key = AUTOSAVE_KEY, storage = defaultStorage() } = {}) {
  if (!storage) return { ok: false, reason: 'no-storage', message: explain('no-storage') };

  let raw;
  try {
    raw = storage.getItem(key);
  } catch (err) {
    console.error('[edit-cut] autosave read failed:', err);
    return { ok: false, reason: 'no-storage', message: explain('no-storage') };
  }
  if (!raw) return { ok: false, reason: 'empty', message: explain('empty') };

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt', message: explain('corrupt'), raw };
  }
  if (!payload?.project?.tracks) {
    return { ok: false, reason: 'corrupt', message: explain('corrupt'), raw };
  }

  const schema = payload.schema ?? payload.project.schema ?? 1;
  if (schema > SCHEMA_VERSION) {
    return { ok: false, reason: 'future-schema', message: explain('future-schema'), raw };
  }

  // ── THE LINE THAT MAKES RESTORE SAFE ───────────────────────────────────
  // The id counter lives in the timeline module and restarts at 0 on every
  // page load. Without this, the first clip added after a restore gets an id
  // that ALREADY EXISTS in the document, and deletes and splits start hitting
  // the wrong clip minutes later. See seedIdsFrom.
  seedIdsFrom(payload.project);

  // Restore, then bring the audio field forward. Before 2026-08-25 every clip
  // was born volume:0 in a unit nothing read; now 0 means silent, so a
  // restored project would come back mute. See migrateAudio.
  const project = migrateAudio(payload.project);

  return { ok: true, project, savedAt: payload.savedAt || null };
}

/**
 * Move an unreadable payload out of the way instead of destroying it.
 *
 * Called on a corrupt or future-schema load, BEFORE the editor starts a fresh
 * project — because the moment it does, the first autosave writes over the
 * only copy. Whether anything can be recovered by hand is not the point; the
 * point is that the decision stays the owner's.
 */
export function setAside(raw, { key = AUTOSAVE_KEY, storage = defaultStorage() } = {}) {
  if (!storage || !raw) return null;
  const asideKey = `${key}:unreadable`;
  try {
    storage.setItem(asideKey, raw);
    storage.removeItem(key);
    return asideKey;
  } catch (err) {
    // If it cannot be moved, LEAVE IT. Removing it would be the one outcome
    // worse than a failed rescue.
    console.error('[edit-cut] could not set aside the unreadable project:', err);
    return null;
  }
}

export function clearProject({ key = AUTOSAVE_KEY, storage = defaultStorage() } = {}) {
  try { storage?.removeItem(key); } catch { /* nothing to do */ }
}

/**
 * Debounced autosave with a status the UI is expected to SHOW.
 *
 * `status` is one of 'idle' | 'saving' | 'saved' | 'error'. The error state is
 * not decoration: it is the entire reason the customer would know to export
 * before closing the tab.
 */
export function useAutosave(project, { key = AUTOSAVE_KEY, storage, enabled = true, delay = SAVE_DELAY } = {}) {
  const [state, setState] = useState({ status: 'idle', at: null, error: null });
  const timer = useRef(0);
  const latest = useRef(project);
  latest.current = project;

  const opts = useRef({ key, storage });
  opts.current = { key, storage: storage ?? defaultStorage() };

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const result = saveProject(latest.current, opts.current);
    setState(result.ok
      ? { status: 'saved', at: result.at, error: null }
      : { status: 'error', at: null, error: result.message });
    return result;
  }, []);

  useEffect(() => {
    if (!enabled || !project) return undefined;
    setState((s) => (s.status === 'error' ? s : { ...s, status: 'saving' }));
    timer.current = setTimeout(flush, delay);
    return () => clearTimeout(timer.current);
  }, [project, enabled, delay, flush]);

  // A pending write must not be lost to the very event autosave exists for.
  // Without this, closing the tab within `delay` of the last edit loses it —
  // the exact window a debounce creates.
  useEffect(() => {
    if (!enabled) return undefined;
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [enabled, flush]);

  return { ...state, saveNow: flush };
}
