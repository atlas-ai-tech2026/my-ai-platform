// ─── edit-ffmpeg-args.js ─────────────────────────────────────────────────────
// Turning an operation from the tool layer into an actual ffmpeg command.
//
// ── WHY THIS IS A SEPARATE FILE FROM THE THING THAT RUNS IT ────────────────
// Everything that can be WRONG about an edit lives here — the crop maths, the
// filter order, whether a dimension is odd — and none of it needs ffmpeg to be
// present in order to be checked. Splitting the argument building out means the
// part most likely to be subtly broken is also the part that is fully tested,
// while the executor around it stays thin enough to verify by using it.
//
// It matters because the failures here are SILENT AND VISIBLE AT THE SAME TIME:
// a wrong crop does not throw, it just hands the customer a video with someone's
// head cut off. No error, no log, nothing for a test to catch except the maths
// itself.
//
// ── WHAT "1080p" MEANS FOR A VERTICAL VIDEO ────────────────────────────────
// The SHORT side. A 1080p reel is 1080×1920, not 607×1080. Getting this
// backwards produces a video that is technically correct, obeys the plan limit,
// and looks like a postage stamp on a phone. So the plan's maxHeight is applied
// to the shorter dimension, which is what every social platform documents and
// what a creator means when they say "1080".

import { RATIOS } from './edit-ops.js';

/**
 * H.264 cannot encode odd dimensions — the encoder fails outright with
 * "width not divisible by 2". Every computed size passes through here.
 */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Output size for a target shape.
 *
 * `quality` is the SHORT side (see the note above). Standard results:
 *   9:16 @1080 → 1080×1920    1:1 @1080 → 1080×1080
 *   4:5  @1080 → 1080×1350    16:9 @1080 → 1920×1080
 */
export function dimensionsFor(ratio, quality = 1080) {
  const shape = RATIOS[ratio];
  if (!shape) return null;

  const short = Math.min(shape.w, shape.h);
  const scale = quality / short;
  return { width: even(shape.w * scale), height: even(shape.h * scale) };
}

/**
 * The filter that reshapes a video, and the reason there are two modes.
 *
 * `crop` scales until the frame is COVERED, then cuts the overflow from the
 * centre. `pad` scales until the frame FITS, then fills the rest with black.
 *
 * Crop is the default because a landscape clip padded into 9:16 is mostly black
 * bars, and somebody who picked "Reels" wants something that looks like a reel.
 * The trade is real and belongs to the customer, so both are offered — but the
 * default should be the one that is right more often.
 */
