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

/** Newest first. The editor only ever needs a handful. */
export async function listProjects(entity, { limit = 20 } = {}) {
  try {
    const rows = await entity.list('-updated_date', limit, 0);
    return { ok: true, projects: (rows || []).map(toSummary) };
  } catch (err) {
    return { ok: false, reason: err?.status === 401 ? 'signed-out' : 'failed', message: message(err, 'Your projects could not be loaded.') };
  }
}

const toSummary = (row) => ({
  id: row.id,
  name: row.project?.name || row.name || 'Untitled project',
  updatedAt: row.updated_date || null,
  ratio: row.project?.ratio || null,
});

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
