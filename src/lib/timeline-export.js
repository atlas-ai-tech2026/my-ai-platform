// ─── timeline-export.js ──────────────────────────────────────────────────────
// The timeline becomes one file.
//
// Everything before this is a promise. Nobody publishes a project — they
// publish an MP4, and an editor that cannot produce one is a toy.
//
// This file builds the ffmpeg invocation and nothing else. It runs nowhere
// near a browser, so every decision below is testable without loading 32 MB of
// WebAssembly to find out that a filter name was wrong.
//
// ── THE FOUR THINGS THAT BREAK A CONCAT ────────────────────────────────────
// ffmpeg's concat filter refuses inputs that disagree, and the error it gives
// is not the error you have. All four are handled here, once:
//
//   1. DIFFERENT FRAME RATES — a 24fps clip after a 30fps clip. Every segment
//      gets an explicit fps filter.
//   2. DIFFERENT SAMPLE ASPECT RATIOS — the classic "do not match the
//      corresponding output link" message, from a source whose SAR is 1:1 next
//      to one that is 40:33. setsar=1 on every segment.
//   3. DIFFERENT PIXEL FORMATS — format=yuv420p, which is also the only thing
//      Safari and QuickTime will play.
//   4. A MISSING AUDIO STREAM — concat with a=1 needs audio on EVERY segment.
//      One silent source and the whole graph fails to build. Silence is
//      generated for those, so one odd clip cannot take the export down.
//
// ── AND THE THING THAT IS NOT A CRASH ──────────────────────────────────────
// Stage 1 renders picture and sound. A timeline can also hold text, images and
// captions, and those are NOT in the output yet. Dropping them quietly is the
// worst outcome available: the customer publishes a video missing its title
// card and finds out from somebody else. Every omission is returned in
// `warnings` and the UI is expected to show them BEFORE the render starts.

import { dimensionsFor, reshapeFilter } from './edit-ffmpeg-args.js';
import { clipDuration, clipEnd, projectDuration, sourceOf, trackGaps } from './timeline.js';

/** One output frame rate for everything. Mixed rates are the single most
 *  common reason a concat produces a file that stutters or will not build. */
export const FPS = 30;
export const SAMPLE_RATE = 48000;

/** Tracks Stage 1 can actually render. */
const RENDERED = new Set(['video', 'audio', 'image']);

const round = (n) => Math.round(n * 1000) / 1000;

/** Keep the real extension on the virtual-FS name — a few demuxers are picked
 *  from it, and an mp3 written as .mp4 is a decode failure with a misleading
 *  message. Query strings are stripped: signed Spaces urls carry them. */
function extensionOf(url = '') {
  const clean = String(url).split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]{2,4})$/i);
  return m ? `.${m[1].toLowerCase()}` : '.mp4';
}

/**
 * The video track's timeline as an unbroken run of segments.
 *
 * A hole between two clips is a REAL part of the edit — the owner found one by
 * asking why a clock had a gap in it. Closing it silently here would export
 * something different from what is on screen, which is the one thing a preview
 * must never do. Holes become black.
 */
export function segmentsOf(track, total) {
  if (!track) return [];
  const segments = [];
  let at = 0;
  for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
    if (clip.start > at + 0.001) {
      segments.push({ kind: 'gap', start: at, duration: round(clip.start - at) });
    }
    segments.push({ kind: 'clip', clip, start: clip.start, duration: clipDuration(clip) });
    at = Math.max(at, clipEnd(clip));
  }
  if (total > at + 0.001) segments.push({ kind: 'gap', start: at, duration: round(total - at) });
  return segments;
}

/**
 * Everything the caller needs to render, plus everything it will NOT render.
 *
 * @returns {{ok: boolean, problems: string[], warnings: string[], inputs: object[],
 *            args: string[], filter: string, duration: number, dimensions: object}}
 */
