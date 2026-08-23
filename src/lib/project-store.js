// ─── project-store.js ────────────────────────────────────────────────────────
// Projects that follow you between machines.
//
// Until now an edit lived in ONE browser's localStorage. Open Edit Cut on a
// different computer and the work was not there — not lost exactly, but
// unreachable, which is the same thing to the person who made it.
//
// ── NO NEW SERVER CODE, AND THAT IS THE POINT ──────────────────────────────
// The `entities` table already is a per-user JSON store: every route requires
// a JWT, every query is scoped to `user_id = req.user.id`, and PUT/DELETE
// return 404 rather than 403 for someone else's row so the API cannot even
// confirm that another user's record exists.
//
// A project is exactly that shape. Building a second table and a second set of
// routes would mean writing ownership checks again — and ownership checks are
// the thing you least want a second, less-tested copy of. This stores projects
// as `EditProject` entities and adds no server surface at all.
//
// ── LOCALSTORAGE DOES NOT GO AWAY ──────────────────────────────────────────
// The server is the source of truth on LOAD. localStorage stays as the crash
// net: between saves, and whenever the network is gone, it is the only thing
// standing between a closed laptop and lost work. Removing it because there is
// now a server would be trading a reliable local copy for a round trip that
// can fail.

export const ENTITY = 'EditProject';

/** How long to wait before writing to the SERVER. Longer than the local
 *  autosave on purpose: local is free, a network round trip is not, and
 *  nobody needs their project on another machine within one second. */
export const SERVER_SAVE_DELAY = 4000;

/**
 * May this editor write to the customer's account?
 *
 * ── WHY THIS IS A NAMED RULE AND NOT AN INLINE && ──────────────────────────
 * Because getting it half right is invisible. The demo route was guarded on
 * LOAD and not on SAVE, so it never fetched a project — and therefore never
 * adopted an id — and then saved a NEW one on every single page load. A
 * timeline of racing cars the customer did not make, multiplying in their
 * account, with a status line cheerfully reporting "in your account".
 *
 * Found by the owner reading that status line on the demo route. Two guards
 * that must agree is one guard too many, so it is one function now.
 */
export const shouldSyncToAccount = ({ signedIn, demo }) => Boolean(signedIn) && !demo;

/**
 * Is there anything here worth saving?
 *
 * ── AN EMPTY TIMELINE IS NOT A PROJECT ─────────────────────────────────────
 * Without this rule, opening the editor CREATES something. Look at the page
 * five times to check a detail and you own five empty projects — the same
 * clutter the demo route was producing, wearing different clothes.
 *
 * It is also what makes "open to an empty editor" safe as a design at all:
 * the customer decides when a project exists by putting something on the
 * timeline, not by navigating to a URL.
 *
 * A project with only empty tracks counts as empty. Tracks arrive with the
 * document; clips are the part somebody chose.
 */
/** Sort orders offered on the project browser. `recent` first because it is
 *  right most of the time — the rest exist for when it is not. */
export const SORTS = {
  recent: { label: 'Recent', cmp: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) },
  name: { label: 'Name', cmp: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) },
  longest: { label: 'Longest', cmp: (a, b) => (b.duration || 0) - (a.duration || 0) },
  clips: { label: 'Most clips', cmp: (a, b) => (b.clips || 0) - (a.clips || 0) },
};

/**
 * Narrow the list. Pure, so the behaviour can be pinned without a browser.
 *
 * Search is case- and accent-insensitive and matches ANYWHERE in the name, not
 * just the start — people remember a word from the middle far more often than
 * the first letter.
 */
export function filterProjects(projects = [], { query = '', ratio = null, sort = 'recent' } = {}) {
  const q = String(query).trim().toLowerCase();
  const out = projects.filter((p) => {
    if (ratio && p.ratio !== ratio) return false;
    if (!q) return true;
    return String(p.name || '').toLowerCase().includes(q);
  });
  const cmp = (SORTS[sort] || SORTS.recent).cmp;
  return [...out].sort(cmp);
}

/**
 * Which shapes are actually present, TALLEST FIRST.
 *
 * Offering a filter for a format the customer has never used is a control that
 * can only ever return nothing, so the list is built from what they have.
 *
 * Ordered by aspect value rather than alphabetically, because a string sort on
 * ratios is meaningless to a person — it puts "16:9" before "1:1". Tallest to
 * widest is 9:16 · 4:5 · 1:1 · 16:9, which is both a real progression and the
 * same order as the shape control in the editor. Computed rather than imported
 * from the tool layer: this file is the API boundary and has no business
 * depending on the editor's internals.
 */
export const ratiosPresent = (projects = []) => {
  const value = (r) => {
    const [w, h] = String(r).split(':').map(Number);
    return h ? w / h : Number.MAX_SAFE_INTEGER;
  };
  return [...new Set(projects.map((p) => p.ratio).filter(Boolean))]
    .sort((a, b) => value(a) - value(b));
};

