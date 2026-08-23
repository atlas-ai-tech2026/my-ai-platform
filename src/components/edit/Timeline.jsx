// ─── Timeline.jsx ────────────────────────────────────────────────────────────
// The timeline: tracks, clips, a playhead, and direct manipulation.
//
// ── WHAT THIS COMPONENT IS NOT ALLOWED TO DO ───────────────────────────────
// It never mutates the project. Every gesture calls back with the NEXT document
// produced by timeline.js, plus a gesture key so the history can coalesce a
// drag into one undo step. This component holds exactly two pieces of state of
// its own — what is being dragged, and how zoomed in we are — and both are
// forgotten on unmount because neither belongs in the document.
//
// That division is why undo works at all: there is only one place a change can
// come from, and it is the same place the agent will use in Stage 3.
//
// ── WHY PIXELS-PER-SECOND AND NOT A PERCENTAGE ─────────────────────────────
// A percentage-width timeline rescales every clip when the project gets longer,
// so adding a clip at the end makes everything already placed appear to shrink.
// Editors do not do that: a second is a fixed distance, and the timeline scrolls.
// Zoom changes the distance deliberately; nothing else does.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Scissors, Lock, Unlock, Eye, EyeOff, Volume2, VolumeX } from 'lucide-react';

import {
  clipDuration, projectDuration, moveClip, trimClip, splitClip, locateClip,
} from '@/lib/timeline';

/** Zoom levels in pixels per second. The default shows about a minute. */
const ZOOMS = [2, 5, 10, 20, 40, 80, 160];
const DEFAULT_ZOOM = 2;

const TRACK_H = 56;
const RULER_H = 28;
/** Grab zone for an edge. Smaller and it is a fight; larger and you cannot
 *  select a short clip at all, because the whole thing becomes edge. */
const EDGE_PX = 8;

const KIND_COLOUR = {
  video: 'var(--crm-blue, #3b82f6)',
  audio: 'var(--crm-green, #22c55e)',
  image: '#a855f7',
  text: '#f59e0b',
  captions: '#14b8a6',
};

