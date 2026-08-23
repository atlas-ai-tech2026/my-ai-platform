// ─── ProjectPicker.jsx ───────────────────────────────────────────────────────
// What you see when you open the editor and already have work.
//
// ── WHY NOT JUST REOPEN THE LAST PROJECT ───────────────────────────────────
// Because "most recent" is a guess, and the editor autosaves. With one project
// the guess is always right. With twenty it is usually wrong — and if you start
// cutting before you notice, you have edited a project you never chose to open.
//
// The difference between a tool doing what you asked and a tool guessing.
// Premiere, Resolve and Final Cut all open a project browser; Figma opens a
// file list; ChatCut's own account menu has "My Projects". They all landed here
// for the same reason.
//
// ── AND WHY NOT ALWAYS AN EMPTY EDITOR ─────────────────────────────────────
// The owner's instinct was that empty feels more professional, and the part
// underneath that is right: the editor should never assume. But work hidden
// behind a menu somebody has to go and find is its own failure — the honest
// answer to "where did my edit go?" should be the first thing on the screen.
//
// So: nothing yet → straight into an empty editor, because a list of nothing is
// worse than simply starting. Something already → show it.

import React from 'react';
import { Plus, Film, Loader2, AlertCircle } from 'lucide-react';

/** "3 minutes ago" beats a timestamp for the question actually being asked,
 *  which is "is this the one I was just working on". */
function ago(iso) {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export default function ProjectPicker({ projects = [], loading, error, onOpen, onNew, onDelete, busyId = null }) {
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-2 text-sm text-foreground-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Looking for your projects…
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] max-w-3xl mx-auto px-6 py-12">
      <h1 className="font-heading text-2xl tracking-wider text-white mb-1">VOXEL EDIT CUT</h1>
      <p className="text-sm text-foreground-secondary mb-6">
        Pick up where you left off, or start something new.
      </p>

      <button
        type="button"
        onClick={onNew}
        data-testid="new-project"
        className="w-full flex items-center gap-3 rounded-xl border border-dashed border-border
          hover:border-primary hover:bg-primary/5 px-4 py-4 mb-4 text-left transition-colors"
      >
        <span className="rounded-full bg-primary p-2 text-white"><Plus className="w-4 h-4" /></span>
        <span>
          <span className="block text-sm text-white">New project</span>
          <span className="block text-xs text-foreground-muted">An empty timeline</span>
        </span>
      </button>

      {/* An error is NOT an empty list. "You have no projects" when the real
          answer is "we could not ask" sends somebody looking for work that is
          still there. */}
      {error && (
        <p className="flex items-start gap-2 text-xs text-primary mb-4" data-testid="picker-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {!error && projects.length === 0 && (
        <p className="text-xs text-foreground-muted">
          Nothing here yet — your first project will appear once you put a clip on the timeline.
        </p>
      )}

      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id}>
            <div className="group flex items-center gap-3 rounded-xl border border-border hover:border-primary/60 px-4 py-3 transition-colors">
              <button
                type="button"
                onClick={() => onOpen?.(p.id)}
                disabled={busyId === p.id}
                aria-label={`Open ${p.name}`}
                data-testid={`open-${p.id}`}
                className="flex-1 flex items-center gap-3 text-left min-w-0"
              >
                <Film className="w-4 h-4 shrink-0 text-foreground-muted" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white">{p.name}</span>
                  <span className="block text-[11px] text-foreground-muted font-mono">
                    {ago(p.updatedAt)}{p.ratio ? ` · ${p.ratio}` : ''}
                  </span>
                </span>
              </button>

              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(p)}
                  aria-label={`Delete ${p.name}`}
                  data-testid={`delete-${p.id}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[11px] text-foreground-muted hover:text-primary transition-opacity"
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
