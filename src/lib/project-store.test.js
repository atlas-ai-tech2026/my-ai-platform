// ─── project-store.test.js ───────────────────────────────────────────────────
// The test that matters is "two tabs do not destroy each other's work".
//
// The owner works with several Voxel tabs open. Both autosave. Without the
// conflict check the second write silently overwrites the first tab's edit and
// nothing anywhere says so — the worst shape a data-loss bug can take, because
// the person who lost the work has no reason to suspect anything happened.

import { describe, it, expect, vi } from 'vitest';
import {
  listProjects, fetchProject, createProject, saveProject, deleteProject, ENTITY, SERVER_SAVE_DELAY,
} from './project-store.js';

const PROJECT = { schema: 1, name: 'Reel', ratio: '9:16', sources: {}, tracks: [{ id: 't1', kind: 'video', clips: [] }] };

/** An entity proxy shaped like base44.entities.X */
function fakeEntity(rows = {}) {
  const store = new Map(Object.entries(rows));
  return {
    store,
    list: vi.fn(async () => [...store.values()]),
    get: vi.fn(async (id) => {
      if (!store.has(id)) { const e = new Error('Not found'); e.status = 404; throw e; }
      return store.get(id);
    }),
    create: vi.fn(async (data) => {
      const row = { id: `p${store.size + 1}`, updated_date: '2026-08-23T10:00:00Z', ...data };
      store.set(row.id, row);
      return row;
    }),
    update: vi.fn(async (id, data) => {
      const row = { ...store.get(id), ...data, updated_date: new Date().toISOString() };
      store.set(id, row);
      return row;
    }),
    delete: vi.fn(async (id) => { store.delete(id); }),
  };
}

const failing = (status, msg = 'boom') => {
  const err = Object.assign(new Error(msg), { status });
  return { list: vi.fn().mockRejectedValue(err), get: vi.fn().mockRejectedValue(err),
    create: vi.fn().mockRejectedValue(err), update: vi.fn().mockRejectedValue(err),
    delete: vi.fn().mockRejectedValue(err) };
};

describe('two tabs must not destroy each other', () => {
  it('REFUSES to save over a copy that changed since we loaded it', async () => {
    const e = fakeEntity({ p1: { id: 'p1', updated_date: '2026-08-23T12:00:00Z', project: PROJECT } });
    // We loaded at 11:00; another tab saved at 12:00.
    const r = await saveProject(e, 'p1', PROJECT, { lastSeen: '2026-08-23T11:00:00Z' });

    expect(r.ok, 'the other tab’s work was silently overwritten').toBe(false);
    expect(r.reason).toBe('conflict');
    expect(r.message).toMatch(/another tab/i);
    expect(e.update, 'it wrote anyway').not.toHaveBeenCalled();
  });

  it('saves happily when nothing moved underneath', async () => {
    const e = fakeEntity({ p1: { id: 'p1', updated_date: '2026-08-23T11:00:00Z', project: PROJECT } });
    const r = await saveProject(e, 'p1', PROJECT, { lastSeen: '2026-08-23T11:00:00Z' });
    expect(r.ok).toBe(true);
    expect(e.update).toHaveBeenCalled();
  });

  it('saves without a check on the first write of a session', async () => {
    const e = fakeEntity({ p1: { id: 'p1', updated_date: '2026-08-23T12:00:00Z', project: PROJECT } });
    const r = await saveProject(e, 'p1', PROJECT, { lastSeen: null });
    expect(r.ok).toBe(true);
    expect(e.get, 'it read the row when it had nothing to compare against').not.toHaveBeenCalled();
  });
});

