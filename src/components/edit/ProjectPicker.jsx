// ─── ProjectPicker.jsx ───────────────────────────────────────────────────────
// What you see when you open the editor and already have work.
//
// ── WHY NOT JUST REOPEN THE LAST PROJECT ───────────────────────────────────
// Because "most recent" is a guess, and the editor autosaves. With one project
// the guess is always right. With twenty it is usually wrong — and if you start
// cutting before you notice, you have edited a project you never chose to open.
//
// Premiere, Resolve and Final Cut all open a project browser; Figma opens a
// file list; ChatCut's account menu has "My Projects". Everyone lands here.
//
// ── AND WHY IT IS CARDS WITH PICTURES, NOT A LIST OF NAMES ─────────────────
// The first version was rows of text. Four projects called "Demo" with only a
// timestamp between them is a list you have to open ONE BY ONE to use, which
// is the same as having no list. The owner's word for it was that it needed to
// look more professional; the substance under that word is that a browser
// without previews is not a browser.
//
// So every card shows the frame the project OPENS on, how long it runs, and how
// many clips are in it. Those three answer "which one is this" without a click.
//
// Names are editable in place for the same reason: four things called "Demo"
// stay hard to tell apart no matter how good the thumbnail is.

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Film, Loader2, AlertCircle, Trash2, Pencil } from 'lucide-react';

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

const clock = (secs) => {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function ProjectPicker({
  projects = [], loading, error, onOpen, onNew, onDelete, onRename, busyId = null,
}) {
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-2 text-sm text-foreground-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Looking for your projects…
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] max-w-6xl mx-auto px-6 py-10">
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="font-heading text-2xl tracking-wider text-white">VOXEL EDIT CUT</h1>
        {projects.length > 0 && (
          <span className="text-xs text-foreground-muted font-mono">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-sm text-foreground-secondary mb-6">
        Pick up where you left off, or start something new.
      </p>

      {/* An error is NOT an empty list. "You have no projects" when the real
          answer is "we could not ask" sends somebody looking for work that is
          still there. */}
      {error && (
        <p className="flex items-start gap-2 text-xs text-primary mb-4" data-testid="picker-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* New project is a CARD in the grid, the same size as the rest — it is
            the most common reason to be on this screen, not a footnote. */}
        <button
          type="button"
          onClick={onNew}
          data-testid="new-project"
          // h-full, NOT the poster's aspect ratio: a project card is a poster
          // PLUS a caption, so matching only the poster leaves this one short
          // and the row visibly ragged. Grid items stretch — let them.
          className="group h-full min-h-[13rem] flex flex-col items-center justify-center gap-2 rounded-xl
            border border-dashed border-border hover:border-primary hover:bg-primary/5
            transition-colors"
        >
          <span className="rounded-full bg-primary p-2.5 text-white group-hover:scale-105 transition-transform">
            <Plus className="w-4 h-4" />
          </span>
          <span className="text-sm text-white">New project</span>
          <span className="text-[11px] text-foreground-muted">An empty timeline</span>
        </button>

        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            busy={busyId === p.id}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
          />
        ))}
      </div>

      {!error && projects.length === 0 && (
        <p className="mt-6 text-xs text-foreground-muted">
          Your first project appears here once you put a clip on the timeline.
        </p>
      )}
    </div>
  );
}

function ProjectCard({ project: p, busy, onOpen, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const input = useRef(null);

  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name is not a rename, it is a mistake — put the old one back
    // rather than leaving a card with no label.
    if (!next || next === p.name) { setDraft(p.name); return; }
    onRename?.(p, next);
  };

  return (
    <div className="group relative rounded-xl border border-border hover:border-primary/60 overflow-hidden transition-colors">
      <button
        type="button"
        onClick={() => !editing && onOpen?.(p.id)}
        disabled={busy}
        aria-label={`Open ${p.name}`}
        data-testid={`open-${p.id}`}
        className="block w-full text-left"
      >
        {/* THE FRAME THE PROJECT OPENS ON. #t=0.1 asks for a real frame — some
            encoders start on a black one. preload="metadata" so a page of
            twelve cards does not download twelve videos. */}
        <div className="aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
          {p.poster ? (
            <video
              src={`${p.poster}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <Film className="w-6 h-6 text-foreground-muted" />
          )}
        </div>

        <div className="p-3">
          {editing ? (
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') { setDraft(p.name); setEditing(false); }
              }}
              aria-label="Project name"
              data-testid={`rename-${p.id}`}
              className="w-full bg-transparent border-b border-primary text-sm text-white outline-none"
            />
          ) : (
            <span className="block truncate text-sm text-white">{p.name}</span>
          )}
          <span className="mt-0.5 block text-[11px] text-foreground-muted font-mono">
            {[ago(p.updatedAt), clock(p.duration), p.clips ? `${p.clips} clip${p.clips === 1 ? '' : 's'}` : null, p.ratio]
              .filter(Boolean).join(' · ')}
          </span>
        </div>
      </button>

      {/* Held out of the button so a rename or a delete cannot open the project
          on the way past. */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {onRename && (
          <button
            type="button"
            onClick={() => { setDraft(p.name); setEditing(true); }}
            aria-label={`Rename ${p.name}`}
            data-testid={`rename-btn-${p.id}`}
            className="rounded-md bg-black/70 p-1.5 text-foreground-secondary hover:text-white backdrop-blur"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(p)}
            aria-label={`Delete ${p.name}`}
            data-testid={`delete-${p.id}`}
            className="rounded-md bg-black/70 p-1.5 text-foreground-secondary hover:text-primary backdrop-blur"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 className="w-4 h-4 animate-spin text-white" />
        </span>
      )}
    </div>
  );
}
