// ─── timeline-export.test.js ─────────────────────────────────────────────────
// Every assertion here stands in for a 32 MB WebAssembly download and a
// several-minute render that would otherwise be the only way to discover a
// wrong filter name.
//
// The four concat killers are pinned first, because each of them produces an
// ffmpeg error that does not describe the actual problem, and the fifth test —
// the one about text clips — is about the failure that does not error at all.

import { describe, it, expect } from 'vitest';
import {
  exportPlan, segmentsOf, atempoChain, estimateSeconds, FPS, SAMPLE_RATE,
} from './timeline-export.js';
import {
  createProject, createClip, addClip, addSource, addTrack, __resetIds, updateClip,
} from './timeline.js';

function project({ withGap = false, withMusic = false, withText = false, silent = false } = {}) {
  __resetIds();
  let p = createProject({ name: 'T', ratio: '16:9' });
  const v = p.tracks[0].id;
  const a = p.tracks[1].id;
  p = addSource(p, { id: 'sa', url: 'a.mp4', kind: 'video', hasAudio: !silent });
  p = addSource(p, { id: 'sb', url: 'b.mp4', kind: 'video' });
  p = addSource(p, { id: 'mus', url: 'm.mp3', kind: 'audio' });

  p = addClip(p, v, createClip({ kind: 'video', sourceId: 'sa', name: 'one', start: 0, in: 0, out: 5 }));
  p = addClip(p, v, createClip({
    kind: 'video', sourceId: 'sb', name: 'two', start: withGap ? 8 : 5, in: 2, out: 7,
  }));
  if (withMusic) {
    p = addClip(p, a, createClip({ kind: 'audio', sourceId: 'mus', name: 'bed', start: 0, in: 0, out: 20 }));
  }
  if (withText) {
    p = addTrack(p, 'text');
    const t = p.tracks[p.tracks.length - 1].id;
    p = addClip(p, t, createClip({ kind: 'text', sourceId: 'title', name: 'Title', start: 1, in: 0, out: 3 }));
  }
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the four things that break a concat', () => {
  const filter = exportPlan(project()).filter;

  it('forces one frame rate on every segment', () => {
    // A 24fps clip after a 30fps one either refuses to build or stutters.
    expect(filter.split(';').filter((c) => c.includes('trim=start=')).length).toBeGreaterThan(1);
    for (const s of filter.split(';').filter((c) => /^\[\d+:v\]/.test(c))) {
      expect(s, 'a video segment with no fps filter').toContain(`fps=${FPS}`);
    }
  });

  it('forces one sample aspect ratio', () => {
    // "do not match the corresponding output link" — the message that sends
    // people looking at resolution when the cause is SAR 40:33 vs 1:1.
    for (const s of filter.split(';').filter((c) => /^\[\d+:v\]/.test(c))) {
      expect(s, 'a video segment with no setsar').toContain('setsar=1');
    }
  });

  it('forces yuv420p — also the only thing QuickTime will play', () => {
    for (const s of filter.split(';').filter((c) => /^\[\d+:v\]/.test(c))) {
      expect(s).toContain('format=yuv420p');
    }
  });

  it('gives a silent source generated silence rather than skipping it', () => {
    // concat with a=1 needs audio on EVERY segment. One silent clip would
    // otherwise take the whole export down with a graph error.
    const plan = exportPlan(project({ silent: true }));
    expect(plan.ok).toBe(true);
    expect(plan.filter).toContain('anullsrc');
    const n = (plan.filter.match(/concat=n=(\d+)/) || [])[1];
    const pairs = (plan.filter.match(/\[v\d+\]\[a\d+\]|\[gv\d+\]\[ga\d+\]/g) || []).length;
    expect(Number(n), 'concat count does not match the segments handed to it').toBe(pairs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what is NOT in the file gets said out loud', () => {
  it('warns about text clips instead of dropping them silently', () => {
    // The worst available outcome is publishing a video missing its title card
    // and hearing about it from somebody else.
    const plan = exportPlan(project({ withText: true }));
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/1 text clip.*not in this export/i);
  });

  it('says nothing when there is nothing to say', () => {
    expect(exportPlan(project()).warnings).toEqual([]);
  });

  it('warns about a hidden track that has content', () => {
    let p = project();
    p = { ...p, tracks: p.tracks.map((t) => (t.kind === 'video' ? { ...t, hidden: true } : t)) };
    expect(exportPlan(p).warnings.join(' ')).toMatch(/hidden/i);
  });

  it('warns about a muted audio track', () => {
    let p = project({ withMusic: true });
    p = { ...p, tracks: p.tracks.map((t) => (t.kind === 'audio' ? { ...t, muted: true } : t)) };
    const plan = exportPlan(p);
    expect(plan.warnings.join(' ')).toMatch(/muted/i);
    expect(plan.filter, 'a muted track was mixed in anyway').not.toContain('amix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('gaps are exported, not closed', () => {
  it('a hole becomes black, so the file matches the preview', () => {
    const plan = exportPlan(project({ withGap: true }));
    const gap = plan.segments.find((s) => s.kind === 'gap');
    expect(gap, 'the gap vanished from the plan').toBeTruthy();
    expect(gap.duration).toBe(3);              // clip one ends at 5, clip two starts at 8
    expect(plan.filter).toContain('color=c=black');
    expect(plan.filter).toContain(':d=3');
  });

  it('black filler is generated at the OUTPUT size, not the source size', () => {
    const plan = exportPlan(project({ withGap: true }), { ratio: '9:16' });
    expect(plan.filter).toContain('s=1080x1920');
  });

  it('a gap carries silence so the concat stays balanced', () => {
    const plan = exportPlan(project({ withGap: true }));
    expect(plan.filter).toMatch(/anullsrc[^;]*atrim=duration=3/);
  });

  it('no gap means no black', () => {
    expect(exportPlan(project()).filter).not.toContain('color=c=black');
  });
});

describe('segmentsOf', () => {
  it('lays clips end to end with holes between them', () => {
    const p = project({ withGap: true });
    const segs = segmentsOf(p.tracks[0], 13);
    expect(segs.map((s) => `${s.kind}@${s.start}+${s.duration}`))
      .toEqual(['clip@0+5', 'gap@5+3', 'clip@8+5']);
  });

  it('a clip that does not start at zero gets a leading gap', () => {
    __resetIds();
    let p = createProject({});
    p = addSource(p, { id: 's', url: 'a.mp4' });
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 's', start: 2, in: 0, out: 4 }));
    expect(segmentsOf(p.tracks[0], 6)[0]).toMatchObject({ kind: 'gap', start: 0, duration: 2 });
  });

  it('an empty track is no segments, not one endless gap', () => {
    __resetIds();
    expect(segmentsOf(createProject({}).tracks[0], 0)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('one input per source, not per clip', () => {
  it('a source used twice is opened once', () => {
    __resetIds();
    let p = createProject({});
    p = addSource(p, { id: 's', url: 'a.mp4' });
    const v = p.tracks[0].id;
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 's', start: 0, in: 0, out: 3 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 's', start: 3, in: 10, out: 13 }));
    p = addClip(p, v, createClip({ kind: 'video', sourceId: 's', start: 6, in: 20, out: 23 }));

    const plan = exportPlan(p);
    expect(plan.inputs, 'the same file would be fetched and decoded three times').toHaveLength(1);
    expect(plan.args.filter((a) => a === '-i')).toHaveLength(1);
    expect(plan.filter.match(/\[0:v\]/g)).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('music under the cut', () => {
  it('mixes the audio track in', () => {
    const plan = exportPlan(project({ withMusic: true }));
    expect(plan.filter).toContain('amix=inputs=2');
    expect(plan.args.join(' ')).toContain('[amixed]');
  });

  it('duration=first, so a long bed cannot extend the video', () => {
    // The music is 20s over a 10s edit. Without duration=first the export is a
    // 20-second file with ten seconds of nothing on the end.
    const plan = exportPlan(project({ withMusic: true }));
    expect(plan.filter).toContain('duration=first');
  });

  it('delays a bed that does not start at zero', () => {
    let p = project({ withMusic: true });
    const bed = p.tracks[1].clips[0];
    p = updateClip(p, bed.id, { start: 2.5 });
    expect(exportPlan(p).filter).toContain('adelay=2500|2500');
  });

  it('no audio track means no mix stage at all', () => {
    const plan = exportPlan(project());
    expect(plan.filter).not.toContain('amix');
    expect(plan.args.join(' ')).toContain('[aout]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('speed', () => {
  it('chains atempo past 2x, because ffmpeg rejects atempo=4', () => {
    // Asserted as behaviour, not as an exact string: what ffmpeg cares about is
    // that no single stage leaves 0.5–2.0 and that the stages multiply out to
    // the speed asked for. Pinning the formatting would fail on "2" vs "2.0"
    // and teach nothing.
    for (const speed of [4, 8, 0.25, 1.5, 3, 0.4]) {
      const parts = atempoChain(speed).split(',').map((p) => Number(p.split('=')[1]));
      for (const rate of parts) {
        expect(rate, `atempo=${rate} is outside the range ffmpeg accepts`).toBeGreaterThanOrEqual(0.5);
        expect(rate).toBeLessThanOrEqual(2);
      }
      const product = parts.reduce((a, b) => a * b, 1);
      expect(product, `${speed}x came out as ${product}x — sound would drift from picture`).toBeCloseTo(speed, 3);
    }
    expect(atempoChain(1.5).split(',')).toHaveLength(1);   // no needless chaining
  });

  it('applies setpts and atempo together, or picture and sound drift apart', () => {
    let p = project();
    p = updateClip(p, p.tracks[0].clips[0].id, { speed: 2 });
    const filter = exportPlan(p).filter;
    expect(filter).toContain('setpts=PTS/2');
    expect(filter).toContain('atempo=2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('refusing to render nonsense', () => {
  it('an empty project is a problem, not an empty file', () => {
    __resetIds();
    const plan = exportPlan(createProject({}));
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toMatch(/nothing on the video track|empty/i);
  });

  it('a clip whose media has gone names the clip', () => {
    __resetIds();
    let p = createProject({});
    p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 'gone', name: 'shot 4', start: 0, in: 0, out: 3 }));
    const plan = exportPlan(p);
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' '), 'the customer cannot act on "export failed"').toContain('shot 4');
  });

  it('an unknown ratio is refused rather than guessed', () => {
    const plan = exportPlan(project(), { ratio: '13:7' });
    expect(plan.ok).toBe(false);
    expect(plan.problems.join(' ')).toContain('13:7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the output itself', () => {
  it('is web-playable: yuv420p, aac and faststart', () => {
    const args = exportPlan(project()).args.join(' ');
    expect(args).toContain('-pix_fmt yuv420p');
    expect(args).toContain('-c:a aac');
    expect(args, 'without faststart a hosted file buffers entirely before playing')
      .toContain('-movflags +faststart');
  });

  it('reshapes to the ratio asked for, not the project default', () => {
    const plan = exportPlan(project(), { ratio: '9:16' });
    expect(plan.dimensions).toEqual({ width: 1080, height: 1920 });
    expect(plan.filter).toContain('crop=1080:1920');
  });

  it('pad mode leaves black bars instead of cutting the frame', () => {
    expect(exportPlan(project(), { ratio: '9:16', mode: 'pad' }).filter).toContain('pad=1080:1920');
  });

  it('resamples everything to one rate', () => {
    expect(exportPlan(project()).filter).toContain(`aresample=${SAMPLE_RATE}`);
  });

  it('estimates pessimistically — beating the estimate is the good surprise', () => {
    expect(estimateSeconds(30, 1080)).toBe(120);
    expect(estimateSeconds(0)).toBeGreaterThanOrEqual(5);
  });
});
