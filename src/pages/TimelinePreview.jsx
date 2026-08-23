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

import React, { useRef, useState } from 'react';

import Timeline from '@/components/edit/Timeline';
import Viewer from '@/components/edit/Viewer';
import {
  createProject, createClip, addClip, addTrack, addSource, __resetIds,
  splitClip, removeClip, projectDuration,
} from '@/lib/timeline';
import { createHistory, commit, undo, redo, canUndo, canRedo } from '@/lib/timeline-history';
import { useEditorShortcuts, SHORTCUTS } from '@/lib/useEditorShortcuts';
import { useAutosave, loadProject, setAside, clearProject } from '@/lib/editor-autosave';

function demoProject() {
  __resetIds();
  let p = createProject({ name: 'Demo' });
  const v1 = p.tracks[0].id;
  const a1 = p.tracks[1].id;
  p = addTrack(p, 'text');
  const t1 = p.tracks[2].id;

  // Real files the site already serves, so the viewer shows actual video
  // rather than a placeholder. The `prompt` and `model` are what a generated
  // clip carries in production — the thing no upload-based editor has.
  p = addSource(p, { id: 'racing', url: '/media/seedance-2-hero.mp4', kind: 'video',
    prompt: 'a yellow race car on a circuit at golden hour, low angle', model: 'Seedance 2.5' });
  p = addSource(p, { id: 'castle', url: '/media/explore-hero.mp4', kind: 'video',
    prompt: 'a dragon over a castle at dusk, wide establishing shot', model: 'Kling 3.0' });
  p = addSource(p, { id: 'kling', url: '/media/kling-3-card.mp4', kind: 'video',
    prompt: 'cinematic product reveal, slow push in', model: 'Kling 3.0' });

  p = addClip(p, v1, createClip({ kind: 'video', sourceId: 'racing', name: 'racing car', start: 0, in: 0, out: 12 }));
  p = addClip(p, v1, createClip({ kind: 'video', sourceId: 'castle', name: 'castle', start: 14, in: 2, out: 20 }));
  p = addClip(p, a1, createClip({ kind: 'audio', sourceId: 'kling', name: 'music bed', start: 0, in: 0, out: 30 }));
  p = addClip(p, t1, createClip({ kind: 'text', sourceId: 'title', name: 'Title card', start: 1, in: 0, out: 4 }));
  return p;
}

/**
 * What to open with. Runs once, before anything can write.
 *
 * The order matters: an unreadable save is moved ASIDE here, in the same
 * breath as deciding to start fresh. Leave it in place and the new project's
 * first autosave — 800ms later — writes over the only copy of the damaged one.
 */
function boot() {
  const out = loadProject();
  if (out.ok) {
    return { project: out.project, savedAt: out.savedAt, notice: null };
  }
  if (out.reason === 'corrupt' || out.reason === 'future-schema') {
    const where = setAside(out.raw);
    return {
      project: demoProject(),
      savedAt: null,
      notice: where ? `${out.message} (kept at ${where})` : out.message,
    };
  }
  // 'empty' or 'no-storage' — nothing to restore. A no-storage browser is
  // reported by the autosave status below, not here.
  return { project: demoProject(), savedAt: null, notice: null };
}

const clockOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function TimelinePreview() {
  const opened = useRef(null);
  if (opened.current === null) opened.current = boot();

  const [history, setHistory] = useState(() => createHistory(opened.current.project));
  const [notice, setNotice] = useState(opened.current.notice);
  const [restored, setRestored] = useState(Boolean(opened.current.savedAt));
  const [selected, setSelected] = useState(null);
  const [playhead, setPlayhead] = useState(6);
  const [playing, setPlaying] = useState(false);

  const project = history.present;
  const save = useAutosave(project);
  const change = (next, opts) => setHistory((h) => commit(h, next, opts));
  const duration = projectDuration(project);
  const seek = (t) => setPlayhead(Math.min(duration, Math.max(0, t)));

  useEditorShortcuts({
    onTogglePlay: () => setPlaying((p) => !p),
    onSplit: () => selected && change(splitClip(project, selected, playhead), {}),
    onDelete: () => { if (selected) { change(removeClip(project, selected), {}); setSelected(null); } },
    onStep: (delta) => seek(playhead + delta),
    onGoTo: (where) => seek(where === 'start' ? 0 : duration),
    onUndo: () => setHistory(undo),
    onRedo: () => setHistory(redo),
    // Shuttle drives the same play flag for now; variable RATE arrives with
    // the export work, when playback stops being a requestAnimationFrame loop.
    onShuttle: (rate) => setPlaying(rate !== 0),
  });

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

          {/* ── THE SAVE STATUS ──────────────────────────────────────────
              Not decoration. A browser that blocks storage, or one whose
              quota is full, silently saves NOTHING — and the only way
              anybody finds out is here, in time to export instead. */}
          <span
            data-testid="save-status"
            className={`self-center ml-auto text-xs ${save.status === 'error' ? 'text-primary' : 'text-foreground-muted'}`}
          >
            {save.status === 'error' && `⚠ ${save.error}`}
            {save.status === 'saving' && 'Saving…'}
            {save.status === 'saved' && `Saved ${clockOf(save.at)}`}
            {save.status === 'idle' && 'Not saved yet'}
          </span>
        </div>

        {/* An unreadable or newer-than-us save. Said out loud, with where it
            went, because the alternative is a project silently replaced by an
            empty one. */}
        {notice && (
          <div className="mb-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-foreground-secondary">
            {notice}
            <button onClick={() => setNotice(null)} className="ml-3 underline">Dismiss</button>
          </div>
        )}

        {restored && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-xs text-foreground-secondary">
            <span>Restored the project you left open.</span>
            <button
              onClick={() => {
                clearProject();
                setHistory(createHistory(demoProject()));
                setSelected(null);
                setRestored(false);
              }}
              className="underline"
            >
              Start fresh instead
            </button>
            <button onClick={() => setRestored(false)} className="ml-auto underline">Dismiss</button>
          </div>
        )}

        <div className="max-w-3xl mb-4">
          <Viewer
            project={project}
            playhead={playhead}
            onScrub={setPlayhead}
            playing={playing}
            onPlayingChange={setPlaying}
          />
        </div>

        <div className="glass rounded-xl border border-border overflow-hidden mb-4">
          <Timeline
            project={project}
            onChange={change}
            selectedId={selected}
            onSelect={setSelected}
            playhead={playhead}
            onScrub={setPlayhead}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-foreground-muted">
          {SHORTCUTS.map(([key, what]) => (
            <span key={key}>
              <kbd className="font-mono text-foreground-secondary">{key}</kbd> {what}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
