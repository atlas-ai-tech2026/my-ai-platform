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

  const { picture, audio } = activeAt(project, playhead);
  const source = picture ? sourceOf(project, picture.clip) : null;
  const duration = projectDuration(project);

  // ── SOUND ────────────────────────────────────────────────────────────────
  // Found 2026-08-25, and it was never a recording bug. The owner recorded a
  // voiceover, it uploaded, it appeared on the timeline — and pressing play
  // produced silence. So did the demo project's music bed, and so had every
  // audio clip since this editor existed: `activeAt` has always returned the
  // audio playing at each moment, and the viewer only ever read `picture`.
  //
  // Nobody noticed because until you can RECORD, every clip you can put on an
  // audio track came from somewhere you had already heard it.
  //
  // One <audio> per audio TRACK, not per clip — same reasoning as the single
  // <video>: a element per clip preloads the whole project. Tracks are capped
  // at three per kind, so this is at most three elements.
  //
  // Video clips are excluded here on purpose. activeAt lists them as audio
  // too (a video carries its own sound), but that sound comes out of the
  // <video> element already — playing it twice is an echo, slightly out of
  // step with itself.
  const audioClips = audio.filter((a) => a.clip.kind === 'audio');
  const audioTracks = (project?.tracks || []).filter((t) => t.kind === 'audio');
  const audioRefs = useRef(new Map());
  // play() is async. Callbacks that fire later (loadedmetadata) need to know
  // whether we are STILL playing, not whether we were when they were attached.
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // ── keep the element on the right frame ──────────────────────────────────
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !source?.url) return;

    if (el.dataset.src !== source.url) {
      el.dataset.src = source.url;
      el.src = source.url;
      setProblem(null);
    }
    // Muting a video TRACK never muted it here — activeAt drops muted tracks
    // from its audio list, but the picture keeps playing its own sound
    // regardless. Found while wiring the audio tracks up.
    el.muted = Boolean(picture.track?.muted);
    const want = sourceTimeAt(picture.clip, playhead);
    // Only seek on a real difference. Writing currentTime every frame during
    // playback fights the element's own clock and produces a stutter that
    // looks like the file is broken.
    if (Math.abs(el.currentTime - want) > SEEK_TOLERANCE) {
      try { el.currentTime = want; } catch { /* not seekable yet */ }
    }
  }, [source?.url, picture?.clip, picture?.track?.muted, playhead]);

  // ── keep every audio track on the right moment ───────────────────────────
  // Runs on every render, because the playhead moves every frame. It sets
  // source, volume and position — and calls play() ONLY when it has just
  // attached a new source, never on a frame where nothing changed.
  //
  // The first version called play() unconditionally here, which during
  // playback meant once per animation frame. Overlapping play() promises abort
  // one another, and the element ends up paused with a stale currentTime while
  // the picture keeps moving — audio that works when you poke it by hand and
  // not when the app drives it, which is a miserable thing to debug.
  useEffect(() => {
    for (const [trackId, el] of audioRefs.current) {
      if (!el) continue;
      const entry = audioClips.find((a) => a.track.id === trackId);
      const url = entry ? sourceOf(project, entry.clip)?.url : null;

      // Nothing on this track at this moment — or the track is muted, which
      // activeAt has already handled by leaving it out.
      if (!entry || !url) { try { el.pause(); } catch { /* not started */ } continue; }

      const isNewSource = el.dataset.src !== url;
      if (isNewSource) {
        el.dataset.src = url;
        el.src = url;
        // A seek issued now is DISCARDED — the element has no metadata yet, so
        // it does not know it is seekable and quietly keeps currentTime at 0.
        // The clip then plays from its own beginning while the picture is
        // somewhere else, which sounds like drift and is actually a lost seek.
        el.addEventListener('loadedmetadata', function applyPending() {
          const at = Number(el.dataset.pendingSeek);
          if (Number.isFinite(at)) { try { el.currentTime = at; } catch { /* still not seekable */ } }
          // A clip that starts mid-playback has to start ITSELF: the play/pause
          // effect only fires when `playing` changes, and it did not.
          if (playingRef.current) el.play?.().catch(() => {});
        }, { once: true });
      }

      // A clip volume of 0 is a real mute — the agent's setVolume writes it —
      // so it must be read as a value, not falsy-defaulted back to 1.
      const vol = typeof entry.clip.volume === 'number' ? entry.clip.volume : 1;
      el.volume = Math.max(0, Math.min(1, vol));

      const want = sourceTimeAt(entry.clip, playhead);
      // Recorded so the loadedmetadata handler above can apply it once the
      // element is actually seekable.
      el.dataset.pendingSeek = String(want);
      if (el.readyState >= 1 && Math.abs(el.currentTime - want) > SEEK_TOLERANCE) {
        try { el.currentTime = want; } catch { /* not seekable yet */ }
      }
      // NO play() here. This effect runs once per animation frame, and play()
      // is asynchronous: on the next frame the element is still `paused` because
      // the first request has not resolved yet, so a `paused` check requests it
      // again, and again. Overlapping play() promises abort one another and the
      // element settles PAUSED — playing fine when poked by hand, silent when
      // the app drives it. Starting and stopping is the effect below.
    }
  });

  // ── start and stop the audio, on the TRANSITION only ────────────────────
  useEffect(() => {
    for (const el of audioRefs.current.values()) {
      if (!el?.dataset.src) continue;
      if (playing) el.play?.().catch(() => { /* autoplay policy */ });
      else { try { el.pause(); } catch { /* not started */ } }
    }
  }, [playing]);

  // ── playback advances the PLAYHEAD, not the element ──────────────────────
  // The timeline is the clock. Letting the <video> drive would mean the
  // playhead jumps backwards at every cut, because each new source starts from
  // its own `in` point rather than continuing the project's time.
  useEffect(() => {
    const el = videoRef.current;
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      el?.pause();
      // The audio tracks stop too. Missing this leaves a voiceover running
      // over a frozen picture, which reads as the video having broken.
      for (const a of audioRefs.current.values()) { try { a?.pause(); } catch { /* not started */ } }
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
        {/* One per audio track. Hidden — they are speakers, not pictures —
            but real elements, because a Web Audio graph would be a second
            clock to keep in step with the timeline for no visible gain. */}
        {audioTracks.map((t) => (
          <audio
            key={t.id}
            data-testid={`viewer-audio-${t.id}`}
            preload="auto"
            ref={(el) => {
              if (el) audioRefs.current.set(t.id, el);
              else audioRefs.current.delete(t.id);
            }}
          />
        ))}

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