describe('failures say which one they are', () => {
  it('signed out reads as signed out, not as a broken database', async () => {
    const r = await saveProject(failing(401), 'p1', PROJECT);
    expect(r.reason).toBe('signed-out');
    expect(r.message).toMatch(/Sign in/i);
  });

  it('a deleted project says so rather than "save failed"', async () => {
    const r = await saveProject(failing(404), 'p1', PROJECT);
    expect(r.reason).toBe('missing');
    expect(r.message).toMatch(/no longer exists/i);
  });

  it('an outage with no server message still says something useful', async () => {
    const r = await createProject(failing(503, ''), PROJECT);
    expect(r.message).toMatch(/cannot be saved right now/i);
  });

  it('listing while signed out is distinguishable from having no projects', async () => {
    // Otherwise a signed-out visitor is told they have no projects, which is
    // both wrong and alarming.
    const r = await listProjects(failing(401));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('signed-out');
  });
});

describe('loading', () => {
  it('returns the project', async () => {
    const e = fakeEntity({ p1: { id: 'p1', updated_date: 'x', project: PROJECT } });
    const r = await fetchProject(e, 'p1');
    expect(r.ok).toBe(true);
    expect(r.project.tracks).toHaveLength(1);
  });

  it('a row holding nothing usable is CORRUPT, not empty', async () => {
    // Handing the editor an object it will fail on later, somewhere less
    // obvious, is worse than refusing here.
    const e = fakeEntity({ p1: { id: 'p1', project: { name: 'x' } } });
    expect((await fetchProject(e, 'p1')).reason).toBe('corrupt');
  });

  it('someone else’s project is "no longer exists" — the API will not say more', async () => {
    // The server returns 404 rather than 403 on purpose, so it cannot confirm
    // another user's record exists. The message must not undo that.
    const r = await fetchProject(fakeEntity(), 'not-mine');
    expect(r.reason).toBe('missing');
    expect(r.message).not.toMatch(/permission|forbidden|another/i);
  });
});

describe('the list', () => {
  it('summarises without dragging every clip along', async () => {
    // A list of twenty projects should not ship twenty full timelines.
    const e = fakeEntity({
      p1: { id: 'p1', updated_date: '2026-08-23T10:00:00Z', project: PROJECT },
    });
    const r = await listProjects(e);
    expect(r.projects[0]).toMatchObject({ id: 'p1', name: 'Reel', updatedAt: '2026-08-23T10:00:00Z', ratio: '9:16' });
    // The point is that the CLIPS do not come along — a summary carries what a
    // card needs to draw, not the whole timeline twenty times over.
    expect(r.projects[0].tracks).toBeUndefined();
    expect(r.projects[0].sources).toBeUndefined();
  });

  it('asks for newest first', async () => {
    const e = fakeEntity();
    await listProjects(e, { limit: 5 });
    expect(e.list).toHaveBeenCalledWith('-updated_date', 5, 0);
  });
});

describe('create and delete', () => {
  it('creates and hands back the id', async () => {
    const e = fakeEntity();
    const r = await createProject(e, PROJECT);
    expect(r.ok).toBe(true);
    expect(r.id).toBeTruthy();
  });

  it('deletes', async () => {
    const e = fakeEntity({ p1: { id: 'p1' } });
    expect((await deleteProject(e, 'p1')).ok).toBe(true);
    expect(e.store.has('p1')).toBe(false);
  });
});

