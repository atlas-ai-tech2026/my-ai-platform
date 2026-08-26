// ─── versions.js ─────────────────────────────────────────────────────────────
// Named save points you can come back to.
//
// ── WHAT THIS ADDS THAT WE DID NOT HAVE ────────────────────────────────────
// Autosave keeps ONE state and overwrites it. Undo is linear, in memory, and
// gone the moment the tab reloads. Neither answers "I liked it better twenty
// minutes ago, before I tried the fast cut" — which is the normal way an edit
// actually goes.
//
// ── AND ⌘S WAS DOING SOMETHING WORSE THAN NOTHING ──────────────────────────
// The shortcut hook returns early on any modifier, so ⌘S fell through to the
// browser and opened "Save page as…". An editor's muscle memory reaching for
// save got a file dialog for the web page. Binding it here removes that too.
//
// ── STORED LOCALLY, ON PURPOSE, FOR NOW ────────────────────────────────────
// A version is a snapshot of the project JSON — tracks, clips and source URLS,
// never media — so it is kilobytes, not megabytes. localStorage is the right
// first home: instant, no server round trip, no schema to migrate. The cost is
// that versions do not follow you to another machine, which is worth saying
// out loud in the UI rather than letting somebody discover it.
//
// The quota is the one real hazard, so it is handled explicitly: a save that
// does not fit prunes the oldest and retries, and if it still does not fit it
// FAILS LOUDLY rather than half-writing. Losing the current edit to make room
// for a snapshot of it would be an absurd way to lose work.

export const MAX_VERSIONS = 20;

export const versionsKey = (projectId) => `voxel-edit-cut:versions:${projectId || 'demo'}`;

const store = (storage) => storage || (typeof localStorage !== 'undefined' ? localStorage : null);

/** Newest first. Always an array — a corrupted key reads as "no versions"
 *  rather than throwing on a page that is otherwise fine. */
export function listVersions(projectId, { storage } = {}) {
  const s = store(storage);
  if (!s) return [];
  try {
    const raw = s.getItem(versionsKey(projectId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** `HH:MM` in the customer's own locale — the only label that needs no
 *  explanation when you are scanning a list to find "the one from before
 *  lunch". A full date would be noise; every version here is from today or
 *  recent enough that the time is the useful part. */
export function autoLabel(at) {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Take a snapshot.
 *
 * @returns {{ok: true, version, list}} or {{ok: false, reason}} — never a
 *          silent failure. A save point the customer believes exists and does
 *          not is worse than no save points at all.
 */
export function saveVersion(projectId, project, { label, storage, now = Date.now(), id } = {}) {
  const s = store(storage);
  if (!s) return { ok: false, reason: 'This browser is not storing anything, so versions cannot be kept.' };
  if (!project?.tracks) return { ok: false, reason: 'There is no project to save.' };

  const version = {
    id: id || `v${now}`,
    at: now,
    label: String(label || autoLabel(now)).slice(0, 60),
    project,
  };

  let list = [version, ...listVersions(projectId, { storage: s })].slice(0, MAX_VERSIONS);

  // Try, prune, try again. A project with a lot of clips plus twenty snapshots
  // can genuinely reach the quota, and the oldest snapshot is the cheapest
  // thing in the room to give up.
  for (let attempt = 0; attempt < MAX_VERSIONS; attempt += 1) {
    try {
      s.setItem(versionsKey(projectId), JSON.stringify(list));
      return { ok: true, version, list };
    } catch {
      if (list.length <= 1) {
        return {
          ok: false,
          reason: 'There is no room left in this browser to keep a version. '
            + 'Your edit is safe — only the snapshot could not be stored.',
        };
      }
      list = list.slice(0, -1);
    }
  }
  return { ok: false, reason: 'The version could not be stored.' };
}

/** The project as it was. Null when the id is unknown — a caller must not
 *  restore `undefined` over a live edit. */
export function restoreVersion(projectId, versionId, { storage } = {}) {
  const found = listVersions(projectId, { storage }).find((v) => v.id === versionId);
  return found?.project || null;
}

export function deleteVersion(projectId, versionId, { storage } = {}) {
  const s = store(storage);
  if (!s) return [];
  const list = listVersions(projectId, { storage: s }).filter((v) => v.id !== versionId);
  try { s.setItem(versionsKey(projectId), JSON.stringify(list)); } catch { /* nothing to do */ }
  return list;
}

/** Enough to tell two snapshots apart at a glance without opening them. */
export function describeVersion(version) {
  const tracks = version?.project?.tracks || [];
  const clips = tracks.reduce((n, t) => n + (t.clips?.length || 0), 0);
  const end = tracks.reduce((max, t) => Math.max(max,
    ...(t.clips || []).map((c) => c.start + (c.out - c.in) / (c.speed || 1))), 0);
  return {
    clips,
    tracks: tracks.length,
    seconds: Math.round(end),
    summary: `${clips} clip${clips === 1 ? '' : 's'} · ${Math.round(end)}s`,
  };
}
