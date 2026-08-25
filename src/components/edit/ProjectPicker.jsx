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
import { Plus, Film, Loader2, AlertCircle, Trash2, Pencil, Search, X } from 'lucide-react';
import { filterProjects, ratiosPresent, SORTS } from '@/lib/project-store';
import Tip from './Tip';

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
  projects = [], loading, error, capped = false, onOpen, onNew, onDelete, onRename, busyId = null,
}) {
  const [query, setQuery] = useState('');
  const [ratio, setRatio] = useState(null);
  const [sort, setSort] = useState('recent');

  const shapes = ratiosPresent(projects);
  const shown = filterProjects(projects, { query, ratio, sort });
  const narrowed = shown.length !== projects.length;

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
      <p className="text-sm text-foreground-secondary mb-5">
        Pick up where you left off, or start something new.
      </p>

      {/* ── FINDING ONE AMONG MANY ────────────────────────────────────────
          Hidden below four projects, because a filter bar over a list you can
          see in one glance is furniture. It appears when it starts to earn
          its space. */}
      {projects.length > 4 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <label className="relative flex-1 min-w-[12rem] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              aria-label="Search projects by name"
              data-testid="project-search"
              className="w-full rounded-lg border border-border bg-transparent pl-8 pr-8 py-1.5 text-xs text-white
                placeholder:text-foreground-muted outline-none focus:border-primary"
            />
            {query && (
              <Tip label="Clear the search"><button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                data-testid="clear-search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button></Tip>
            )}
          </label>

          {/* Only the shapes they actually have. A filter for a format nobody
              used is a control that can only ever return nothing. */}
          {shapes.length > 1 && shapes.map((r) => (
            <Tip key={r} label={ratio === r ? `Stop filtering by ${r}` : `Show only ${r} projects`}><button
              type="button"
              onClick={() => setRatio(ratio === r ? null : r)}
              aria-pressed={ratio === r}
              data-testid={`filter-${r}`}
              className={`px-2 py-1 rounded-lg border text-[11px] font-mono transition-colors
                ${ratio === r ? 'border-primary text-white bg-primary/15' : 'border-border text-foreground-muted hover:text-foreground-secondary'}`}
            >
              {r}
            </button></Tip>
          ))}

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort projects"
            data-testid="project-sort"
            className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-[11px] text-foreground-secondary outline-none focus:border-primary"
          >
            {Object.entries(SORTS).map(([id, { label }]) => (
              <option key={id} value={id} className="bg-background">{label}</option>
            ))}
          </select>
        </div>
      )}

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
        <Tip label="Start a new project with an empty timeline" fill><button
          type="button"
          onClick={onNew}
          data-testid="new-project"
          // h-full, NOT the poster's aspect ratio: a project card is a poster
          // PLUS a caption, so matching only the poster leaves this one short
          // and the row visibly ragged. Grid items stretch — let them.
          className="group w-full h-full min-h-[13rem] flex flex-col items-center justify-center gap-2 rounded-xl
            border border-dashed border-border hover:border-primary hover:bg-primary/5
            transition-colors"
        >
          <span className="rounded-full bg-primary p-2.5 text-white group-hover:scale-105 transition-transform">
            <Plus className="w-4 h-4" />
          </span>
          <span className="text-sm text-white">New project</span>
          <span className="text-[11px] text-foreground-muted">An empty timeline</span>
        </button></Tip>

        {shown.map((p) => (
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

      {/* NO MATCHES is not NO PROJECTS. Saying the wrong one sends somebody
          looking for work that is sitting right there behind a filter. */}
      {!error && projects.length > 0 && shown.length === 0 && (
        <p className="mt-6 text-xs text-foreground-muted" data-testid="no-matches">
          Nothing matches that. <Tip label="Show every project again"><button
            type="button"
            onClick={() => { setQuery(''); setRatio(null); }}
            className="underline"
          >Clear the filters</button></Tip> to see all {projects.length}.
        </p>
      )}

      {/* The list is not everything, and it says so rather than implying it.
          Filtering a truncated set makes "not found" mean two different
          things, and only one of them is true. */}
      {capped && (
        <p className="mt-6 text-[11px] text-foreground-muted" data-testid="capped-notice">
          Showing your {projects.length} most recent projects. Older ones are not in this list yet.
        </p>
      )}

      {narrowed && shown.length > 0 && (
        <p className="mt-6 text-[11px] text-foreground-muted font-mono">
          {shown.length} of {projects.length}
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
      <Tip label="Open this project" fill><button
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
      </button></Tip>

      {/* Held out of the button so a rename or a delete cannot open the project
          on the way past. */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {onRename && (
          <Tip label="Rename this project"><button
            type="button"
            onClick={() => { setDraft(p.name); setEditing(true); }}
            aria-label={`Rename ${p.name}`}
            data-testid={`rename-btn-${p.id}`}
            className="rounded-md bg-black/70 p-1.5 text-foreground-secondary hover:text-white backdrop-blur"
          >
            <Pencil className="w-3 h-3" />
          </button></Tip>
        )}
        {onDelete && (
          <Tip label="Delete this project"><button
            type="button"
            onClick={() => onDelete(p)}
            aria-label={`Delete ${p.name}`}
            data-testid={`delete-${p.id}`}
            className="rounded-md bg-black/70 p-1.5 text-foreground-secondary hover:text-primary backdrop-blur"
          >
            <Trash2 className="w-3 h-3" />
          </button></Tip>
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