export function reshapeFilter(ratio, { mode = 'crop', quality = 1080 } = {}) {
  const dim = dimensionsFor(ratio, quality);
  if (!dim) return null;
  const { width: w, height: h } = dim;

  if (mode === 'pad') {
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease,`
      + `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
}

/** Where a watermark sits, as an ffmpeg overlay position. */
const CORNERS = {
  'top-left': '10:10',
  'top-right': 'W-w-10:10',
  'bottom-left': '10:H-h-10',
  'bottom-right': 'W-w-10:H-h-10',
  center: '(W-w)/2:(H-h)/2',
};

/** drawtext needs these escaped or the filter graph fails to parse. */
const escapeText = (s) => String(s)
  .replace(/\\/g, '\\\\')
  .replace(/:/g, '\\:')
  .replace(/'/g, "\\'")
  .replace(/%/g, '\\%');

/**
 * Build the ffmpeg argument list for one operation.
 *
 * Returns `{ args, inputs, note }` — `inputs` names the files the executor must
 * make available, so the caller never has to infer them from the arguments.
 * Unknown operations return null rather than a command that would do something
 * unintended.
 */
export function argsFor(op, { input = 'in.mp4', output = 'out.mp4', quality = 1080 } = {}) {
  const name = typeof op === 'string' ? op : op?.op;
  const p = op || {};

  switch (name) {
    case 'trim': {
      // -ss and -to BEFORE -i seeks by keyframe: fast, but it can miss the
      // requested point by up to a keyframe interval. After -i is exact.
      // Exact is chosen because a trim that lands somewhere near where the
      // customer dragged the handle is the whole product feeling broken —
      // and re-encoding 30 seconds costs a moment, not a minute.
      return {
        inputs: [input],
        args: ['-i', input, '-ss', String(p.start), '-to', String(p.end),
          '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output],
        note: 'Re-encodes so the cut lands exactly where you put it.',
      };
    }

    case 'concat': {
      // The concat FILTER, not the demuxer. The demuxer is faster but demands
      // that every clip already share codec, resolution and timebase — and
      // these clips come from different models at different sizes, so it would
      // fail on exactly the normal case.
      const clips = p.clips || [];
      const ins = clips.flatMap((c) => ['-i', c]);
      const streams = clips.map((_, i) => `[${i}:v][${i}:a]`).join('');
      return {
        inputs: clips,
        args: [...ins, '-filter_complex', `${streams}concat=n=${clips.length}:v=1:a=1[v][a]`,
          '-map', '[v]', '-map', '[a]',
          '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output],
        note: `Joins ${clips.length} clips, re-encoding so different sizes line up.`,
      };
    }

    case 'resize': {
      const filter = reshapeFilter(p.ratio, { mode: p.mode || 'crop', quality });
      if (!filter) return null;
      const dim = dimensionsFor(p.ratio, quality);
      return {
        inputs: [input],
        args: ['-i', input, '-vf', filter,
          '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'copy', output],
        note: `${dim.width}×${dim.height} — ${RATIOS[p.ratio].label}`,
      };
    }

    case 'overlay': {
      const pos = CORNERS[p.position] || CORNERS['bottom-right'];
      const opacity = Number.isFinite(p.opacity) ? p.opacity : 1;
      // The logo's own alpha is MULTIPLIED by the requested opacity, rather
      // than replaced by it. Replacing it would make a transparent PNG's
      // background solid, which turns a logo into a rectangle.
      const alpha = opacity < 1
        ? `[1:v]format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]`
        : '[0:v][1:v]';
      return {
        inputs: [input, p.image],
        args: ['-i', input, '-i', p.image,
          '-filter_complex', `${alpha}overlay=${pos}`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'copy', output],
        note: 'Watermark applied.',
      };
    }

    case 'addText': {
      const start = Number.isFinite(p.start) ? p.start : 0;
      const end = Number.isFinite(p.end) ? p.end : null;
      const when = end != null ? `:enable='between(t,${start},${end})'` : '';
      const size = p.style?.size || 48;
      const colour = p.style?.color || 'white';
      return {
        inputs: [input],
        args: ['-i', input,
          '-vf', `drawtext=text='${escapeText(p.text)}':fontsize=${size}:fontcolor=${colour}`
            + `:x=(w-text_w)/2:y=h-text_h-40:box=1:boxcolor=black@0.5:boxborderw=10${when}`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'copy', output],
        note: 'Text added.',
      };
    }

    case 'mixAudio': {
      const gain = Number.isFinite(p.gain) ? p.gain : 0;
      // duration=first keeps the VIDEO's length. Without it a music track
      // longer than the clip extends the output, leaving a black tail with
      // music playing over it.
      return {
        inputs: [input, p.audio],
        args: ['-i', input, '-i', p.audio,
          '-filter_complex', `[1:a]volume=${gain}dB[bg];[0:a][bg]amix=inputs=2:duration=first[a]`,
          '-map', '0:v', '-map', '[a]',
          '-c:v', 'copy', '-c:a', 'aac', output],
        note: 'Audio mixed in, trimmed to the video length.',
      };
    }

    case 'volume': {
      const parts = [`volume=${Number.isFinite(p.gain) ? p.gain : 0}dB`];
      if (p.fadeIn) parts.push(`afade=t=in:st=0:d=${p.fadeIn}`);
      if (p.fadeOut && Number.isFinite(p.duration)) {
        parts.push(`afade=t=out:st=${Math.max(0, p.duration - p.fadeOut)}:d=${p.fadeOut}`);
      }
      return {
        inputs: [input],
        args: ['-i', input, '-af', parts.join(','), '-c:v', 'copy', '-c:a', 'aac', output],
        note: 'Audio adjusted.',
      };
    }

    case 'speed': {
      const rate = p.rate;
      // atempo only accepts 0.5–2.0 per instance, so anything outside that
      // range must be CHAINED. A single atempo=4 is silently rejected by the
      // filter and the audio comes back at the original speed against sped-up
      // video — in sync nowhere, with no error to explain it.
      const tempos = [];
      let remaining = rate;
      while (remaining > 2) { tempos.push(2); remaining /= 2; }
      while (remaining < 0.5) { tempos.push(0.5); remaining /= 0.5; }
      tempos.push(Number(remaining.toFixed(6)));
      return {
        inputs: [input],
        args: ['-i', input,
          '-filter_complex',
          `[0:v]setpts=${(1 / rate).toFixed(6)}*PTS[v];`
            + `[0:a]${tempos.map((t) => `atempo=${t}`).join(',')}[a]`,
          '-map', '[v]', '-map', '[a]',
          '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output],
        note: `${rate}× speed.`,
      };
    }

    default:
      // Metered operations (generateMusic, omniEdit, upscale…) are NOT ffmpeg
      // work — they are API calls to FAL or kie. Returning null here is
      // correct, and the executor routes them elsewhere.
      return null;
  }
}

/** Does this operation run locally in ffmpeg, or does it need a provider? */
export const isLocal = (op) => argsFor(op) !== null;