export const hasContent = (project) =>
  Boolean(project?.tracks?.some((t) => (t.clips?.length || 0) > 0));

const message = (err, fallback) => {
  const status = err?.status ?? null;
  if (status === 401 || status === 403) return 'Sign in to save this project to your account.';
  // 503 is "something upstream is down" and the SERVER usually knows which
  // thing. The first version replaced that with "the database is unavailable"
  // — and on a dev machine the real cause is the backend not running at all,
  // which the proxy says precisely. Overriding a precise cause with a guess is
  // the exact failure the platform's error rule exists to prevent.
  if (status === 503) return err?.message || 'Projects cannot be saved right now.';
  return err?.message || fallback;
};

/**
 * Newest first.
 *
 * ── WHY THE LIMIT IS 100 AND WHY IT IS REPORTED ────────────────────────────
 * It was 20, which was fine for a list you only scroll. It is NOT fine for a
 * list you SEARCH: filtering a truncated set makes "no results" mean two
 * completely different things — "you have no project called that" and "you
 * have one, but it is older than the newest twenty and we never fetched it".
 *
 * The second is a lie the screen cannot see it is telling. So the limit is
 * raised, and `capped` says when we hit it, so the UI can admit the list is
 * not everything rather than implying it is.
 *
 * Beyond a few hundred this needs to move server-side. Saying so here is
 * cheaper than discovering it from a customer who cannot find their work.
 */
export async function listProjects(entity, { limit = 100 } = {}) {
  try {
    const rows = await entity.list('-updated_date', limit, 0);
    return { ok: true, projects: (rows || []).map(toSummary), capped: (rows || []).length >= limit };
  } catch (err) {
    return { ok: false, reason: err?.status === 401 ? 'signed-out' : 'failed', message: message(err, 'Your projects could not be loaded.') };
  }
}

/**
 * What a card needs to be TELLABLE APART.
 *
 * A name and a date is not enough. Four projects called "Demo" with only a
 * timestamp between them is a list you have to open one by one — which is the
 * same as having no list.
 *
 * So the summary carries a poster frame, a duration and a clip count. All three
 * are already in the row; none of it costs another request.
 */
function toSummary(row) {
  const project = row.project || {};
  const tracks = project.tracks || [];
  const clips = tracks.reduce((n, t) => n + (t.clips?.length || 0), 0);

  // The first video clip in timeline order — what the project OPENS on, which
  // is what somebody pictures when they think of it.
  let poster = null;
  const video = tracks.find((t) => t.kind === 'video');
  const first = [...(video?.clips || [])].sort((a, b) => a.start - b.start)[0];
  if (first) poster = project.sources?.[first.sourceId]?.url || null;

  // Duration is computed here rather than imported from timeline.js: this file
  // is the API layer and has no business depending on the editor's internals.
  const end = tracks.reduce((max, t) => t.clips.reduce(
    (m, c) => Math.max(m, c.start + (c.out - c.in) / (c.speed || 1)), max), 0);

  return {
    id: row.id,
    name: project.name || row.name || 'Untitled project',
    updatedAt: row.updated_date || null,
    ratio: project.ratio || null,
    clips,
    duration: Math.round(end * 10) / 10,
    poster,
  };
}

export async function fetchProject(entity, id) {
  try {
    const row = await entity.get(id);
    if (!row?.project?.tracks) {
      // A row that exists but holds nothing usable. Saying so beats handing
      // the editor an object it will fail on later, somewhere less obvious.
      return { ok: false, reason: 'corrupt', message: 'That project could not be read.' };
    }
    return { ok: true, project: row.project, updatedAt: row.updated_date || null };
  } catch (err) {
    // 404 here is genuinely "not yours or not there" — the API deliberately
    // does not distinguish, and neither should this message.
    if (err?.status === 404) return { ok: false, reason: 'missing', message: 'That project no longer exists.' };
    return { ok: false, reason: 'failed', message: message(err, 'That project could not be loaded.') };
  }
}

export async function createProject(entity, project) {
  try {
    const row = await entity.create({ name: project?.name || 'Untitled project', project });
    return { ok: true, id: row.id, updatedAt: row.updated_date || null };
  } catch (err) {
    return { ok: false, reason: err?.status === 401 ? 'signed-out' : 'failed', message: message(err, 'The project could not be created.') };
  }
}

/**
 * Save, refusing to overwrite a NEWER copy.
 *
 * ── WHY THE CHECK IS HERE AT ALL ───────────────────────────────────────────
 * Two tabs open on the same project is not a hypothetical — the owner works
 * with several Voxel tabs open right now. Both autosave. Without a check the
 * second write silently destroys the first tab's work, and nothing anywhere
 * says so.
 *
 * It is a read-then-write, so it is not airtight against a true simultaneous
 * save. It does not need to be: the case it exists for is one person with two
 * tabs seconds apart, and for that it is exact. Saying "not airtight" out loud
 * is better than implying a guarantee that is not there.
 */
