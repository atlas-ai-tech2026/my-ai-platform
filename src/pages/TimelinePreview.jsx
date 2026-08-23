// ─── TimelinePreview.jsx ─────────────────────────────────────────────────────
// A scratch page for looking at the timeline while it is being built.
//
// TEMPORARY AND NOT ROUTED. It exists so the owner can SEE the component and
// react to it before it is wired into the real editor — their taste is the
// expensive input here, and feedback is cheapest before the viewer and export
// are attached to it.
//
// Delete this file when the real /edit workspace exists. It is not in
// pages.config.js and has no ROUTE_META entry, so nothing links to it and no
// crawler will find it.

import React, { useState } from 'react';

import Timeline from '@/components/edit/Timeline';
import { createProject, createClip, addClip, addTrack, __resetIds } from '@/lib/timeline';
import { createHistory, commit, undo, redo, canUndo, canRedo } from '@/lib/timeline-history';

function demoProject() {
  __resetIds();
  let p = createProject({ name: 'Demo' });
  const v1 = p.tracks[0].id;
  const a1 = p.tracks[1].id;
  p = addTrack(p, 'text');
  const t1 = p.tracks[2].id;

  p = addClip(p, v1, createClip({ kind: 'video', sourceId: 'racing car', name: 'racing car', start: 0, in: 0, out: 12 }));
  p = addClip(p, v1, createClip({ kind: 'video', sourceId: 'castle', name: 'castle', start: 14, in: 2, out: 20 }));
  p = addClip(p, a1, createClip({ kind: 'audio', sourceId: 'music', name: 'music bed', start: 0, in: 0, out: 30 }));
  p = addClip(p, t1, createClip({ kind: 'text', sourceId: 'title', name: 'Title card', start: 1, in: 0, out: 4 }));
  return p;
}

export default function TimelinePreview() {
  const [history, setHistory] = useState(() => createHistory(demoProject()));
  const [selected, setSelected] = useState(null);
  const [playhead, setPlayhead] = useState(6);

  const project = history.present;
  const change = (next, opts) => setHistory((h) => commit(h, next, opts));

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-[1200px] mx-auto">
        <h1 className="font-heading text-2xl tracking-wider text-white mb-1">VOXEL EDIT CUT</h1>
        <p className="text-sm text-foreground-secondary mb-4">
          Timeline — first look. Drag a clip, drag its edges, click the ruler to scrub,
          select a clip and press Split.
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setHistory(undo)}
            disabled={!canUndo(history)}
            className="px-3 py-1.5 rounded border border-border text-sm disabled:opacity-30"
          >
            Undo
          </button>
          <button
            onClick={() => setHistory(redo)}
            disabled={!canRedo(history)}
            className="px-3 py-1.5 rounded border border-border text-sm disabled:opacity-30"
          >
            Redo
          </button>
          <span className="self-center text-xs text-foreground-muted font-mono">
            {history.past.length} undo · {history.future.length} redo
          </span>
        </div>

        <div className="glass rounded-xl border border-border overflow-hidden">
          <Timeline
            project={project}
            onChange={change}
            selectedId={selected}
            onSelect={setSelected}
            playhead={playhead}
            onScrub={setPlayhead}
          />
        </div>
      </div>
    </div>
  );
}