export function exportPlan(project, { ratio, quality = 1080, mode = 'crop', output = 'out.mp4' } = {}) {
  const problems = [];
  const warnings = [];

  const targetRatio = ratio || project?.ratio || '16:9';
  const dim = dimensionsFor(targetRatio, quality);
  if (!dim) {
    return { ok: false, problems: [`${targetRatio} is not a shape we can export.`], warnings, inputs: [], args: [], filter: '', duration: 0, dimensions: null };
  }
  const reshape = reshapeFilter(targetRatio, { mode, quality });

  // ── THE LAYER STACK ────────────────────────────────────────────────────
  // Bottom of the list is the BASE; everything above is overlaid onto it, so
  // the track at the top of the timeline is the one you see. That matches
  // what the UI draws and what every editor means by "above".
  //
  // Until 2026-08-23 this was a find() — the first video track and no other —
  // while the audio path looped over every audio track and mixed them. The two
  // were asymmetric, invisibly: a second video layer was dropped from the file
  // in total silence.
  //
  // ── AND WHY THE BASE IS THE LOWEST TRACK **WITH CLIPS** ────────────────
  // Found by looking at the screen, not by a test. Adding an empty "Video 2"
  // below a full one made the export refuse with "there is nothing on the
  // video track" — because the empty track had become the base. An empty
  // layer is not a black layer somebody asked for, it is a layer they have
  // not filled yet, and it must not decide anything.
  const videoTracks = (project?.tracks || []).filter(
    (t) => t.kind === 'video' && !t.hidden && (t.clips?.length || 0) > 0);
  const upperTracks = videoTracks.slice(0, -1);          // top-most first
  const videoTrack = videoTracks[videoTracks.length - 1] || null;

  const total = projectDuration(project);

  if (!videoTrack || videoTrack.clips.length === 0) {
    problems.push('There is nothing on the video track to export.');
  }
  if (total <= 0) problems.push('The project is empty.');

  // ── SAY WHAT IS NOT IN THE FILE ────────────────────────────────────────
  for (const track of project?.tracks || []) {
    if (RENDERED.has(track.kind)) continue;
    const n = track.clips?.length || 0;
    if (n > 0) {
      warnings.push(`${n} ${track.kind} clip${n === 1 ? '' : 's'} on “${track.name}” ${n === 1 ? 'is' : 'are'} not in this export yet.`);
    }
  }
  for (const track of project?.tracks || []) {
    if (track.hidden && track.clips?.length) warnings.push(`“${track.name}” is hidden and was left out.`);
    if (track.muted && track.kind === 'audio' && track.clips?.length) warnings.push(`“${track.name}” is muted and was left out.`);
  }

  // ── ONE INPUT PER SOURCE ───────────────────────────────────────────────
  // A clip split six ways is still ONE file. Adding an -i per clip would
  // download and decode it six times, which on a 40 MB source is the
  // difference between an export somebody waits for and one they abandon.
  const inputs = [];
  const inputIndex = new Map();
  const useSource = (clip) => {
    const src = sourceOf(project, clip);
    if (!src?.url) {
      problems.push(`“${clip.name || clip.sourceId}” has no media to export.`);
      return null;
    }
    if (!inputIndex.has(src.id)) {
      const i = inputs.length;
      inputIndex.set(src.id, i);
      // A LOCAL name, not the url. ffmpeg.wasm reads from a virtual filesystem,
      // and the extension is kept because some demuxers are chosen from it.
      inputs.push({ index: i, id: src.id, url: src.url, file: `s${i}${extensionOf(src.url)}`, hasAudio: src.hasAudio !== false });
    }
    return { src, index: inputIndex.get(src.id) };
  };

  const chains = [];
  const concatLabels = [];
  let gapNo = 0;

  const segments = segmentsOf(videoTrack, total);
  segments.forEach((seg, i) => {
    if (seg.duration <= 0) return;

    if (seg.kind === 'gap') {
      const v = `gv${gapNo}`;
      const a = `ga${gapNo}`;
      gapNo += 1;
      chains.push(`color=c=black:s=${dim.width}x${dim.height}:r=${FPS}:d=${seg.duration},setsar=1,format=yuv420p[${v}]`);
      chains.push(`anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE},atrim=duration=${seg.duration},asetpts=PTS-STARTPTS[${a}]`);
      concatLabels.push(`[${v}][${a}]`);
      return;
    }

    const found = useSource(seg.clip);
    if (!found) return;
    const { index } = found;
    const { clip } = seg;
    const speed = clip.speed || 1;

    // trim indexes the SOURCE; setpts rebases it to zero so concat can lay the
    // segments end to end. Both are needed — trim alone leaves the original
    // timestamps and the segment plays after a long freeze.
    const v = `v${i}`;
    const speedV = speed !== 1 ? `,setpts=PTS/${speed}` : '';
    chains.push(
      `[${index}:v]trim=start=${clip.in}:end=${clip.out},setpts=PTS-STARTPTS${speedV},`
      + `${reshape},fps=${FPS},setsar=1,format=yuv420p[${v}]`,
    );

    const a = `a${i}`;
    if (found.src.hasAudio === false) {
      // A silent source cannot simply be skipped: concat with a=1 requires an
      // audio stream on every single segment or the graph does not build.
      chains.push(`anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE},atrim=duration=${seg.duration},asetpts=PTS-STARTPTS[${a}]`);
    } else {
      chains.push(
        `[${index}:a]atrim=start=${clip.in}:end=${clip.out},asetpts=PTS-STARTPTS`
        + `${speed !== 1 ? `,${atempoChain(speed)}` : ''},aresample=${SAMPLE_RATE}[${a}]`,
      );
    }
    concatLabels.push(`[${v}][${a}]`);
  });

  if (concatLabels.length === 0 && problems.length === 0) {
    problems.push('There is nothing on the video track to export.');
  }

  // ── MUSIC UNDER THE CUT ────────────────────────────────────────────────
  // Each audio clip is delayed to its own start, then mixed. duration=first
  // so a long music bed cannot extend the video past its last frame — the
  // mistake that turns a 30-second edit into a 3-minute file with a black end.
  const musicLabels = [];
  for (const track of project?.tracks || []) {
    if (track.kind !== 'audio' || track.muted || track.hidden) continue;
    for (const clip of track.clips) {
      const found = useSource(clip);
      if (!found) continue;
      const label = `m${musicLabels.length}`;
      const delayMs = Math.round(clip.start * 1000);
      const gain = clip.gain ?? 1;
      chains.push(
        `[${found.index}:a]atrim=start=${clip.in}:end=${clip.out},asetpts=PTS-STARTPTS,`
        + `aresample=${SAMPLE_RATE}${gain !== 1 ? `,volume=${gain}` : ''}`
        + `${delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : ''}[${label}]`,
      );
      musicLabels.push(label);
    }
  }

  const n = concatLabels.length;
  let videoOut = 'vout';
  let audioOut = 'aout';
  if (n > 0) {
    chains.push(`${concatLabels.join('')}concat=n=${n}:v=1:a=1[vout][aout]`);
  }

  // ── UPPER VIDEO LAYERS, OVERLAID ONTO THE BASE ─────────────────────────
  // Each clip is placed individually and gated to its own window with
  // `enable`, rather than building each upper track into a full-length
  // stream first.
  //
  // WHY, because the obvious way is worse: a full-length upper track needs its
  // GAPS to be transparent so the layer underneath shows through, which means
  // an alpha pixel format all the way through the graph, and concat then has
  // to agree about alpha on every segment — a fourth way for the concat to
  // refuse, on top of the three already documented at the top of this file.
  // Gating per clip needs no alpha at all: outside its window the overlay
  // simply is not applied and the base is what you see.
  //
  // `eof_action=pass` keeps the base running once a short overlay has ended.
  // Without it the output stops at the end of the topmost clip, which on a
  // 3-second logo over a 60-second edit is a 3-second file.
  if (n > 0) {
    let overlayNo = 0;
    // Reversed: the layer CLOSEST to the base is applied first, so the top of
    // the list finishes on top.
    for (const track of [...upperTracks].reverse()) {
      for (const clip of [...(track.clips || [])].sort((a, b) => a.start - b.start)) {
        const found = useSource(clip);
        if (!found) continue;
        const speed = clip.speed || 1;
        const label = `ov${overlayNo}`;
        const out = `ovo${overlayNo}`;
        const start = round(clip.start);
        const end = round(clipEnd(clip));

        chains.push(
          `[${found.index}:v]trim=start=${clip.in}:end=${clip.out},setpts=PTS-STARTPTS`
          + `${speed !== 1 ? `,setpts=PTS/${speed}` : ''},${reshape},fps=${FPS},setsar=1,format=yuv420p,`
          + `setpts=PTS+${start}/TB[${label}]`,
        );
        chains.push(
          `[${videoOut}][${label}]overlay=eof_action=pass:enable='between(t,${start},${end})'[${out}]`,
        );
        videoOut = out;
        overlayNo += 1;

        // The upper layer's SOUND is mixed in like a music bed rather than
        // being dropped. A B-roll shot laid over a cut usually carries the
        // audio somebody wants, and silently discarding it is the same class
        // of bug as silently discarding the picture was.
        if (found.src.hasAudio !== false && !track.muted) {
          const mLabel = `um${overlayNo}`;
          const delayMs = Math.round(clip.start * 1000);
          chains.push(
            `[${found.index}:a]atrim=start=${clip.in}:end=${clip.out},asetpts=PTS-STARTPTS,`
            + `aresample=${SAMPLE_RATE}${speed !== 1 ? `,${atempoChain(speed)}` : ''}`
            + `${delayMs > 0 ? `,adelay=${delayMs}|${delayMs}` : ''}[${mLabel}]`,
          );
          musicLabels.push(mLabel);
        }
      }
    }
  }
  if (musicLabels.length > 0 && n > 0) {
    const mixIn = ['[aout]', ...musicLabels.map((l) => `[${l}]`)].join('');
    chains.push(`${mixIn}amix=inputs=${musicLabels.length + 1}:duration=first:dropout_transition=0,aresample=${SAMPLE_RATE}[amixed]`);
    audioOut = 'amixed';
  }

  const filter = chains.join(';');
  const args = [];
  for (const input of inputs) args.push('-i', input.file);
  if (filter) args.push('-filter_complex', filter);
  args.push('-map', `[${videoOut}]`, '-map', `[${audioOut}]`);
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    // Lets the file start playing before it has fully downloaded. Without it a
    // web-hosted export buffers the whole thing first, which reads as broken.
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-r', String(FPS),
    output,
  );

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    inputs,
    args,
    filter,
    duration: total,
    dimensions: dim,
    segments,
  };
}

