// ─── EditCut.jsx ─────────────────────────────────────────────────────────────
// Voxel Edit Cut — the editor itself.
//
// Lived at /timelinepreview while it was being built, so the owner could react
// to it early; their taste was the expensive input and feedback was cheapest
// before the viewer and export were attached. It is a real component now and
// /edit renders it for signed-in customers.
//
// ── THE ONE THING THE `demo` FLAG DECIDES ──────────────────────────────────
// What you open with. On the scratch route that is a demo timeline with real
// video in it, because a screen with nothing on it shows nothing about
// dragging, trimming or cutting.
//
// At /edit it must NEVER be that. A customer opening the editor gets their own
// work or an empty timeline — handing somebody a project of racing cars they
// did not make, that autosaves into their account, would be worse than an
// empty screen by a long way.

import React, { useEffect, useRef, useState, useMemo} from 'react';
import { Undo2, Redo2, Download, PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2, FolderOpen } from 'lucide-react';

/**
 * The library column's tabs.
 *
 * "From Voxel" is FIRST and it is the only live one, because it is the only
 * one that matters here: the customer's own generations, already present. The
 * other two are rendered disabled rather than omitted — the room is reserved
 * now so the layout does not shift when they arrive, and so nobody has to
 * wonder whether uploads were forgotten about.
 */
const LIBRARY_TABS = [
  { id: 'voxel', label: 'From Voxel', ready: true, hint: 'Everything you generated here' },
  { id: 'uploads', label: 'Uploads', ready: true, hint: 'Music, logos and footage you bring in' },
  { id: 'transcript', label: 'Transcript', ready: false, hint: 'Edit by deleting words' },
];

/** A quiet uppercase panel header. Small and grey on purpose: a panel label
 *  should tell you where you are without competing with the work inside it. */
/**
 * The collapse animation. 220ms, matching the control-panel banner the owner
 * asked this to feel like.
 *
 * ── A CORRECTION WORTH KEEPING, BECAUSE I GOT THIS WRONG ───────────────────
 * I first shipped this with NO animation and wrote a long note explaining that
 * width transitions "do not complete here" — the inline width changed to 36px
 * while the computed width stayed at 340px, so the panel content swapped to a
 * rail and the panel stayed wide. I blamed a global `transition: all`.
 *
 * There is no such global rule, and the transition was never broken. I was
 * measuring in a HIDDEN browser tab. A hidden document does not run CSS
 * transitions at all — getAnimations() returns nothing and requestAnimationFrame
 * never fires — so the computed value sits at the start value forever. Remove
 * the transition and the change applies instantly even when hidden, which is
 * exactly what I saw and exactly why I drew the wrong conclusion.
 *
 * Confirmed by reading document.visibilityState: "hidden".
 *
 * THE RULE THIS EARNS: an automated browser check can prove a value changed.
 * It cannot prove something ANIMATED, because animation needs a visible tab.
 * Timing and motion are verified by a person watching, or not at all.
 */
const PANEL_EASE = 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)';

const PanelLabel = ({ children, action = null }) => (
  <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
    <span>{children}</span>
    {action && <span className="ml-auto">{action}</span>}
  </div>
);

import Timeline, { fmtTime } from '@/components/edit/Timeline';
import Viewer from '@/components/edit/Viewer';
import {
  createProject, createClip, addClip, addTrack, addSource, __resetIds,
  splitClip, removeClip, projectDuration, clipEnd, setProjectRatio, removeTrack,
} from '@/lib/timeline';
import MediaLibrary from '@/components/edit/MediaLibrary';
import UploadsPanel from '@/components/edit/UploadsPanel';
import VersionsMenu from '@/components/edit/VersionsMenu';
import RegeneratePanel from '@/components/edit/RegeneratePanel';
import RatioPicker from '@/components/edit/RatioPicker';
import Tip from '@/components/edit/Tip';
import { base44 } from '@/api/base44Client';
import { sourceOf, replaceClipSource, locateClip } from '@/lib/timeline';
import { toast } from 'sonner';
import { hasText } from '@/lib/text-clip';
import { measureDuration } from '@/lib/media-library';
import { trackKindFor, extensionFor, recordingStartAt, recordingName } from '@/lib/recording';

/** The generate endpoints take a bearer token directly — they are raw fetches
 *  rather than the axios client, exactly as Video.jsx does it. */
