// ─── TimelinePreview.jsx ─────────────────────────────────────────────────────
// The scratch route Voxel Edit Cut was built on, kept alive deliberately.
//
// The editor now lives at /edit for signed-in customers. This stays because the
// owner has been testing here all day and their bookmark should not break the
// moment it moves — and because it opens with a DEMO timeline, which /edit must
// never do. Real video already on the tracks is the fastest way to look at
// dragging, trimming and cutting without signing in first.
//
// Delete once /edit is confirmed working. BUILD BEFORE YOU DELETE.

import React from 'react';
import EditCut from '@/components/edit/EditCut';
import { editCutVisible } from '@/lib/edit-cut-flag';
import PageNotFound from '@/lib/PageNotFound';

export default function TimelinePreview() {
  // Gated with the SAME flag as /edit. This route takes no sign-in at all, so
  // without this it would be the one door left open on production — the whole
  // editor, to anyone who guessed the URL, while /edit itself was switched off.
  if (!editCutVisible()) return <PageNotFound />;
  return <EditCut demo />;
}