/**
 * atempo only accepts 0.5–2.0, so anything outside that has to be chained.
 * 4× is atempo=2.0,atempo=2.0 — not atempo=4.0, which ffmpeg rejects outright
 * and which is the reason "speed up 4x" fails while "speed up 2x" works.
 */
export function atempoChain(speed) {
  const parts = [];
  let remaining = speed;
  while (remaining > 2) { parts.push('atempo=2.0'); remaining /= 2; }
  while (remaining < 0.5) { parts.push('atempo=0.5'); remaining /= 0.5; }
  parts.push(`atempo=${round(remaining)}`);
  return parts.join(',');
}

/**
 * How long the render will take, so the UI can say something truer than
 * "a while".
 *
 * ── THESE NUMBERS ARE MEASURED, NOT ESTIMATED ──────────────────────────────
 * The first version of this function guessed 4x real time and called itself
 * "deliberately pessimistic". It was optimistic by half.
 *
 * MEASURED 2026-08-23 on dev.voxel-ai.ai: a 30-second 1080p timeline, two
 * sources, one audio bed mixed under it, rendered in 244 seconds. That is
 * 8.1x real time — so a one-minute video is about eight minutes of waiting.
 *
 * ffmpeg.wasm is single-threaded by necessity here: the multi-threaded build
 * needs SharedArrayBuffer, which needs COOP/COEP, which would break the
 * customer's own media served from Spaces.
 *
 * 720p is scaled by pixel count (1280x720 is 44% of 1920x1080) with a little
 * headroom, because x264 does not scale perfectly linearly.
 *
 * WHAT THIS NUMBER IS FOR, beyond a label: at 8x, a workshop attendee cannot
 * export a two-minute piece in a session. That is the evidence for moving the
 * render server-side, and it is why it is written down rather than rounded.
 */
export const RENDER_RATIO = { 1080: 8.1, 720: 4, 480: 2 };

export function estimateSeconds(duration, quality = 1080) {
  const ratio = RENDER_RATIO[quality] ?? RENDER_RATIO[1080];
  return Math.max(5, Math.ceil(duration * ratio));
}
