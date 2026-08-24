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

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Scissors, Lock, Unlock, Eye, EyeOff, Volume2, VolumeX, Magnet,
  MousePointer2, MoveHorizontal, Slice, Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react';

import {
  clipDuration, projectDuration, moveClip, trimClip, splitClip, locateClip, trackGaps, closeGap, setTrackFlag, whyKeepTrack,
  renameTrack, moveTrack, canMoveTrack,
} from '@/lib/timeline';
import { snapTargets, snapStart, snapEdge } from '@/lib/timeline-snap';
import Tip from './Tip';

// ── ZOOM IS CONTINUOUS AND LOGARITHMIC ────────────────────────────────────
// It was seven fixed steps — 2, 5, 10, 20, 40, 80, 160 pixels per second — so
// every notch nearly doubled or tripled the scale and the view JUMPED between
// wildly different framings. The owner's words, dragging it: "it's moving, it's
// not smooth... I need it to become smooth, like when I'm moving the videos."
//
// He is right, and the comparison is the point: dragging a clip is continuous,
// so the zoom feeling stepped next to it reads as the same control being worse.
//
// LOGARITHMIC, not linear. Doubling the zoom should take the same slider travel
// whether you are at 3 px/s or 100 — perception of scale is multiplicative, so
// a linear slider spends most of its length in the zoomed-in half and crushes
// every useful wide view into the first few pixels.
const MIN_PPS = 1.5;
const MAX_PPS = 240;
const DEFAULT_ZOOM = 0.38;
/** One press of the zoom key. A tenth of the whole range is a noticeable
 *  step without being a jump — the complaint that made zoom continuous. */
const ZOOM_STEP = 0.1;                     // ≈10 px/s — about a minute wide
const ppsFor = (t) => MIN_PPS * ((MAX_PPS / MIN_PPS) ** t);

const TRACK_H = 56;
const RULER_H = 28;
/** Grab zone for an edge. Smaller and it is a fight; larger and you cannot
 *  select a short clip at all, because the whole thing becomes edge. */
const EDGE_PX = 8;

/** Labels are ChatCut's, verbatim. Keys match Premiere for two of the three,
 *  so this is the convention rather than one product's habit. */
/**
 * What the + row offers. Short codes because the column is 160px wide and
 * "Captions" does not fit — the tooltip carries the full name.
 */
const ADDABLE = [
  { kind: 'video',    short: 'V',  label: 'Add a video layer' },
  { kind: 'audio',    short: 'A',  label: 'Add an audio layer (music or voice)' },
  { kind: 'text',     short: 'T',  label: 'Add a text layer' },
  { kind: 'image',    short: 'IMG', label: 'Add an image layer' },
  { kind: 'captions', short: 'CC', label: 'Add a captions layer' },
];