function authJsonHeaders() {
  const token = localStorage.getItem('voxel_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
import { createHistory, commit, undo, redo, canUndo, canRedo } from '@/lib/timeline-history';
import { useEditorShortcuts, SHORTCUTS } from '@/lib/useEditorShortcuts';
import { useAutosave, loadProject, setAside, clearProject } from '@/lib/editor-autosave';
import { exportPlan, estimateSeconds } from '@/lib/timeline-export';
import { usePanelLayout, useIsWide } from '@/lib/usePanelLayout';
import AgentChat from './AgentChat';
import { useServerAutosave, listProjects, fetchProject, shouldSyncToAccount, hasContent, ENTITY as PROJECT_ENTITY } from '@/lib/project-store';

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
function boot(demo) {
  const out = loadProject();
  if (out.ok) {
    return { project: out.project, savedAt: out.savedAt, notice: null };
  }
  if (out.reason === 'corrupt' || out.reason === 'future-schema') {
    const where = setAside(out.raw);
    return {
      project: demo ? demoProject() : emptyProject(),
      savedAt: null,
      notice: where ? `${out.message} (kept at ${where})` : out.message,
    };
  }
  // 'empty' or 'no-storage' — nothing to restore. A no-storage browser is
  // reported by the autosave status below, not here.
  return { project: demo ? demoProject() : emptyProject(), savedAt: null, notice: null };
}

/** A real customer's starting point: two empty tracks and nothing on them. */
function emptyProject() {
  __resetIds();
  return createProject({ name: 'Untitled project' });
}

const clockOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function EditCut({ demo = false, startWith = null, onLeave = null }) {
  const opened = useRef(null);
  if (opened.current === null) {
    // A project the page CHOSE beats anything found here. boot() only decides
    // when nobody handed us one — a new project, or the demo route.
    opened.current = startWith?.project
      ? { project: startWith.project, savedAt: null, notice: null }
      : boot(demo);
  }

  const [history, setHistory] = useState(() => createHistory(opened.current.project));
  const [notice, setNotice] = useState(opened.current.notice);
  const [restored, setRestored] = useState(Boolean(opened.current.savedAt));
  const [selected, setSelected] = useState(null);
  const [playhead, setPlayhead] = useState(6);
  const [playing, setPlaying] = useState(false);

  const [exporting, setExporting] = useState(null);   // {stage} while running
  const [result, setResult] = useState(null);         // {url, bytes, warnings}
  const [exportError, setExportError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [libraryTab, setLibraryTab] = useState('voxel');
  const [tool, setTool] = useState('select');
  const timelineControls = useRef(null);
  const versionsRef = useRef(null);
  // Owned here, not inside Timeline: the S key lives in the shortcuts hook, and
  // a toggle the keyboard cannot reach is a button that works next to a
  // shortcut that silently does nothing.
  const [snapping, setSnapping] = useState(true);
  const layout = usePanelLayout();
  const wide = useIsWide();

  const project = history.present;
  const save = useAutosave(project);

  // ── AND TO THE SERVER, ALONGSIDE ───────────────────────────────────────
  // Not instead of. Local fires at 800ms and is the crash net; this fires at
  // four seconds and is what makes the work reachable from another machine.
  // If the network is gone, local still has it.
  // Gated on being signed in. Without the gate a signed-out visitor fires a
  // doomed request every four seconds for as long as the tab is open — noise
  // in the log, load on the API, and an error message that is not their
  // problem to solve.
  const signedIn = typeof window !== 'undefined' && Boolean(localStorage.getItem('voxel_token'));
  // Which project on the server this session is editing. Empty until we have
  // asked; the autosave hook adopts it when it lands.
  const [onServer, setOnServer] = useState({ id: startWith?.id || null, at: startWith?.updatedAt || null });

  // ── FIND THE PROJECT BEFORE MAKING ONE ─────────────────────────────────
  // Without this every page load creates a new row — reload five times, get
  // five projects, and the one you were actually working on is buried under
  // four empty ones.
  //
  // The guard is `past.length === 0`: only take the server's copy if nothing
  // has been edited yet. A slow response arriving after somebody has started
  // cutting must never replace what they are doing.
  // Nothing is created until there is something to save. Opening the editor
  // must not, by itself, put a project in somebody's account.
  const syncing = shouldSyncToAccount({ signedIn, demo }) && hasContent(project);

  useEffect(() => {
    // The page already chose one. Looking for "the most recent" now would be
    // the guess this whole screen exists to remove.
    if (!syncing || startWith) return undefined;
    let cancelled = false;
    (async () => {
      const entity = base44.entities[PROJECT_ENTITY];
      const list = await listProjects(entity, { limit: 1 });
      if (cancelled || !list.ok || !list.projects.length) return;
      const got = await fetchProject(entity, list.projects[0].id);
      if (cancelled || !got.ok) return;
      setHistory((h) => (h.past.length === 0 ? createHistory(got.project) : h));
      setOnServer({ id: list.projects[0].id, at: got.updatedAt });
    })();
    return () => { cancelled = true; };
  }, [syncing, startWith]);

  const cloud = useServerAutosave(project, {
    entity: base44.entities[PROJECT_ENTITY],
    enabled: syncing,
    projectId: onServer.id,
    lastSeenAt: onServer.at,
  });

  // Recomputed as the timeline changes, so the warnings shown next to the
  // button are always about the CURRENT edit rather than the one at mount.
  // Which titles WILL be drawn, without drawing them. The real export renders
  // a PNG per text clip; doing that here — on every keystroke, to compute a
  // warning line — would be absurd. hasText is the same condition the renderer
  // uses, so the warning cannot promise something the export then omits.
  const willRenderText = useMemo(() => {
    const map = {};
    for (const t of project?.tracks || []) {
      if (t.kind !== 'text' || t.hidden) continue;
      for (const c of t.clips || []) if (hasText(c)) map[c.id] = true;
    }
    return map;
  }, [project]);

  const plan = exportPlan(project, {
    ratio: project.ratio, mode: project.resizeMode || 'crop', textImages: willRenderText,
  });

  /**
   * Put a real generation on the end of the video track.
   *
   * At the END, not at the playhead: appending is the one placement that can
   * never overwrite or displace something already cut, and a library click
   * should not be able to disturb an edit.
   *
   * `seconds` is measured by the library before it gets here, so `out` is
   * always a real length rather than a default.
   */
  function addFromLibrary({ source, seconds, kind = 'video' }) {
    // ── WHY THIS IS NOT JUST find() ANY MORE ─────────────────────────────
    // It was `project.tracks.find(t => t.kind === 'video')` followed straight
    // by `track.clips`, which throws a TypeError the moment there is no video
    // track — a dead editor from clicking a thumbnail. Unreachable before,
    // because nothing could remove a track. Reachable the second delete-track
    // shipped, which is exactly the kind of latent crash a new feature wakes up.
    //
    // Locked tracks are skipped too: addClip returns the project untouched on
    // a locked track, so the clip would silently not appear.
    // Follow the KIND. It was hardcoded to video, which was fine while the
    // only source was a generated video — an uploaded song would have landed
    // on a video track, invisible in the viewer and impossible to line up.
    let working = project;
    let track = working.tracks.find((t) => t.kind === kind && !t.locked);
    if (!track) {
      working = addTrack(working, kind);
      track = working.tracks[working.tracks.length - 1];
    }
    const end = track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);

    let next = addSource(working, source);
    next = addClip(next, track.id, createClip({
      kind,
      sourceId: source.id,
      name: (source.prompt || source.name || source.model || 'clip').slice(0, 40),
      start: end,
      in: 0,
      out: seconds,
    }));
    change(next, {});
  }

  /**
   * A finished recording becomes a clip.
   *
   * ── IT IS UPLOADED FIRST, AND THAT IS THE WHOLE POINT ────────────────────
   * A blob: URL dies with the page. This editor autosaves and reloads, so a
   * recording kept as a blob would be a clip that silently loses its media the
   * first time anyone refreshes — the same shape as history vanishing when FAL
   * urls expired, and just as hard to notice until it matters.
   *
   * /api/upload stores it in Spaces and returns a durable https url. It is
   * slower than pointing at the blob, and it is the difference between a
   * recording you still have tomorrow and one you do not.
   */
  async function addRecording({ blob, mimeType, mode, ranForSeconds = 0 }) {
    const kind = trackKindFor(mode);            // voiceover → audio, else video
    const token = localStorage.getItem('voxel_token');

    const form = new FormData();
    form.append('file', blob, `recording.${extensionFor(mimeType)}`);

    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.url) {
      // Named, not generic. The recording is still in memory at this point but
      // the customer cannot act on "upload failed" — they can act on "too
      // large" or on being signed out.
      throw new Error(data?.error || `The recording could not be saved (${resp.status}).`);
    }

    // ── HOW LONG IS IT? ─────────────────────────────────────────────────
    // From the FILE first: MediaRecorder's own timing and wall-clock drift
    // apart by enough to leave a gap or an overlap at a cut.
    //
    // probeUnsized because a recording declares NO duration — WebM written as
    // a stream has no Duration in its header and the browser says Infinity
    // until something forces it to scan to the end.
    //
    // And if that still fails, fall back to HOW LONG THE TAKE ACTUALLY RAN,
    // never to a constant. The first version fell back to 1 second, so every
    // recording arrived as a one-second clip no matter how long you spoke —
    // which is what "it's cutting" was.
    let seconds = 0;
    try { seconds = await measureDuration(data.url, { probeUnsized: true }); } catch { seconds = 0; }
    if (!Number.isFinite(seconds) || seconds <= 0) seconds = ranForSeconds;
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('The recording saved, but its length could not be read. Nothing was added to the timeline.');
    }

    let working = project;
    let track = working.tracks.find((t) => t.kind === kind && !t.locked);
    if (!track) {
      working = addTrack(working, kind);
      track = working.tracks[working.tracks.length - 1];
    }
    const taken = working.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.name?.startsWith(recordingName(mode))).length;

    const id = `rec-${Date.now()}`;
    const at = recordingStartAt(playhead);
    let next = addSource(working, { id, url: data.url, kind, recorded: true });
    const clip = createClip({
      kind,
      sourceId: id,
      name: recordingName(mode, taken + 1),
      // At the PLAYHEAD: someone recording a voiceover is talking over a
      // particular moment, and a take that lands anywhere else needs dragging
      // before it is any use.
      start: at,
      in: 0,
      out: seconds,
    });
    next = addClip(next, track.id, clip);
    change(next, {});

    // ── AND SAY WHERE IT WENT ────────────────────────────────────────────
    // The take lands at the playhead, and the playhead is routinely outside
    // the part of the timeline currently on screen — so a correct recording
    // arrived invisibly. The owner's report was "it's recording, but I don't
    // know where", which is exactly what that looks like from the outside.
    //
    // Three things, because any one alone still leaves it findable-but-not-
    // found: select it, scroll to it, and say it in words with the time and
    // the length so the message is checkable against the timeline.
    setSelected(clip.id);
    timelineControls.current?.revealAt(at);
    toast.success(`${clip.name} added at ${fmtTime(at)} · ${seconds.toFixed(1)}s`);
  }

  /** Add a layer. One undo step, and the new track is empty so there is
   *  nothing to select afterwards. */
  const addLayer = (kind) => change(addTrack(project, kind), {});

  /**
   * Delete a layer, asking first when there is work on it.
   *
   * Undo would bring it back, but "it is undoable" is a poor reason to skip
   * asking — somebody who deletes twelve clips and does not immediately notice
   * has to find the right point in the history to get back to.
   */
  const removeLayer = (track) => {
    const n = track.clips?.length || 0;
    if (n > 0 && !window.confirm(
      `Delete “${track.name}” and its ${n} clip${n === 1 ? '' : 's'}?`)) return;
    change(removeTrack(project, track.id), {});
    // The selected clip may have been ON that track — pointing at a clip that
    // no longer exists leaves the shot panel describing a ghost.
    if (selected && !locateClip(removeTrack(project, track.id), selected)) setSelected(null);
  };

  /**
   * Remake the selected shot and drop it back into the same hole.
   *
   * Lives at the page level on purpose: this is the ONE operation in the
   * editor that spends credits, and the call, the polling and the history
   * record belong together in one visible place rather than inside a panel.
   *
   * The new video becomes a NEW source. The original stays in the document, so
   * undo puts the first take straight back and a split clip's sibling is
   * untouched — see replaceClipSource.
   */
  async function regenerateSelected({ prompt, seconds }) {
    const found = locateClip(project, selected);
    const src = found && sourceOf(project, found.clip);
    if (!src) throw new Error('That clip is no longer on the timeline.');

    setRegenerating(true);
    try {
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          model: src.model, prompt, duration: seconds,
          aspect_ratio: src.ratio || project.ratio,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        // The server's own words — "Not enough credits" is actionable and
        // "Generation failed" is not.
        throw new Error(data.error || `The request was refused (${res.status}).`);
      }

      const url = await pollForVideo(data.job_id, data.model_id);

      // Measure the real length rather than trusting what we asked for: a
      // model asked for 5s often returns 4.8, and that difference is exactly
      // what makes the clip point past the end of its own file.
      const actual = await measureDuration(url);

      const newSource = {
        ...src,
        id: `gen:${data.job_id}`,
        url,
        prompt,
        generation_id: data.job_id,
        regenerated_from: src.id,
      };
      const { project: next, note } = replaceClipSource(project, selected, newSource, actual);
      change(next, {});
      return { note };
    } finally {
      setRegenerating(false);
    }
  }

  /** Poll until the provider finishes. Bounded, because a job that never
   *  resolves must become a message rather than a spinner forever. */
  async function pollForVideo(jobId, modelId, { everyMs = 5000, maxMinutes = 10 } = {}) {
    const deadline = Date.now() + maxMinutes * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, everyMs));
      const res = await fetch('/api/video-status', {
        method: 'POST', headers: authJsonHeaders(),
        body: JSON.stringify({ job_id: jobId, model_id: modelId }),
      });
      const d = await res.json();
      const status = String(d.status || '').toUpperCase();
      if (status === 'COMPLETED' && d.video_url) return d.video_url;
      if (status === 'FAILED' || status === 'ERROR') {
        throw new Error(d.error || 'The model could not make that shot.');
      }
    }
    throw new Error(`It is still running after ${maxMinutes} minutes. It may still finish — check your Video history.`);
  }

  async function doExport() {
    setExportError(null);
    setResult(null);
    setExporting({ stage: 'Starting' });
    try {
      // Imported here, not at the top: the ffmpeg core is 32 MB and pulling it
      // into the page bundle would make every visitor pay for a feature most
      // of them never press.
      const { runExport } = await import('@/lib/edit-exec-browser');
      const out = await runExport(project, {
        ratio: project.ratio,
        mode: project.resizeMode || 'crop',
        onStage: (stage) => setExporting((e) => ({ ...e, stage })),
        onProgress: (p) => setExporting((e) => ({ ...e, progress: p })),
      });
      setResult({
        url: URL.createObjectURL(out.blob),
        bytes: out.bytes,
        warnings: out.warnings,
        dimensions: out.dimensions,
      });
    } catch (err) {
      setExportError(err?.message || String(err));
    } finally {
      setExporting(null);
    }
  }
  const change = (next, opts) => setHistory((h) => commit(h, next, opts));
  const duration = projectDuration(project);
  const seek = (t) => setPlayhead(Math.min(duration, Math.max(0, t)));

  useEditorShortcuts({
    onTogglePlay: () => setPlaying((p) => !p),
    onSplit: () => selected && change(splitClip(project, selected, playhead), {}),
    onDelete: () => { if (selected) { change(removeClip(project, selected), {}); setSelected(null); } },
    onStep: (delta) => seek(playhead + delta),
    onGoTo: (where) => seek(where === 'start' ? 0 : duration),
    // ⌘S goes through the SAME save the menu button calls, so the keyboard and
    // the button can never drift into doing different things.
    onSaveVersion: () => versionsRef.current?.save(),
    onUndo: () => setHistory(undo),
    onRedo: () => setHistory(redo),
    // Shuttle drives the same play flag for now; variable RATE arrives with
    // the export work, when playback stops being a requestAnimationFrame loop.
    onShuttle: (rate) => setPlaying(rate !== 0),
    onToggleSnap: () => setSnapping((v) => !v),
    onTool: setTool,
    onZoomIn: () => timelineControls.current?.zoomIn(),
    onZoomOut: () => timelineControls.current?.zoomOut(),
    onZoomFit: () => timelineControls.current?.zoomToFit(),
    onFocusViewer: layout.focusViewer,
  });

  // ── LAYOUT ─────────────────────────────────────────────────────────────
  // Modelled on ChatCut's arrangement, deliberately: left column full height
  // for the conversation, assets and viewer side by side, timeline spanning
  // beneath them. It is the right shape and worth following.
  //
  // TWO PLACES IT DIVERGES, ON PURPOSE:
  //
  // 1. DARK, not light. Every professional NLE — Premiere, Resolve, Avid,
  //    Final Cut — is dark for one reason: a bright interface around the frame
  //    changes how you judge exposure and colour. A light editor makes footage
  //    look darker and more saturated than it is. Copying their theme would
  //    mean copying the one decision they got wrong for this kind of tool.
  //
  // 2. The assets column is not an empty bin asking for an upload. It is the
  //    customer's own generations, already there. Theirs must say "This bin is
  //    empty" on first open, because their user arrives with nothing.

  const selectedClip = locateClip(project, selected)?.clip || null;
  const selectedSource = selectedClip ? sourceOf(project, selectedClip) : null;

  return (
    // 4rem is the site nav above this page. h-screen was wrong and visibly so:
    // the editor started BELOW a 64px nav and was still a full viewport tall,
    // so the timeline — the one part you cannot work without — sat under the
    // fold and the whole page scrolled. An editor must never scroll as a page;
    // each panel scrolls inside itself.
    <div className="h-[calc(100dvh-4rem)] flex flex-col overflow-hidden bg-background text-foreground">
      {/* ── TOP BAR ──────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 h-12 px-4 border-b border-border shrink-0">
        <span className="font-heading text-sm tracking-wider text-white">VOXEL EDIT CUT</span>
        <span className="text-xs text-foreground-muted truncate max-w-[16rem]">{project.name}</span>

        <span
          data-testid="save-status"
          className={`text-[11px] ${save.status === 'error' ? 'text-primary' : 'text-foreground-muted'}`}
        >
          {save.status === 'error' && `⚠ ${save.error}`}
          {save.status === 'saving' && 'Saving…'}
          {save.status === 'saved' && `Saved ${clockOf(save.at)}`}
          {save.status === 'idle' && 'Not saved yet'}
        </span>

        {/* ── THE SERVER SAVE, SHOWN SEPARATELY ─────────────────────────
            Two different promises, so two different read-outs. "Saved" on
            this machine and "saved to your account" are not the same thing,
            and a single indicator that means either would be a lie half the
            time.
            CONFLICT gets its own colour and its own words. Every other error
            means try again; this one means do NOT try again — the next
            attempt would win, and destroy the other tab's work. */}
        <span
          data-testid="cloud-status"
          className={`text-[11px] ${cloud.status === 'conflict' ? 'text-amber-400' : cloud.status === 'error' ? 'text-primary' : 'text-foreground-muted'}`}
        >
          {cloud.status === 'conflict' && `⚠ ${cloud.error}`}
          {cloud.status === 'error' && `· ${cloud.error}`}
          {cloud.status === 'saving' && '· syncing…'}
          {cloud.status === 'saved' && '· in your account'}
          {!signedIn && '· sign in to save to your account'}
          {signedIn && demo && '· demo — not saved to your account'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {onLeave && (
            <Tip label="All projects" side="bottom"><button
              onClick={onLeave}
              aria-label="All projects"
              data-testid="all-projects"
              className="p-1.5 rounded border border-border text-foreground-muted hover:text-white"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button></Tip>
          )}

          <VersionsMenu
            projectId={onServer.id || 'demo'}
            project={project}
            onRestore={(p) => change(p, {})}
            onNotice={(msg, kind) => (kind === 'error' ? toast.error(msg) : toast.success(msg))}
            ref={versionsRef}
          />
          <Tip label="Undo (⌘Z)" side="bottom"><button
            onClick={() => setHistory(undo)}
            disabled={!canUndo(history)}
            aria-label="Undo"
            className="p-1.5 rounded border border-border text-xs disabled:opacity-30"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button></Tip>
          <Tip label="Redo (⇧⌘Z)" side="bottom"><button
            onClick={() => setHistory(redo)}
            disabled={!canRedo(history)}
            aria-label="Redo"
            className="p-1.5 rounded border border-border text-xs disabled:opacity-30"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button></Tip>

          <Tip side="bottom" label={layout.focused ? 'Show the panels (`)' : 'Big picture — hide the panels (`)'}><button
            onClick={layout.focusViewer}
            aria-label="Big picture"
            aria-pressed={layout.focused}
            data-testid="focus-viewer"
            className={`p-1.5 rounded border border-border ${layout.focused ? 'text-primary' : ''}`}
          >
            {layout.focused ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button></Tip>

          <Tip label={plan.ok ? `Render an MP4 · ${Math.round(plan.duration)}s · ${plan.dimensions?.width}×${plan.dimensions?.height}` : 'Nothing to export yet'} side="bottom"><button
            onClick={doExport}
            disabled={!plan.ok || Boolean(exporting)}
            className="ml-1 inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting
              ? `${exporting.stage}${exporting.progress ? ` ${Math.round(exporting.progress * 100)}%` : ''}…`
              : 'Export'}
          </button></Tip>
        </div>
      </header>

      {/* ── BODY ─────────────────────────────────────────────────────────
          Stacks below lg — a three-column editor on a narrow screen is a
          different product, and #72 covers the whole site properly. */}
      {/* ── A STATIC CLASS WITH A DYNAMIC VALUE ────────────────────────
          The width comes from a CSS custom property, NOT from swapping
          Tailwind classes. Swapping produced a class that was on the element
          with no rule behind it — Tailwind only generates what it can find by
          scanning source, and a class assembled at runtime is not reliably
          found. The element changed, the layout did not, and nothing errored.
          A static class referencing var() is always generated; only the value
          moves. */}
      <div
        className="flex-1 min-h-0 flex flex-col lg:flex-row"
      >

        {/* ── LEFT: the shot, and where the agent will live ───────────── */}
        {/* WIDTH, not a grid track. grid-template-columns refused to
            interpolate between 340px and 2.25rem — the inline value changed and
            the COMPUTED value stayed at 340px, so the panel content swapped to
            a rail while the column stayed wide. Width is a plain length and
            animates reliably. Found by reading inline vs computed side by side. */}
        <aside
          style={wide ? { width: layout.left ? 340 : 36, transition: PANEL_EASE } : undefined}
          className="shrink-0 min-w-0 flex flex-col min-h-0 overflow-hidden border-b lg:border-b-0 lg:border-r border-border"
        >
          {/* ── COLLAPSED: A RAIL, NOT NOTHING ────────────────────────────
              A panel that vanishes completely leaves nothing to click to get
              it back except a menu you have to go hunting for. A 36px strip
              with the icon keeps it one click away, always. */}
          {!layout.left ? (
            <button
              type="button"
              onClick={layout.toggleLeft}
              title="Show the assistant"
              data-testid="rail-left"
              className="h-full w-9 flex items-start justify-center pt-3 text-foreground-muted hover:text-white hover:bg-background-elevated"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          ) : (
          <>
          <PanelLabel
            action={
              <Tip label="Hide the assistant"><button
                type="button"
                onClick={layout.toggleLeft}
                aria-label="Hide the assistant"
                data-testid="collapse-left"
                className="text-foreground-muted hover:text-white"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button></Tip>
            }
          >
            {/* The column is mostly the conversation now — the shot card at
                the top is context for it. Labelling the whole thing "This
                shot" described the smaller half. */}
            Assistant
          </PanelLabel>
          {/* The shot is CONTEXT and the chat is the work, so the shot is
              capped and the conversation takes what is left. Giving both
              flex-1 in a 340px column left the transcript about four lines
              tall, which is not a conversation. */}
          <div className="shrink-0 max-h-[42%] overflow-y-auto p-3">
            <RegeneratePanel
              clip={selectedClip}
              source={selectedSource}
              onRegenerate={regenerateSelected}
              busy={regenerating}
            />

            {notice && (
              <div className="mt-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] text-foreground-secondary">
                {notice}
                <Tip label="Hide this message"><button onClick={() => setNotice(null)} className="ml-2 underline">Dismiss</button></Tip>
              </div>
            )}
            {restored && (
              <div className="mt-3 rounded-lg border border-border px-3 py-2 text-[11px] text-foreground-secondary">
                Restored the project you left open.
                <Tip label="Discard the restored project and start empty"><button
                  onClick={() => {
                    clearProject();
                    setHistory(createHistory(demo ? demoProject() : emptyProject()));
                    setSelected(null);
                    setRestored(false);
                  }}
                  className="ml-2 underline"
                >
                  Start fresh
                </button></Tip>
                <Tip label="Keep the restored project and hide this"><button onClick={() => setRestored(false)} className="ml-2 underline">Dismiss</button></Tip>
              </div>
            )}
          </div>

          {/* ── THE AGENT ──────────────────────────────────────────────────
              Transcript plus composer, composer pinned to the bottom of the
              column exactly where ChatCut puts it: it is the primary input
              and must be reachable without scrolling the conversation.

              onApply commits ONCE. The agent can make seven changes from one
              sentence, and undoing that sentence must take one press of ⌘Z,
              not seven. */}
          <AgentChat
            project={project}
            onApply={(next) => { change(next); setSelected(null); }}
            disabled={!signedIn}
            disabledReason="Sign in to use the assistant — it runs on the server."
          />
          </>
          )}
        </aside>

        {/* ── RIGHT: assets + viewer, then the timeline beneath both ──── */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">

            {/* ── THE LIBRARY COLUMN ───────────────────────────────────
                ChatCut reserves this space with three tabs — MY ASSETS,
                LIBRARY, TRANSCRIPT — and their MY ASSETS opens EMPTY, because
                their user arrives with nothing and has to upload.

                Ours opens FULL. "From Voxel" is everything the customer has
                already generated here, and it is the first tab because it is
                the one that will be used. The other two are shown, disabled,
                with what they will hold — reserving the room now so the layout
                does not have to be rearranged later, and so nobody wonders
                whether uploads were forgotten. */}
            <section
              style={wide ? { width: layout.middle ? 320 : 36, transition: PANEL_EASE } : undefined}
              className="shrink-0 min-w-0 flex flex-col min-h-0 overflow-hidden border-b md:border-b-0 md:border-r border-border"
            >
              {!layout.middle ? (
                <button
                  type="button"
                  onClick={layout.toggleMiddle}
                  title="Show your generations"
                  data-testid="rail-middle"
                  className="h-full w-9 flex items-start justify-center pt-3 text-foreground-muted hover:text-white hover:bg-background-elevated"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              ) : (
              <>
              <div className="shrink-0 flex items-stretch border-b border-border">
                {LIBRARY_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!t.ready}
                    onClick={() => setLibraryTab(t.id)}
                    title={t.ready ? t.hint : `${t.hint} — not built yet`}
                    data-testid={`library-tab-${t.id}`}
                    className={`px-3 py-2 text-[10px] font-medium uppercase tracking-wider transition-colors
                      ${libraryTab === t.id
                        ? 'text-white border-b-2 border-primary'
                        : 'text-foreground-muted border-b-2 border-transparent'}
                      ${t.ready ? 'hover:text-foreground-secondary' : 'opacity-40 cursor-not-allowed'}`}
                  >
                    {t.label}
                  </button>
                ))}
                <Tip label="Hide your generations"><button
                  type="button"
                  onClick={layout.toggleMiddle}
                  aria-label="Hide your generations"
                  data-testid="collapse-middle"
                  className="ml-auto px-3 text-foreground-muted hover:text-white"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                </button></Tip>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                {libraryTab === 'voxel' && (
                  <>
                    <p className="text-[11px] text-foreground-muted mb-2">
                      Everything you generated in Voxel. Click one to add it to the end of the
                      video track — it keeps the prompt, model and camera that made it.
                    </p>
                    <MediaLibrary entity={base44.entities.GenerationHistory} onAdd={addFromLibrary} />
                  </>
                )}

                {libraryTab === 'uploads' && (
                  <>
                    <p className="text-[11px] text-foreground-muted mb-2">
                      Your own footage, music and logos. They land on the track that
                      matches them — a song on audio, a logo on its own layer.
                    </p>
                    <UploadsPanel onAdd={addFromLibrary} />
                  </>
                )}
              </div>
              </>
              )}
            </section>

            <section className="flex-1 min-w-0 flex flex-col min-h-0">
              {/* ── THE SHAPE CONTROL LIVES IN THE HEADER ──────────────────
                  It was under the picture, which reads well and hides badly:
                  on a large screen the video grows to fill the panel and
                  pushes the control below the visible area. The owner could
                  not find it at all.
                  A panel header never scrolls. Panel-level settings belong in
                  it — and ChatCut reaches the same conclusion, putting Aspect
                  Ratio in the always-visible timeline toolbar. */}
              <PanelLabel
                action={
                  <RatioPicker
                    compact
                    ratio={project.ratio}
                    mode={project.resizeMode || 'crop'}
                    onChange={({ ratio, mode }) => change(setProjectRatio(project, ratio, mode), {})}
                  />
                }
              >
                Viewer
              </PanelLabel>
              {/* The PICTURE gets a bounded, non-scrolling area so the frame
                  can size itself by height. The read-outs below it scroll on
                  their own — a viewer that scrolls is a viewer you can lose. */}
              <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
                <div className="flex-1 min-h-0 flex flex-col">
                  <Viewer
                    project={project}
                    playhead={playhead}
                    onScrub={setPlayhead}
                    playing={playing}
                    onPlayingChange={setPlaying}
                  />

                </div>

                {/* Export detail stays under the viewer; the BUTTON is in the
                    top bar where it is always reachable. */}
                <div className="shrink-0 max-h-32 overflow-y-auto space-y-2 text-[11px]">
                    <p className="font-mono text-foreground-muted">
                      {plan.dimensions && `${plan.dimensions.width}×${plan.dimensions.height}`}
                      {' · '}{plan.duration.toFixed(1)}s
                      {' · '}{plan.inputs.length} source{plan.inputs.length === 1 ? '' : 's'}
                      {' · ~'}{estimateSeconds(plan.duration)}s to render
                    </p>

                    {exporting && (
                      <div className="h-1.5 w-full max-w-xs rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full bg-primary transition-[width] duration-200"
                          style={{ width: `${Math.round((exporting.progress || 0) * 100)}%` }}
                        />
                      </div>
                    )}

                    {plan.problems.map((p) => (
                      <p key={p} className="text-primary">⚠ {p}</p>
                    ))}
                    {plan.warnings.map((w) => (
                      <p key={w} className="text-foreground-secondary">• Not included: {w}</p>
                    ))}
                    {exportError && (
                      <p className="text-primary" data-testid="export-error">⚠ {exportError}</p>
                    )}

                    {result && (
                      <div className="flex items-center gap-3 pt-1">
                        <video src={result.url} controls className="w-48 rounded border border-border" />
                        <div className="space-y-1">
                          <div className="text-foreground-secondary">
                            {(result.bytes / 1024 / 1024).toFixed(1)} MB
                            {result.dimensions && ` · ${result.dimensions.width}×${result.dimensions.height}`}
                          </div>
                          <a href={result.url} download="voxel-edit.mp4" className="underline text-primary">
                            Download voxel-edit.mp4
                          </a>
                        </div>
                      </div>
                    )}
                </div>
              </div>
            </section>
          </div>

          {/* ── TIMELINE ─────────────────────────────────────────────────
              Spanning beneath assets AND viewer, not the whole window, so the
              left column stays full height for the conversation. */}
          {/* Capped and scrolling inside itself: a project with ten tracks
              would otherwise grow the timeline until it pushed the viewer off
              the screen entirely. */}
          <div className="border-t border-border shrink-0 max-h-[45%] overflow-y-auto">
            <Timeline
              project={project}
              onChange={change}
              selectedId={selected}
              onSelect={setSelected}
              playhead={playhead}
              onScrub={setPlayhead}
              snapping={snapping}
              onSnappingChange={setSnapping}
              tool={tool}
              onToolChange={setTool}
              onAddTrack={addLayer}
              onRemoveTrack={removeLayer}
              onRecorded={addRecording}
              onRecordError={(m) => toast.error(m)}
              controls={timelineControls}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-3 py-1.5 border-t border-border/60 text-[10px] text-foreground-muted">
              {SHORTCUTS.map(([key, what]) => (
                <span key={key}>
                  <kbd className="font-mono text-foreground-secondary">{key}</kbd> {what}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