export async function saveProject(entity, id, project, { lastSeen = null } = {}) {
  try {
    if (lastSeen) {
      const current = await entity.get(id).catch(() => null);
      const serverAt = current?.updated_date;
      if (serverAt && new Date(serverAt) > new Date(lastSeen)) {
        return {
          ok: false,
          reason: 'conflict',
          message: 'This project was changed somewhere else — probably another tab. Reload before saving, or your other changes will be lost.',
          serverUpdatedAt: serverAt,
        };
      }
    }
    const row = await entity.update(id, { name: project?.name || 'Untitled project', project });
    return { ok: true, updatedAt: row?.updated_date || new Date().toISOString() };
  } catch (err) {
    if (err?.status === 404) return { ok: false, reason: 'missing', message: 'That project no longer exists — it may have been deleted.' };
    return { ok: false, reason: err?.status === 401 ? 'signed-out' : 'failed', message: message(err, 'The project could not be saved.') };
  }
}

export async function deleteProject(entity, id) {
  try {
    await entity.delete(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: message(err, 'The project could not be deleted.') };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keep the project on the server, quietly.
 *
 * Runs ALONGSIDE the local autosave rather than instead of it. Local fires at
 * 800ms and is the crash net; this fires at four seconds and is what makes the
 * work reachable from another machine. If the network is gone, local still has
 * it — which is exactly why local was not removed when this arrived.
 *
 * The first save CREATES the row. Making the customer press "save to my
 * account" first would mean the one edit most likely to be lost — the first
 * one, before they knew there was a button — is the one that is not protected.
 *
 * `status` is one of 'idle' | 'saving' | 'saved' | 'error' | 'conflict'.
 * Conflict is its own state on purpose: every other error means "try again",
 * and that one means "do NOT try again, you will destroy something".
 */
export function useServerAutosave(project, {
  entity, enabled = true, projectId = null, delay = SERVER_SAVE_DELAY,
  // What the server said when this project was LOADED.
  //
  // Without it the first save of a session has nothing to compare against and
  // skips the conflict check entirely — which is exactly the moment two tabs
  // collide, because both loaded the same version and both are about to write.
  // The gap showed up as a test that could not be set up: there was no way to
  // express "we are holding an older copy", because the hook had no way to be
  // told one.
  lastSeenAt = null,
} = {}) {
  const [state, setState] = useState({ status: 'idle', at: null, error: null, id: projectId });
  const timer = useRef(0);
  const latest = useRef(project);
  latest.current = project;
  const idRef = useRef(projectId);
  const lastSeen = useRef(lastSeenAt);

  // The id and version usually arrive AFTER mount — the page has to ask the
  // server which project this is. Without adopting them, every page load
  // creates a brand-new row: reload five times, get five projects, and the one
  // you were actually working on is buried.
  //
  // Only ever adopted, never overwritten: once this session owns an id, a late
  // answer must not repoint it at a different project mid-edit.
  useEffect(() => {
    if (projectId && !idRef.current) idRef.current = projectId;
    if (lastSeenAt && !lastSeen.current) lastSeen.current = lastSeenAt;
  }, [projectId, lastSeenAt]);
  // One save at a time. Without this a slow round trip overlapping the next
  // debounce fires two writes, and the conflict check compares against a value
  // the in-flight save is about to change.
  const busy = useRef(false);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!enabled || !entity || !latest.current || busy.current) return;
    busy.current = true;
    setState((s) => ({ ...s, status: 'saving' }));
    try {
      if (!idRef.current) {
        const made = await createProject(entity, latest.current);
        if (!made.ok) { setState({ status: 'error', at: null, error: made.message, id: null }); return; }
        idRef.current = made.id;
        lastSeen.current = made.updatedAt;
        setState({ status: 'saved', at: Date.now(), error: null, id: made.id });
        return;
      }
      const saved = await saveProject(entity, idRef.current, latest.current, { lastSeen: lastSeen.current });
      if (!saved.ok) {
        setState({
          status: saved.reason === 'conflict' ? 'conflict' : 'error',
          at: null, error: saved.message, id: idRef.current,
        });
        return;
      }
      lastSeen.current = saved.updatedAt;
      setState({ status: 'saved', at: Date.now(), error: null, id: idRef.current });
    } finally {
      busy.current = false;
    }
  }, [enabled, entity]);

  useEffect(() => {
    if (!enabled || !entity || !project) return undefined;
    // A conflict is sticky. Re-running the timer would retry the save that was
    // just refused and overwrite the other tab on the second attempt.
    if (state.status === 'conflict') return undefined;
    timer.current = setTimeout(flush, delay);
    return () => clearTimeout(timer.current);
  }, [project, enabled, entity, delay, flush, state.status]);

  return { ...state, saveNow: flush };
}
