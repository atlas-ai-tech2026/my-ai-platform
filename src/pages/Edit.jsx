// ─── Edit.jsx ────────────────────────────────────────────────────────────────
// /edit — a gate, since 2026-08-21.
//
//   signed out  →  EditWaitlist   (what this whole page used to be)
//   signed in   →  EditWorkspace  (the real editor)
//
// ── WHY THE LIBRARY IS FETCHED HERE AND NOT IN THE WORKSPACE ───────────────
// The workspace takes clips as a prop and knows nothing about the network. That
// keeps the part with all the editing logic testable without mocking an API,
// and it is also what lets the same component be driven later by a saved
// project rather than by a live library fetch.
//
// ── WHY ONLY VIDEO ─────────────────────────────────────────────────────────
// Phase 1 edits video. Images and audio are in the library too, and both will
// come — but shipping a picture into a screen whose every tool assumes a
// timeline would be worse than not offering it. The filter is in the workspace,
// where the tools are.

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';

import EditWaitlist from '@/components/edit/EditWaitlist';
import EditWorkspace from '@/components/edit/EditWorkspace';

const History_ = base44.entities.GenerationHistory;

/** One page of history is plenty to edit from, and it loads instantly. */
const PAGE = 60;

export default function Edit() {
  const { isAuthenticated, isLoadingAuth, openAuthModal } = useAuth();
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await History_.filter({ type: 'video' }, '-created_date', PAGE, 0);
      setClips(Array.isArray(rows) ? rows : []);
    } catch (err) {
      // Never an empty grid that looks like "you have no videos" when the real
      // answer is "we could not ask". The two are indistinguishable on screen
      // and lead somewhere very different.
      setError(err?.message || 'Could not load your library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  if (isLoadingAuth) {
    return <div className="min-h-screen flex items-center justify-center text-foreground-secondary">Loading…</div>;
  }

  if (!isAuthenticated) return <EditWaitlist onSignIn={openAuthModal} />;

  return <EditWorkspace clips={clips} loading={loading} error={error} onReload={load} />;
}
