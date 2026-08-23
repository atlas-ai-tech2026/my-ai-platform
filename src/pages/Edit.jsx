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

import React from 'react';
import { useAuth } from '@/lib/AuthContext';

import EditWaitlist from '@/components/edit/EditWaitlist';
import EditCut from '@/components/edit/EditCut';

export default function Edit() {
  const { isAuthenticated, isLoadingAuth, openAuthModal } = useAuth();

  if (isLoadingAuth) {
    return <div className="min-h-screen flex items-center justify-center text-foreground-secondary">Loading…</div>;
  }

  if (!isAuthenticated) return <EditWaitlist onSignIn={openAuthModal} />;

  // No `demo`: a customer opens their own work or an empty timeline. Never a
  // project of racing cars they did not make, autosaving into their account.
  return <EditCut />;
}