export default function Timeline({
  project,
  onChange,                 // (nextProject, { coalesce }) => void
  selectedId = null,
  onSelect,
  playhead = 0,
  onScrub,
}) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM);
  const pps = ZOOMS[zoomIndex];
  // ── DRAG STATE IS A REF, NOT useState ───────────────────────────────────
  // React 18 batches updates. On a fast drag, pointerdown/pointermove/pointerup
  // can land in one task — so the setDrag() from pointerdown has not committed
  // when the pointermove handler runs, the handler reads `null`, and returns
  // early. The clip does not move at all.
  //
  // It only fails on QUICK gestures, which is the worst possible shape for a
  // bug: slow careful drags work, so it reads as "the editor is flaky" rather
  // than as anything reproducible. Found by dragging it in a real browser —
  // selection worked, movement did not, and the difference was the batch.
  //
  // A ref updates synchronously. Nothing renders from this value, so there is
  // no reason for it to be state.
  const dragRef = useRef(null);
  const laneRef = useRef(null);

  const duration = projectDuration(project);
  // Always show more room than the content needs. A timeline that ends exactly
  // at the last clip gives you nowhere to drag anything TO.
  const width = Math.max(600, (duration + 10) * pps);

  const xToTime = useCallback((clientX) => {
    const box = laneRef.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.max(0, (clientX - box.left + (laneRef.current.scrollLeft || 0)) / pps);
  }, [pps]);

  // ── DRAG ────────────────────────────────────────────────────────────────
  // Pointer events, not mouse events: they cover touch and pen with the same
  // code, and setPointerCapture means the drag keeps working when the cursor
  // leaves the clip — which it always does, because you are moving it.
  const startDrag = (e, clip, mode) => {
    e.stopPropagation();
    // ORDER MATTERS. The drag is armed FIRST, capture second.
    //
    // setPointerCapture throws for a pointerId the browser does not consider
    // active. Called before the ref was set, that exception aborted startDrag
    // and the gesture was dead — pointerdown selected the clip, so it LOOKED
    // like it had worked, and then nothing moved.
    //
    // Capture only keeps events flowing when the cursor leaves the element. It
    // is an optimisation. It must never be able to stop a drag from starting.
    dragRef.current = { id: clip.id, mode, originTime: xToTime(e.clientX),
      originStart: clip.start, originIn: clip.in, originOut: clip.out };
    onSelect?.(clip.id);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* optional */ }
  };

  const onDragMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = xToTime(e.clientX) - drag.originTime;
    const found = locateClip(project, drag.id);
    if (!found) return;

    // The gesture key is what turns a hundred pointermove events into ONE undo
    // step. It has to be stable for the whole drag and different per clip and
    // per edge, or two separate gestures would merge into one.
    const coalesce = `${drag.mode}:${drag.id}`;

    if (drag.mode === 'move') {
      onChange(moveClip(project, drag.id, drag.originStart + delta), { coalesce });
      return;
    }
    // trimClip takes a DELTA from where the edge is now, so the drag origin is
    // re-applied each time rather than accumulated — otherwise a slow drag
    // travels further than the pointer.
    const current = found.clip;
    const target = drag.mode === 'trimStart' ? drag.originIn + delta : drag.originOut + delta;
    const step = drag.mode === 'trimStart' ? target - current.in : target - current.out;
    onChange(trimClip(project, drag.id, drag.mode === 'trimStart' ? 'start' : 'end', step), { coalesce });
  };

  const endDrag = () => { dragRef.current = null; };

  const splitAtPlayhead = () => {
    if (!selectedId) return;
    onChange(splitClip(project, selectedId, playhead), {});
  };

  const ticks = useMemo(() => {
    // A tick every 1/2/5/10/30/60s depending on zoom, so labels never collide.
    const target = 80;                       // px between labels, roughly
    const options = [1, 2, 5, 10, 15, 30, 60, 120, 300];
    const stepSeconds = options.find((s) => s * pps >= target) || 600;
    const out = [];
    for (let t = 0; t <= duration + 10; t += stepSeconds) out.push(t);
    return { stepSeconds, out };
  }, [pps, duration]);

  return (
    <div className="select-none" data-testid="timeline">
      {/* ── toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          onClick={splitAtPlayhead}
          disabled={!selectedId}
          title="Split at playhead (C)"
          aria-label="Split at playhead"
          className="p-1.5 rounded hover:bg-background-elevated disabled:opacity-30"
        >
          <Scissors className="w-4 h-4" />
        </button>

        <span className="ml-auto font-mono text-xs text-foreground-muted tabular-nums">
          {fmtTime(playhead)} / {fmtTime(duration)}
        </span>

        <input
          type="range" min={0} max={ZOOMS.length - 1} value={zoomIndex}
          aria-label="Zoom"
          onChange={(e) => setZoomIndex(Number(e.target.value))}
          className="w-24 accent-primary"
        />
      </div>

      <div className="flex">
        {/* ── track headers, fixed while the lanes scroll ───────────── */}
        <div className="shrink-0 w-40 border-r border-border">
          <div style={{ height: RULER_H }} className="border-b border-border" />
          {project.tracks.map((track) => (
            <div
              key={track.id}
              style={{ height: TRACK_H }}
              className="flex items-center gap-1.5 px-2 border-b border-border text-xs"
            >
              <span className="flex-1 truncate text-foreground-secondary">{track.name}</span>
              <TrackToggle on={!track.hidden} On={Eye} Off={EyeOff} label={`${track.name} visibility`} />
              <TrackToggle on={!track.muted} On={Volume2} Off={VolumeX} label={`${track.name} sound`} />
              <TrackToggle on={!track.locked} On={Unlock} Off={Lock} label={`${track.name} lock`} />
            </div>
          ))}
        </div>

        {/* ── lanes ─────────────────────────────────────────────────── */}
        <div
          ref={laneRef}
          className="flex-1 overflow-x-auto relative"
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div style={{ width }} className="relative">
            {/* ruler — clicking it scrubs */}
            <div
              style={{ height: RULER_H }}
              className="relative border-b border-border cursor-pointer"
              onPointerDown={(e) => onScrub?.(xToTime(e.clientX))}
              role="slider"
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, duration)}
              aria-valuenow={playhead}
              tabIndex={0}
            >
              {ticks.out.map((t) => (
                <span
                  key={t}
                  style={{ left: t * pps }}
                  className="absolute top-0 h-full border-l border-border pl-1 font-mono text-[10px] text-foreground-muted"
                >
                  {fmtTime(t)}
                </span>
              ))}
            </div>

            {project.tracks.map((track) => (
              <div
                key={track.id}
                style={{ height: TRACK_H }}
                className={`relative border-b border-border ${track.locked ? 'opacity-60' : ''}`}
                onPointerDown={() => onSelect?.(null)}
              >
                {track.clips.map((clip) => {
                  const selected = clip.id === selectedId;
                  return (
                    <div
                      key={clip.id}
                      data-clip={clip.id}
                      onPointerDown={(e) => !track.locked && startDrag(e, clip, 'move')}
                      style={{
                        left: clip.start * pps,
                        width: Math.max(2, clipDuration(clip) * pps),
                        background: KIND_COLOUR[clip.kind] || '#666',
                      }}
                      className={`absolute top-1 bottom-1 rounded overflow-hidden
                                  ${track.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
                                  ${selected ? 'ring-2 ring-white' : 'ring-1 ring-black/30'}`}
                      title={clip.name || clip.sourceId}
                    >
                      <span className="block px-1.5 pt-1 text-[10px] text-white/90 truncate pointer-events-none">
                        {clip.name || clip.sourceId}
                      </span>

                      {/* Edge handles. Rendered only when unlocked so a locked
                          track cannot be trimmed by accident. */}
                      {!track.locked && (
                        <>
                          <span
                            onPointerDown={(e) => startDrag(e, clip, 'trimStart')}
                            style={{ width: EDGE_PX }}
                            className="absolute inset-y-0 left-0 cursor-ew-resize bg-white/25 hover:bg-white/50"
                            aria-label="Trim start"
                          />
                          <span
                            onPointerDown={(e) => startDrag(e, clip, 'trimEnd')}
                            style={{ width: EDGE_PX }}
                            className="absolute inset-y-0 right-0 cursor-ew-resize bg-white/25 hover:bg-white/50"
                            aria-label="Trim end"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* playhead, drawn over everything and ignoring the pointer so it
                never blocks a click on the clip underneath */}
            <div
              style={{ left: playhead * pps }}
              className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none z-10"
              data-testid="playhead"
            >
              <span className="absolute -top-0.5 -left-1 w-2 h-2 rotate-45 bg-primary" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackToggle({ on, On, Off, label }) {
  const [state, setState] = useState(on);
  const Icon = state ? On : Off;
  return (
    <button
      onClick={() => setState((v) => !v)}
      aria-label={label}
      aria-pressed={!state}
      className="p-0.5 rounded hover:bg-background-elevated text-foreground-muted"
    >
      <Icon className="w-3 h-3" />
    </button>
  );
}

/** m:ss for anything under an hour — the format an editor actually reads. */
export function fmtTime(seconds) {
  const s = Math.max(0, seconds || 0);
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  return `${m}:${String(rest).padStart(2, '0')}`;
}
