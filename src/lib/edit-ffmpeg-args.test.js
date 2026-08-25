// ─── edit-ffmpeg-args.test.js ────────────────────────────────────────────────
// Every failure in this file is SILENT. A wrong crop does not throw — it hands
// the customer a video with someone's head cut off. A missing atempo chain does
// not throw — it returns audio at the original speed against sped-up video. An
// unbounded amix does not throw — it appends a black tail with music playing
// over it.
//
// None of that produces a log line, an error toast, or a failed request. The
// only place it can be caught is here, in the maths, before anyone renders
// anything.

import { describe, it, expect } from 'vitest';

import { argsFor, dimensionsFor, reshapeFilter, isLocal } from './edit-ffmpeg-args.js';
import { meteredOperations } from './edit-ops.js';

const flat = (op, opts) => (argsFor(op, opts)?.args || []).join(' ');

describe('dimensionsFor — "1080p" means the SHORT side', () => {
  it('gives a vertical reel 1080×1920, not 607×1080', () => {
    // The failure this pins: applying the plan's height cap to the TALL side
    // produces a video that is technically 1080-limited, passes every check,
    // and looks like a postage stamp on a phone.
    expect(dimensionsFor('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
  });

  it('gives the other three platform shapes their standard sizes', () => {
    expect(dimensionsFor('1:1', 1080)).toEqual({ width: 1080, height: 1080 });
    expect(dimensionsFor('4:5', 1080)).toEqual({ width: 1080, height: 1350 });
    expect(dimensionsFor('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('scales down for a smaller plan without changing the shape', () => {
    expect(dimensionsFor('9:16', 720)).toEqual({ width: 720, height: 1280 });
    expect(dimensionsFor('16:9', 720)).toEqual({ width: 1280, height: 720 });
  });

  it('NEVER produces an odd dimension at any quality', () => {
    // libx264 refuses odd dimensions outright — "width not divisible by 2" —
    // so an odd number here is not a cosmetic issue, it is a failed export.
    for (const ratio of ['9:16', '1:1', '4:5', '16:9']) {
      for (const q of [360, 480, 540, 720, 1080, 1440, 2160, 999, 703]) {
        const { width, height } = dimensionsFor(ratio, q);
        expect(width % 2, `${ratio}@${q} width ${width}`).toBe(0);
        expect(height % 2, `${ratio}@${q} height ${height}`).toBe(0);
      }
    }
  });

  it('returns null for a shape nobody publishes to', () => {
    expect(dimensionsFor('3:7')).toBeNull();
  });
});

describe('reshapeFilter — crop vs pad', () => {
  it('crops by covering the frame then cutting the centre', () => {
    const f = reshapeFilter('9:16', { mode: 'crop' });
    expect(f).toContain('force_original_aspect_ratio=increase');
    expect(f).toContain('crop=1080:1920');
  });

  it('pads by fitting inside the frame then filling the rest', () => {
    const f = reshapeFilter('9:16', { mode: 'pad' });
    expect(f).toContain('force_original_aspect_ratio=decrease');
    expect(f).toContain('pad=1080:1920');
  });

  it('defaults to crop, because a padded reel is mostly black bars', () => {
    expect(reshapeFilter('9:16')).toBe(reshapeFilter('9:16', { mode: 'crop' }));
  });
});

describe('trim', () => {
  it('seeks AFTER -i so the cut lands where the handle was dragged', () => {
    // -ss before -i seeks by keyframe: faster, but it can land up to a
    // keyframe interval away from the requested point. "Somewhere near where
    // you dragged" is the product feeling broken.
    const a = argsFor({ op: 'trim', start: 2, end: 8 }).args;
    expect(a.indexOf('-i')).toBeLessThan(a.indexOf('-ss'));
    expect(a).toContain('2');
    expect(a).toContain('8');
  });
});

describe('concat', () => {
  it('uses the concat FILTER, not the demuxer', () => {
    // The demuxer is faster but requires every clip to already share codec,
    // resolution and timebase. These clips come from different models at
    // different sizes, so the demuxer would fail on the normal case.
    const r = argsFor({ op: 'concat', clips: ['a.mp4', 'b.mp4', 'c.mp4'] });
    expect(flat({ op: 'concat', clips: ['a.mp4', 'b.mp4', 'c.mp4'] }))
      .toContain('concat=n=3:v=1:a=1');
    expect(r.inputs).toEqual(['a.mp4', 'b.mp4', 'c.mp4']);
    expect(r.args.filter((x) => x === '-i')).toHaveLength(3);
  });
});

describe('speed — the atempo trap', () => {
  it('CHAINS atempo beyond 2×, because one filter silently ignores the rest', () => {
    // atempo accepts 0.5–2.0 per instance. atempo=4 is rejected by the filter
    // and the audio comes back at ORIGINAL speed against sped-up video: in
    // sync nowhere, with no error anywhere to explain it.
    const s = flat({ op: 'speed', rate: 4 });
    expect(s.match(/atempo=/g)).toHaveLength(2);
    expect(s).toContain('atempo=2,atempo=2');
  });

  it('chains downward too', () => {
    const s = flat({ op: 'speed', rate: 0.25 });
    expect(s.match(/atempo=/g)).toHaveLength(2);
    expect(s).toContain('atempo=0.5,atempo=0.5');
  });

  it('multiplies back to exactly the requested rate', () => {
    for (const rate of [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]) {
      const tempos = [...flat({ op: 'speed', rate }).matchAll(/atempo=([\d.]+)/g)]
        .map((m) => Number(m[1]));
      expect(tempos.reduce((a, b) => a * b, 1), `rate ${rate}`).toBeCloseTo(rate, 5);
      for (const t of tempos) {
        expect(t, `rate ${rate} used atempo=${t}`).toBeGreaterThanOrEqual(0.5);
        expect(t).toBeLessThanOrEqual(2);
      }
    }
  });

  it('moves the video the same direction as the audio', () => {
    // setpts is the INVERSE of the rate. Getting the reciprocal backwards
    // makes 2× play at half speed while the audio doubles.
    expect(flat({ op: 'speed', rate: 2 })).toContain('setpts=0.500000*PTS');
  });
});

describe('mixAudio', () => {
  it('bounds the mix to the VIDEO length', () => {
    // Without duration=first, a music track longer than the clip extends the
    // output — a black tail with music playing over it, exported and posted.
    expect(flat({ op: 'mixAudio', audio: 'music.mp3' })).toContain('duration=first');
  });

  it('copies the video rather than re-encoding it', () => {
    const a = argsFor({ op: 'mixAudio', audio: 'music.mp3' }).args;
    expect(a.join(' ')).toContain('-c:v copy');
  });
});

describe('overlay', () => {
  it('MULTIPLIES the logo alpha instead of replacing it', () => {
    // Replacing alpha makes a transparent PNG's background solid, turning a
    // logo into a black rectangle sitting on the video.
    expect(flat({ op: 'overlay', image: 'logo.png', opacity: 0.5 }))
      .toContain('colorchannelmixer=aa=0.5');
  });

  it('skips the alpha filter entirely at full opacity', () => {
    expect(flat({ op: 'overlay', image: 'logo.png' })).not.toContain('colorchannelmixer');
  });

  it('defaults to the bottom-right corner', () => {
    expect(flat({ op: 'overlay', image: 'logo.png' })).toContain('overlay=W-w-10:H-h-10');
  });

  it('reports both files it needs', () => {
    expect(argsFor({ op: 'overlay', image: 'logo.png' }).inputs).toEqual(['in.mp4', 'logo.png']);
  });
});

describe('addText', () => {
  it('escapes the characters that break a filter graph', () => {
    // An unescaped colon or quote does not render badly — it fails to PARSE,
    // and ffmpeg reports it as a filter error the customer cannot act on.
    const s = flat({ op: 'addText', text: "Ali's 50% off: today" });
    expect(s).toContain("\\'");
    expect(s).toContain('\\:');
    expect(s).toContain('\\%');
  });

  it('shows text for a window when given one, and throughout when not', () => {
    expect(flat({ op: 'addText', text: 'hi', start: 1, end: 4 }))
      .toContain("enable='between(t,1,4)'");
    expect(flat({ op: 'addText', text: 'hi' })).not.toContain('enable=');
  });
});

describe('local vs provider work', () => {
  it('handles every FREE operation locally', () => {
    // The free/paid line from edit-ops.js has a physical meaning here: free
    // operations must be executable with no provider at all. If one of them
    // ever needs a network call, it is not free and the pricing is wrong.
    const localOps = [
      { op: 'trim', start: 0, end: 5 },
      { op: 'concat', clips: ['a', 'b'] },
      { op: 'resize', ratio: '9:16' },
      { op: 'overlay', image: 'l.png' },
      { op: 'addText', text: 'x' },
      { op: 'mixAudio', audio: 'a.mp3' },
      { op: 'volume', gain: -3 },
      { op: 'speed', rate: 2 },
    ];
    for (const op of localOps) expect(isLocal(op), op.op).toBe(true);
  });

  it('sends every METERED operation somewhere else', () => {
    // These are FAL/kie calls, not ffmpeg. Returning args for one would mean
    // trying to run a model as a filter.
    for (const name of meteredOperations()) {
      expect(isLocal({ op: name }), name).toBe(false);
    }
  });
});
