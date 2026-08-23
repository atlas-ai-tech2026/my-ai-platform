// ─── Viewer.jsx ──────────────────────────────────────────────────────────────
// What the timeline actually looks like at the playhead.
//
// ── THE ONE HARD PART ──────────────────────────────────────────────────────
// A timeline position is not a video position. At 2× speed one second on the
// timeline is two seconds of source, and every clip starts at its own `in`
// point. So the viewer's whole job is: given a moment, find the clip covering
// it, work out where that lands INSIDE its source, and put the element there.
//
// Getting that wrong does not throw. It shows the wrong frame — and only after
// somebody changes speed or trims a left edge, which is exactly when they are
// least likely to suspect the preview rather than their edit.
//
// ── WHY ONE ELEMENT AND NOT ONE PER CLIP ───────────────────────────────────
// One <video> per clip would preload everything and cut instantly, which is
// what a finished editor does. It also means twenty video elements decoding at
// once on a laptop, and the first thing that breaks is the machine of the
// person demonstrating it.
//
// So: one element, source swapped at each cut. There IS a hitch at the cut
// while the next file loads, and it is visible. That is an honest first
// version — preloading the NEXT source is a known improvement, not a surprise.

import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, AlertCircle } from 'lucide-react';

import { activeAt, sourceTimeAt, sourceOf, projectDuration } from '@/lib/timeline';
import Tip from './Tip';

/** Past this, a seek is a jump rather than a nudge, and we set it directly. */
const SEEK_TOLERANCE = 0.25;

export default function Viewer({ project, playhead = 0, onScrub, playing = false, onPlayingChange }) {
  // ── THE VIEWER DRAWS THE SHAPE YOU ARE MAKING ──────────────────────────
  // Not always 16:9. Choosing "Reels" and still seeing a landscape frame
  // means choosing blind — you find out what the crop did to your subject
  // after the export, which is the one moment it is too late.
  //
  // object-fit mirrors the export exactly: `crop` fills and loses the edges
  // (cover), `pad` fits and adds bars (contain). Same decision, same result,
  // shown while there is still time to change it.
  const ratio = project?.ratio || '16:9';
  const mode = project?.resizeMode || 'crop';
  const fit = mode === 'pad' ? 'object-contain' : 'object-cover';
  const videoRef = useRef(null);
  const rafRef = useRef(0);
  const lastTickRef = useRef(0);
  const [problem, setProblem] = useState(null);

  const { picture } = activeAt(project, playhead);
  const source = picture ? sourceOf(project, picture.clip) : null;
  const duration = projectDuration(project);

  // ── keep the element on the right frame ──────────────────────────────────
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !source?.url) return;

    if (el.dataset.src !== source.url) {
      el.dataset.src = source.url;
      el.src = source.url;
      setProblem(null);
    }
    const want = sourceTimeAt(picture.clip, playhead);
    // Only seek on a real difference. Writing currentTime every frame during
    // playback fights the element's own clock and produces a stutter that
    // looks like the file is broken.
    if (Math.abs(el.currentTime - want) > SEEK_TOLERANCE) {
      try { el.currentTime = want; } catch { /* not seekable yet */ }
    }
  }, [source?.url, picture?.clip, playhead]);

  // ── playback advances the PLAYHEAD, not the element ──────────────────────
  // The timeline is the clock. Letting the <video> drive would mean the
  // playhead jumps backwards at every cut, because each new source starts from
  // its own `in` point rather than continuing the project's time.
  useEffect(() => {
    const el = videoRef.current;
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      el?.pause();
      return undefined;
    }
    el?.play?.().catch(() => { /* autoplay policy — the frame still shows */ });
    lastTickRef.current = performance.now();

    const tick = (now) => {
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const next = playhead + delta;
      if (next >= duration) {
        onScrub?.(duration);
        onPlayingChange?.(false);
        return;
      }
      onScrub?.(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, playhead, duration, onScrub, onPlayingChange]);

  return (
    // flex-1: FILL the space the panel gives, do not size to content. Without
    // it the viewer took only as much height as its controls needed, and the
    // frame — bounded by that height — came out a fraction of the panel.
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {/* ── THE FRAME IS BOUNDED BY HEIGHT, NOT WIDTH ────────────────────────
          It used to take the panel's full WIDTH and derive height from the
          ratio. For 16:9 that is fine. For 9:16 it asked for a box nearly
          twice as tall as the screen, which then clipped — so the video sat
          at the top with a huge black area beneath it and the frame was not
          the chosen shape at all.
          Bounding by height and letting the ratio choose the width makes a
          tall shape narrow instead of enormous, which is what an editor
          expects and what the export actually produces. */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
      <div
        style={{ aspectRatio: ratio.replace(':', ' / ') }}
        data-testid="viewer-frame"
        className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center h-full max-h-full max-w-full"
      >
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          onError={() => setProblem('This clip could not be loaded.')}
          className={`w-full h-full ${fit} ${picture ? '' : 'hidden'}`}
        />

        {/* Nothing at this moment is a REAL state, not an error. The timeline
            is allowed to have holes; saying so is better than a black frame
            that could equally mean a broken file. */}
        {!picture && !problem && (
          <span className="text-sm text-foreground-muted" data-testid="viewer-empty">
            Nothing on the timeline at {playhead.toFixed(1)}s
          </span>
        )}

        {/* A source can vanish because a link expired. That must never look
            like an empty project. */}
        {picture && !source && (
          <span className="flex items-center gap-2 text-sm text-primary" data-testid="viewer-missing">
            <AlertCircle className="w-4 h-4" />
            The media for “{picture.clip.name || picture.clip.sourceId}” is missing.
          </span>
        )}

        {problem && (
          <span className="flex items-center gap-2 text-sm text-primary">
            <AlertCircle className="w-4 h-4" /> {problem}
          </span>
        )}
      </div>
      </div>

      <div className="flex items-center gap-3">
        <Tip label={playing ? 'Pause (Space)' : 'Play (Space)'}>
          <button
            onClick={() => onPlayingChange?.(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
            className="p-2 rounded-full bg-primary hover:bg-primary-hover text-white"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
        </Tip>

        {/* The prompt that made this shot — the thing no upload-based editor
            has, shown because it is the reason this clip looks like it does. */}
        {source?.prompt && (
          <span className="truncate text-xs text-foreground-muted" title={source.prompt}>
            “{source.prompt}”
            {source.model && <span className="ml-2 text-foreground-secondary">· {source.model}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