const TOOLS = [
  { id: 'select', label: 'Selection Mode (V)', icon: MousePointer2 },
  { id: 'trim', label: 'Trim Edit Mode (N)', icon: MoveHorizontal },
  { id: 'blade', label: 'Blade Edit Mode (B)', icon: Slice },
];

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
  // Snapping is OWNED BY THE PAGE, not by this component. It has to be: the S
  // key lives in the editor's keyboard hook, and a toggle the keyboard cannot
  // reach is a button that works and a shortcut that silently does nothing.
  snapping = true,
  onSnappingChange,
  // ── TOOL MODES ─────────────────────────────────────────────────────────
  // Owned by the page for the same reason snapping is: V/N/B live in the
  // keyboard hook, and a toolbar the keyboard cannot reach is two controls
  // that disagree.
  tool = 'select',
  onToolChange,
  /** Imperative handle so the keyboard can drive zoom. */
  controls,
  // ── TRACK MANAGEMENT ───────────────────────────────────────────────────
  // Handed in rather than done here, because every mutation in this editor
  // goes through the page so it lands in ONE undo step.
  onRemoveTrack,
  onAddTrack,
}) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const pps = ppsFor(zoom);
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

  // ── SNAPPING ─────────────────────────────────────────────────────────────
  // On by default because an editor without it produces gaps too small to see;
  // toggleable because one that ALWAYS snaps makes a deliberate two-frame
  // offset impossible. S toggles it, matching every NLE.
  // Where the snap landed, purely so a line can be drawn there. Without the
  // line, a clip jumping the last few pixels reads as the drag being imprecise
  // rather than as the editor helping.
  const [snapAt, setSnapAt] = useState(null);

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

    // ── BLADE ────────────────────────────────────────────────────────────
    // Cut where you CLICKED, not at the playhead. That is the whole reason a
    // blade tool exists next to a split key: the playhead is where you were
    // looking, the pointer is where you want the cut.
    if (tool === 'blade') {
      onChange(splitClip(project, clip.id, xToTime(e.clientX)), {});
      onSelect?.(clip.id);
      return;
    }

    // ── TRIM ─────────────────────────────────────────────────────────────
    // The whole clip becomes an edge: the half you grabbed is the edge you
    // move. Without this, trimming means hitting an 8px target, which is a
    // fight on a short clip and impossible on a phone.
    if (tool === 'trim' && mode === 'move') {
      const box = e.currentTarget.getBoundingClientRect();
      mode = (e.clientX - box.left) < box.width / 2 ? 'trimStart' : 'trimEnd';
    }
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

    // Targets are recomputed per move rather than cached on drag start. It
    // looks wasteful and is not: the set is tiny, and caching it means a clip
    // added or split mid-gesture is invisible to snapping until you let go.
    const targets = snapTargets(project, { excludeId: drag.id, playhead });

    if (drag.mode === 'move') {
      const want = drag.originStart + delta;
      const snap = snapStart(want, clipDuration(found.clip), targets, pps, { enabled: snapping });
      setSnapAt(snap.snappedTo);
      onChange(moveClip(project, drag.id, snap.start), { coalesce });
      return;
    }
    // trimClip takes a DELTA from where the edge is now, so the drag origin is
    // re-applied each time rather than accumulated — otherwise a slow drag
    // travels further than the pointer.
    const current = found.clip;
    let target = drag.mode === 'trimStart' ? drag.originIn + delta : drag.originOut + delta;

    // Trimming snaps on the TIMELINE position of the edge, not on the source
    // offset — those differ by the clip's start, and snapping the wrong one
    // makes the edge stick to numbers that mean nothing on screen.
    const edgeOnTimeline = drag.mode === 'trimStart'
      ? current.start + (target - current.in)
      : current.start + (target - current.in);
    const snap = snapEdge(edgeOnTimeline, targets, pps, { enabled: snapping });
    setSnapAt(snap.snappedTo);
    if (snap.snappedTo !== null) target += snap.time - edgeOnTimeline;

    const step = drag.mode === 'trimStart' ? target - current.in : target - current.out;
    onChange(trimClip(project, drag.id, drag.mode === 'trimStart' ? 'start' : 'end', step), { coalesce });
  };

  const endDrag = () => { dragRef.current = null; setSnapAt(null); };

  /**
   * Zoom KEEPING THE PLAYHEAD WHERE IT IS.
   *
   * Zooming around x=0 is the other half of "not smooth": the moment you zoom
   * in, whatever you were looking at flies off to the right and you have to
   * chase it with the scrollbar. Anchoring on the playhead means the frame you
   * are working on stays under the cursor and only the scale changes.
   */
  const zoomTo = (next) => {
    const lane = laneRef.current;
    const anchorPx = playhead * pps - (lane?.scrollLeft || 0);
    setZoom(next);
    if (!lane) return;
    // After React paints at the new scale, put the playhead back where it was.
    requestAnimationFrame(() => {
      lane.scrollLeft = Math.max(0, playhead * ppsFor(next) - anchorPx);
    });
  };

  /**
   * ── ZOOM FROM THE KEYBOARD ─────────────────────────────────────────────
   * Exposed to the page through a ref rather than by lifting `zoom` into it.
   * Snapping and the tool ARE lifted, because the page renders controls for
   * them; zoom is different — nothing outside this component needs to know
   * the number, only to nudge it. Lifting it would move the playhead-anchor
   * logic somewhere it does not belong.
   *
   * FIT TO VIEW is the one that earns its key. On a long project the whole
   * edit is off-screen at working zoom, and the alternative to ⇧Z is dragging
   * a scrollbar until you find your own footage.
   */
  useImperativeHandle(controls, () => ({
    zoomIn: () => zoomTo(Math.min(1, zoom + ZOOM_STEP)),
    zoomOut: () => zoomTo(Math.max(0, zoom - ZOOM_STEP)),
    zoomToFit: () => {
      const lane = laneRef.current;
      if (!lane || duration <= 0) return;
      // Solve for the zoom whose pixels-per-second makes the project exactly
      // fill the lane, with a little air so the last frame is not flush.
      const target = (lane.clientWidth * 0.94) / duration;
      const t = Math.log(target / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
      setZoom(Math.max(0, Math.min(1, t)));
      requestAnimationFrame(() => { lane.scrollLeft = 0; });
    },
  }), [zoom, duration, playhead, pps]);

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
        <Tip label="Split at playhead (C)"><button
          onClick={splitAtPlayhead}
          disabled={!selectedId}
          aria-label="Split at playhead"
          className="p-1.5 rounded hover:bg-background-elevated disabled:opacity-30"
        >
          <Scissors className="w-4 h-4" />
        </button></Tip>

        {/* The three tools. Labels lifted verbatim from ChatCut's tooltips —
            an editor who has used one should not have to learn a new word for
            the same thing. */}
        <div className="flex items-center gap-0.5 mr-1" role="group" aria-label="Tool">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <Tip key={id} label={label}><button
              type="button"
              onClick={() => onToolChange?.(id)}
              aria-label={label}
              aria-pressed={tool === id}
              data-testid={`tool-${id}`}
              className={`p-1.5 rounded hover:bg-background-elevated
                ${tool === id ? 'text-primary bg-primary/10' : 'text-foreground-muted'}`}
            >
              <Icon className="w-4 h-4" />
            </button></Tip>
          ))}
        </div>

        {/* Named "Snapping (S)" after ChatCut's own tooltip — matching the
            wording an editor already knows costs nothing and saves explaining. */}
        <Tip label={`Snapping (S) — ${snapping ? 'on' : 'off'}`}><button
          onClick={() => onSnappingChange?.(!snapping)}
          aria-label="Snapping"
          aria-pressed={snapping}
          data-testid="snap-toggle"
          className={`p-1.5 rounded hover:bg-background-elevated ${snapping ? 'text-primary' : 'text-foreground-muted'}`}
        >
          <Magnet className="w-4 h-4" />
        </button></Tip>

        <span className="ml-auto font-mono text-xs text-foreground-muted tabular-nums">
          {fmtTime(playhead)} / {fmtTime(duration)}
        </span>

        <input
          type="range" min={0} max={1} step={0.001} value={zoom}
          aria-label="Zoom"
          onChange={(e) => zoomTo(Number(e.target.value))}
          className="w-28 accent-primary"
        />
      </div>

      <div className="flex" style={{ cursor: tool === 'blade' ? 'crosshair' : tool === 'trim' ? 'ew-resize' : 'default' }}>
        {/* ── track headers, fixed while the lanes scroll ───────────── */}
        <div className="shrink-0 w-40 border-r border-border">
          <div style={{ height: RULER_H }} className="border-b border-border" />
          {project.tracks.map((track) => (
            <TrackHeader
              key={track.id}
              project={project}
              track={track}
              onChange={onChange}
              onRemoveTrack={onRemoveTrack}
            />
          ))}
          {/* ── ADD A LAYER ────────────────────────────────────────────────
              ChatCut has NO button for this — their tracks appear when media
              is dropped, and their toolbar + is "Create new timeline", which
              is a different thing entirely.
              Ours needs one anyway: our tracks are not created implicitly, so
              without this a customer is stuck with Video 1 and Audio 1 for the
              life of the project. The owner found that by looking for it. */}
          {onAddTrack && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
              <span className="text-[10px] uppercase tracking-wider text-foreground-muted mr-auto">Add</span>
              {ADDABLE.map(({ kind, label, short }) => (
                <Tip key={kind} label={label}>
                  <button
                    type="button"
                    onClick={() => onAddTrack(kind)}
                    aria-label={label}
                    data-testid={`add-track-${kind}`}
                    className="px-1 py-0.5 rounded text-[10px] font-mono text-foreground-muted
                               hover:text-white hover:bg-background-elevated"
                  >
                    {short}
                  </button>
                </Tip>
              ))}
              <Plus className="w-3 h-3 text-foreground-muted" aria-hidden="true" />
            </div>
          )}
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
                {/* ── GAPS ────────────────────────────────────────────
                    Black silence made visible. The owner dragged a clip right,
                    saw the total grow to 1:24, and asked whether that was a
                    mistake — it was not, but forty-eight seconds of the middle
                    were nothing and the screen said so nowhere.

                    Drawn BEHIND the clips and hatched, so it reads as absence
                    rather than as another block of content. */}
                {!track.locked && trackGaps(track).map((gap) => (
                  <button
                    key={`gap-${gap.start}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onChange(closeGap(project, track.id, gap.start), {})}
                    title={`${fmtGap(gap.duration)} of nothing — click to close it`}
                    aria-label={`Close ${fmtGap(gap.duration)} gap`}
                    style={{
                      left: gap.start * pps,
                      width: Math.max(2, gap.duration * pps),
                      backgroundImage:
                        'repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 5px, transparent 5px 10px)',
                    }}
                    className="absolute top-1 bottom-1 rounded border border-dashed border-white/25
                               hover:border-primary hover:bg-primary/10 cursor-pointer group"
                  >
                    <span className="pointer-events-none block truncate px-1 text-[10px]
                                     text-white/45 group-hover:text-primary">
                      {gap.duration * pps > 46 ? fmtGap(gap.duration) : ''}
                    </span>
                  </button>
                ))}

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

            {/* ── THE SNAP LINE ────────────────────────────────────────
                Shown only DURING a snap, and it is not decoration. Without
                it, a clip covering the last few pixels on its own reads as
                the drag being imprecise. With it, the same movement reads as
                the editor catching the edge for you — same behaviour, opposite
                impression. */}
            {snapAt !== null && (
              <div
                style={{ left: snapAt * pps }}
                className="absolute top-0 bottom-0 w-px bg-amber-400 pointer-events-none z-20"
                data-testid="snap-line"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One track's controls: its name, where it sits in the stack, and what it does.
 *
 * ── TWO ROWS, NOT ONE ──────────────────────────────────────────────────────
 * Six controls and an editable name do not fit across 160px — the name was
 * being squeezed to about four characters, which defeats the point of being
 * able to name it. The track is 56px tall, so the second row was already there
 * and unused.
 *
 * ── THE NAME IS A BUTTON, AND SAYS SO ON HOVER ─────────────────────────────
 * Double-click-to-rename is the convention in every editor, and it is also
 * completely invisible. The tooltip is what makes it findable — the owner
 * asked for renaming after looking straight at "Video 1" and seeing nothing
 * that suggested it could change.
 */
function TrackHeader({ project, track, onChange, onRemoveTrack }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name);
  const input = useRef(null);

  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty name is a mistake, not an instruction — put the old one back
    // rather than leaving a track with no label.
    if (!next || next === track.name) { setDraft(track.name); return; }
    onChange?.(renameTrack(project, track.id, next), {});
  };

  const move = (delta) => onChange?.(moveTrack(project, track.id, delta), {});
  const why = onRemoveTrack ? whyKeepTrack(project, track.id) : null;

  return (
    <div
      style={{ height: TRACK_H }}
      className="flex flex-col justify-center gap-1 px-2 border-b border-border text-xs"
      data-testid={`track-header-${track.id}`}
    >
      {/* Row 1 — where it sits, and what it is called */}
      <div className="flex items-center gap-0.5">
        <Tip label="Move layer up"><button
          type="button"
          onClick={() => move(-1)}
          disabled={!canMoveTrack(project, track.id, -1)}
          aria-label={`Move ${track.name} up`}
          data-testid={`up-${track.id}`}
          className="p-0.5 rounded text-foreground-muted hover:text-white hover:bg-background-elevated disabled:opacity-25"
        ><ChevronUp className="w-3 h-3" /></button></Tip>
        <Tip label="Move layer down"><button
          type="button"
          onClick={() => move(1)}
          disabled={!canMoveTrack(project, track.id, 1)}
          aria-label={`Move ${track.name} down`}
          data-testid={`down-${track.id}`}
          className="p-0.5 rounded text-foreground-muted hover:text-white hover:bg-background-elevated disabled:opacity-25"
        ><ChevronDown className="w-3 h-3" /></button></Tip>

        {editing ? (
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();   // C, V, B and Delete are editor shortcuts
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setDraft(track.name); setEditing(false); }
            }}
            aria-label={`Rename ${track.name}`}
            data-testid={`rename-${track.id}`}
            className="flex-1 min-w-0 bg-transparent border-b border-primary text-white outline-none px-0.5"
          />
        ) : (
          <Tip label="Double-click to rename"><button
            type="button"
            onDoubleClick={() => { setDraft(track.name); setEditing(true); }}
            aria-label={`Rename ${track.name}`}
            data-testid={`name-${track.id}`}
            className="flex-1 min-w-0 truncate text-left text-foreground-secondary hover:text-white px-0.5"
          >{track.name}</button></Tip>
        )}
      </div>

      {/* Row 2 — what it does */}
      <div className="flex items-center gap-1">
        {/* Wording lifted from ChatCut: "Hide track", not "visibility".
            A label should say what the CLICK does, not name a property. */}
        <TrackToggle on={!track.hidden} On={Eye} Off={EyeOff}
          label={`${track.name} visibility`} tip={['Hide track', 'Show track']}
          disabled={track.locked}
          onToggle={(visible) => onChange?.(setTrackFlag(project, track.id, 'hidden', !visible), {})} />
        <TrackToggle on={!track.muted} On={Volume2} Off={VolumeX}
          label={`${track.name} sound`} tip={['Mute track', 'Unmute track']}
          disabled={track.locked}
          onToggle={(audible) => onChange?.(setTrackFlag(project, track.id, 'muted', !audible), {})} />
        <TrackToggle on={!track.locked} On={Unlock} Off={Lock}
          label={`${track.name} lock`} tip={['Lock track', 'Unlock track']}
          onToggle={(unlocked) => onChange?.(setTrackFlag(project, track.id, 'locked', !unlocked), {})} />

        {/* DELETE TRACK — ChatCut's third track-header control, and the one we
            were missing entirely. Disabled rather than hidden when it cannot
            go, with the reason on hover: a control that vanishes teaches
            nothing about why. */}
        {onRemoveTrack && (
          <Tip label={why || 'Delete track'}><button
            type="button"
            onClick={() => onRemoveTrack(track)}
            disabled={Boolean(why)}
            aria-label={`Delete ${track.name}`}
            data-testid={`delete-track-${track.id}`}
            className="p-0.5 rounded text-foreground-muted hover:text-primary hover:bg-background-elevated
                       disabled:opacity-25 disabled:hover:text-foreground-muted"
          ><Trash2 className="w-3 h-3" /></button></Tip>
        )}

        <span className="ml-auto font-mono text-[9px] uppercase text-foreground-muted/60">{track.kind}</span>
      </div>
    </div>
  );
}

/**
 * CONTROLLED. It used to hold `useState(on)` and tell nobody — the icon
 * flipped and the project never changed, so hidden tracks exported, muted
 * tracks were mixed in, and a locked track could not actually be locked.
 * The state lives in the project now; this only draws it and reports clicks.
 */
function TrackToggle({ on, On, Off, label, tip = [], onToggle, disabled = false }) {
  const Icon = on ? On : Off;
  return (
    <Tip label={on ? tip[0] : tip[1]}>
      <button
        type="button"
        onClick={() => onToggle?.(!on)}
        disabled={disabled}
        aria-label={label}
        aria-pressed={!on}
        className="p-0.5 rounded hover:bg-background-elevated text-foreground-muted disabled:opacity-30"
      >
        <Icon className="w-3 h-3" />
      </button>
    </Tip>
  );
}

/** Gaps read better in plain seconds until they are long enough to be minutes. */
function fmtGap(seconds) {
  return seconds < 60 ? `${Math.round(seconds)}s gap` : `${fmtTime(seconds)} gap`;
}

/** m:ss for anything under an hour — the format an editor actually reads. */
export function fmtTime(seconds) {
  const s = Math.max(0, seconds || 0);
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  return `${m}:${String(rest).padStart(2, '0')}`;
}
