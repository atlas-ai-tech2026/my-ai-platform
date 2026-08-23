// ─── Edit.jsx ────────────────────────────────────────────────────────────────
// /edit — a gate.
//
//   signed out  →  EditWaitlist  (collects the address, and actually stores it)
//   signed in   →  EditCut       (Voxel Edit Cut)
//
// ── WHAT CHANGED, 2026-08-23 ───────────────────────────────────────────────
// A signed-in customer used to get EditWorkspace: a single-clip editor with a
// row of free tools. The owner reviewed it and rejected it — "this is what I
// need for edit, not the one which you created" — and Edit Cut is what
// replaced it: a real timeline, multiple tracks, cuts, trims, a viewer, export,
// and remaking a shot in place.
//
// EditWorkspace is left in the tree on purpose. BUILD BEFORE YOU DELETE: it
// comes out once the owner has confirmed Edit Cut works for them here, not on
// the strength of me believing it does.
//
// ── NO LIBRARY FETCH HERE ANY MORE ─────────────────────────────────────────
// This page used to load the customer's videos and pass them down. Edit Cut
// fetches its own, because the library is one panel among several and the page
// has no business knowing about it. This file is now only the gate.

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';

import EditWaitlist from '@/components/edit/EditWaitlist';
import EditCut from '@/components/edit/EditCut';
import ProjectPicker from '@/components/edit/ProjectPicker';
import { listProjects, fetchProject, deleteProject, ENTITY } from '@/lib/project-store';

const Projects = base44.entities[ENTITY];

export default function Edit() {
  const { isAuthenticated, isLoadingAuth, openAuthModal } = useAuth();

  // null = still deciding · 'pick' = show the list · otherwise the editor
  const [view, setView] = useState(null);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [opened, setOpened] = useState(null);   // { project, id, updatedAt }

  const refresh = useCallback(async () => {
    const list = await listProjects(Projects, { limit: 20 });
    if (!list.ok) { setError(list.message); setProjects([]); return []; }
    setError(null);
    setProjects(list.projects);
    return list.projects;
  }, []);

  // ── WHAT YOU OPEN WITH ─────────────────────────────────────────────────
  // Nothing yet → straight into an empty editor, because a list of nothing is
  // worse than simply starting. Something already → show it and let the
  // customer choose, rather than guessing "most recent" and autosaving into
  // whatever the guess landed on.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    (async () => {
      const found = await refresh();
      if (cancelled) return;
      setView(found.length ? 'pick' : 'edit');
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, refresh]);

  async function open(id) {
    const got = await fetchProject(Projects, id);
    if (!got.ok) { setError(got.message); await refresh(); return; }
    setOpened({ project: got.project, id, updatedAt: got.updatedAt });
    setView('edit');
  }

  async function remove(p) {
    // Named in the question. An unnamed confirmation is how somebody deletes
    // the wrong thing.
    if (!window.confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    const out = await deleteProject(Projects, p.id);
    if (!out.ok) setError(out.message);
    await refresh();
  }

  if (isLoadingAuth) {
    return <div className="min-h-screen flex items-center justify-center text-foreground-secondary">Loading…</div>;
  }

  if (!isAuthenticated) return <EditWaitlist onSignIn={openAuthModal} />;

  if (view === null) {
    return <ProjectPicker loading />;
  }

  if (view === 'pick') {
    return (
      <ProjectPicker
        projects={projects}
        error={error}
        onOpen={open}
        onNew={() => { setOpened(null); setView('edit'); }}
        onDelete={remove}
      />
    );
  }

  // No `demo`: a customer opens their own work or an empty timeline. Never a
  // project of racing cars they did not make, autosaving into their account.
  return (
    <EditCut
      key={opened?.id || 'new'}
      startWith={opened}
      onLeave={async () => { await refresh(); setView('pick'); }}
    />
  );
}