describe('the shape of the contract', () => {
  it('stores under a name of its own, not mixed in with generations', async () => {
    expect(ENTITY).toBe('EditProject');
  });

  it('waits longer before a SERVER save than a local one', async () => {
    // Local is free; a network round trip is not, and nobody needs their
    // project on another machine within one second.
    const { SAVE_DELAY } = await import('./editor-autosave.js');
    expect(SERVER_SAVE_DELAY).toBeGreaterThan(SAVE_DELAY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useServerAutosave', () => {
  it('a conflict is STICKY — it must not retry and win', async () => {
    // Retrying is the whole danger: the second attempt has a fresher lastSeen
    // and would sail past the check, destroying the other tab's work after
    // correctly refusing to the first time.
    const { renderHook, act } = await import('@testing-library/react');
    const { useServerAutosave } = await import('./project-store.js');
    vi.useFakeTimers();

    const e = fakeEntity({ p1: { id: 'p1', updated_date: '2026-08-23T12:00:00Z', project: PROJECT } });
    const { result, rerender } = renderHook(
      // We loaded at 11:00; the row on the server is already at 12:00 because
      // another tab saved in between.
      ({ p }) => useServerAutosave(p, { entity: e, projectId: 'p1', delay: 10,
        lastSeenAt: '2026-08-23T11:00:00Z' }),
      { initialProps: { p: PROJECT } },
    );
    await act(async () => { await result.current.saveNow(); });
    expect(result.current.status, 'it did not even notice the conflict').toBe('conflict');
    expect(e.update, 'it overwrote the other tab').not.toHaveBeenCalled();

    const writes = e.update.mock.calls.length;
    rerender({ p: { ...PROJECT, name: 'changed' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(e.update.mock.calls.length, 'it retried after a refusal').toBe(writes);
    vi.useRealTimers();
  });
});

describe('a 503 keeps the server’s own words', () => {
  it('does not replace a precise cause with a guess about the database', async () => {
    // On a dev machine the real cause is the backend not running, and the
    // proxy says exactly that. Overriding it with "the database is
    // unavailable" is the failure the platform's error rule exists to stop.
    const err = Object.assign(new Error('Backend not running on :3001. Run `npm run dev` from the repo root.'), { status: 503 });
    const e = { create: vi.fn().mockRejectedValue(err) };
    const r = await createProject(e, PROJECT);
    expect(r.message).toMatch(/Backend not running/);
    expect(r.message).not.toMatch(/database is unavailable/);
  });
});

describe('adopting the project the page found', () => {
  it('does not create a second row when the id arrives after mount', async () => {
    // The page has to ASK the server which project this is, so the id lands
    // after mount. Without adopting it, every reload creates a new project and
    // the one you were working on is buried.
    const { renderHook, act } = await import('@testing-library/react');
    const { useServerAutosave } = await import('./project-store.js');
    vi.useFakeTimers();

    const e = fakeEntity({ p1: { id: 'p1', updated_date: '2026-08-23T11:00:00Z', project: PROJECT } });
    const { result, rerender } = renderHook(
      ({ id, at }) => useServerAutosave(PROJECT, { entity: e, projectId: id, lastSeenAt: at, delay: 10 }),
      { initialProps: { id: null, at: null } },
    );
    rerender({ id: 'p1', at: '2026-08-23T11:00:00Z' });
    await act(async () => { await result.current.saveNow(); });

    expect(e.create, 'it made a second project instead of using the one it was given').not.toHaveBeenCalled();
    expect(e.update).toHaveBeenCalledWith('p1', expect.anything());
    vi.useRealTimers();
  });

  it('a late answer never repoints a session that already owns an id', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useServerAutosave } = await import('./project-store.js');
    vi.useFakeTimers();

    const e = fakeEntity({
      p1: { id: 'p1', updated_date: '2026-08-23T11:00:00Z', project: PROJECT },
      p2: { id: 'p2', updated_date: '2026-08-23T11:00:00Z', project: PROJECT },
    });
    const { result, rerender } = renderHook(
      ({ id }) => useServerAutosave(PROJECT, { entity: e, projectId: id, delay: 10 }),
      { initialProps: { id: 'p1' } },
    );
    rerender({ id: 'p2' });          // a stale request answering late
    await act(async () => { await result.current.saveNow(); });
    expect(e.update, 'it wrote to a different project mid-edit').toHaveBeenCalledWith('p1', expect.anything());
    vi.useRealTimers();
  });
});

describe('the demo must never write to a customer’s account', () => {
  it('refuses on the demo route even when signed in', async () => {
    // The bug this pins: LOAD was guarded on demo and SAVE was not. So the
    // demo never fetched a project, never adopted an id, and saved a NEW one
    // on every page load — a timeline of racing cars the customer did not
    // make, multiplying in their account.
    const { shouldSyncToAccount } = await import('./project-store.js');
    expect(shouldSyncToAccount({ signedIn: true, demo: true })).toBe(false);
  });

  it('syncs a real project for a signed-in customer', async () => {
    const { shouldSyncToAccount } = await import('./project-store.js');
    expect(shouldSyncToAccount({ signedIn: true, demo: false })).toBe(true);
  });

  it('never syncs while signed out', async () => {
    const { shouldSyncToAccount } = await import('./project-store.js');
    expect(shouldSyncToAccount({ signedIn: false, demo: false })).toBe(false);
  });
});

describe('an empty timeline is not a project', () => {
  it('will not save a document whose tracks are all empty', async () => {
    // Otherwise opening the editor CREATES something: check the page five
    // times and own five empty projects.
    const { hasContent } = await import('./project-store.js');
    expect(hasContent({ tracks: [{ id: 't1', clips: [] }, { id: 't2', clips: [] }] })).toBe(false);
  });

  it('counts a single clip as content', async () => {
    const { hasContent } = await import('./project-store.js');
    expect(hasContent({ tracks: [{ id: 't1', clips: [] }, { id: 't2', clips: [{ id: 'c1' }] }] })).toBe(true);
  });

  it('treats nothing at all as empty rather than throwing', async () => {
    const { hasContent } = await import('./project-store.js');
    for (const bad of [null, undefined, {}, { tracks: null }]) {
      expect(hasContent(bad), `${JSON.stringify(bad)} threw or counted`).toBe(false);
    }
  });
});

describe('a card has to be tellable apart', () => {
  it('carries a poster frame, a duration and a clip count', async () => {
    // A name and a date is not enough. Four projects called "Demo" with only a
    // timestamp between them is a list you have to open one by one, which is
    // the same as having no list.
    const e = fakeEntity({ p1: { id: 'p1', updated_date: 'x', project: {
      name: 'Reel', ratio: '9:16',
      sources: { s1: { id: 's1', url: 'https://s/first.mp4' }, s2: { id: 's2', url: 'https://s/later.mp4' } },
      tracks: [
        { kind: 'video', clips: [
          { id: 'c2', sourceId: 's2', start: 6, in: 0, out: 4 },
          { id: 'c1', sourceId: 's1', start: 0, in: 0, out: 5 },
        ] },
        { kind: 'audio', clips: [{ id: 'c3', sourceId: 's1', start: 0, in: 0, out: 10 }] },
      ],
    } } });
    const r = await listProjects(e);
    expect(r.projects[0]).toMatchObject({
      name: 'Reel', clips: 3, duration: 10, ratio: '9:16',
    });
  });

  it('the poster is the clip the project OPENS on, not whichever is first in the array', async () => {
    // What somebody pictures when they think of a project is its first frame.
    const e = fakeEntity({ p1: { id: 'p1', updated_date: 'x', project: {
      sources: { early: { url: 'EARLY.mp4' }, late: { url: 'LATE.mp4' } },
      tracks: [{ kind: 'video', clips: [
        { id: 'b', sourceId: 'late', start: 30, in: 0, out: 2 },
        { id: 'a', sourceId: 'early', start: 0, in: 0, out: 2 },
      ] }],
    } } });
    expect((await listProjects(e)).projects[0].poster).toBe('EARLY.mp4');
  });

  it('an empty project summarises without throwing', async () => {
    const e = fakeEntity({ p1: { id: 'p1', updated_date: 'x', project: { tracks: [{ kind: 'video', clips: [] }] } } });
    const r = await listProjects(e);
    expect(r.projects[0]).toMatchObject({ clips: 0, duration: 0, poster: null });
  });
});
