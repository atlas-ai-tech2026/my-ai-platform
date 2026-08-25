// ─── media-library.test.js ───────────────────────────────────────────────────
// Two things are pinned here.
//
// The first is the metadata crossing intact. If the prompt, the model id or the
// camera block is lost on the way onto the timeline, nothing throws — the
// editor just quietly becomes an ordinary editor, and "regenerate this shot"
// becomes impossible for a reason nobody can see.
//
// The second is that a duration is never invented. A wrong out point does not
// error either; it ends the export in black, or cuts the shot off, and both are
// discovered after the file has been sent to somebody.

import { describe, it, expect } from 'vitest';
import {
  usability, kindOf, durationOf, toSource, labelFor, orderForLibrary, measureDuration, canRegenerate, regenerationRequest, filterLibrary, modelsPresent, LIBRARY_SORTS,
} from './media-library.js';

const record = (over = {}) => ({
  id: 'g-1',
  type: 'video',
  status: 'completed',
  result_url: 'https://store.example/v1.mp4',
  prompt: 'a yellow race car on a circuit at golden hour, low angle',
  model: 'Seedance 2.5',
  model_id: 'kie:seedance-2-5',
  ratio: '16:9',
  duration: 5,
  camera: 'ARRI Alexa 35',
  lens: 'Zeiss Supreme Prime',
  lens_type: 'prime',
  focal_length: '35mm',
  fstop: 'f/1.8',
  created_date: '2026-08-20T10:00:00Z',
  ...over,
});

describe('the metadata that makes this not an ordinary editor', () => {
  it('carries the prompt, the model and the whole camera block onto the timeline', () => {
    const s = toSource(record());
    expect(s.prompt).toMatch(/yellow race car/);
    expect(s.model).toBe('Seedance 2.5');
    expect(s.model_id, 'without model_id a shot can never be remade').toBe('kie:seedance-2-5');
    expect(s).toMatchObject({
      camera: 'ARRI Alexa 35',
      lens: 'Zeiss Supreme Prime',
      lens_type: 'prime',
      focal_length: '35mm',
      fstop: 'f/1.8',
    });
  });

  it('keeps a link back to the generation it came from', () => {
    expect(toSource(record()).generation_id).toBe('g-1');
  });

  it('does NOT spread the raw record into the saved project', () => {
    // A source is persisted in every autosave. Spreading would carry job ids
    // and statuses into the document and tie it to an API response shape that
    // is free to change underneath it.
    const s = toSource(record({ job_id: 'job-xyz', status: 'completed', internal_note: 'x' }));
    expect(s.job_id).toBeUndefined();
    expect(s.status).toBeUndefined();
    expect(s.internal_note).toBeUndefined();
  });

  it('a source with a prompt and a model can be regenerated; one without cannot', () => {
    expect(canRegenerate(toSource(record()))).toBe(true);
    expect(canRegenerate(toSource(record({ model_id: null })))).toBe(false);
    expect(canRegenerate(toSource(record({ prompt: '' })))).toBe(false);
    expect(canRegenerate(null)).toBe(false);
  });
});

describe('remaking a shot changes the prompt and NOTHING else', () => {
  it('carries every setting forward so the clip still fits its hole', () => {
    // Drop the ratio or the duration and the new clip comes back a different
    // shape, no longer matching the edit built around it.
    const req = regenerationRequest(toSource(record()), { prompt: 'the same car at night' });
    expect(req.prompt).toBe('the same car at night');
    expect(req.model_id).toBe('kie:seedance-2-5');
    expect(req.ratio).toBe('16:9');
    expect(req.camera).toBe('ARRI Alexa 35');
    expect(req.focal_length).toBe('35mm');
  });

  it('keeps the original prompt when none is given', () => {
    expect(regenerationRequest(toSource(record())).prompt).toMatch(/yellow race car/);
  });

  it('refuses rather than sending a request that cannot work', () => {
    expect(regenerationRequest(toSource(record({ model_id: null })), { prompt: 'x' })).toBe(null);
  });
});

describe('a duration is measured or absent — never guessed', () => {
  it('reads a real duration', () => {
    expect(durationOf(record())).toBe(5);
  });

  it('returns null rather than a default when it is unknown', () => {
    // The tempting default is 5, or 10. Either one silently produces a wrong
    // out point, which the export turns into black or a truncated shot.
    for (const bad of [undefined, null, 0, -3, 'abc', NaN]) {
      expect(durationOf(record({ duration: bad })), `${bad} became a number`).toBe(null);
    }
  });
});

describe('measuring a duration the record does not carry', () => {
  const fakeVideo = (behaviour) => () => {
    const el = { preload: '', muted: false, onloadedmetadata: null, onerror: null, duration: NaN };
    Object.defineProperty(el, 'src', {
      set() { setTimeout(() => behaviour(el), 0); },
    });
    return el;
  };

  it('reads the real length from the media', async () => {
    const d = await measureDuration('x.mp4', {
      createVideo: fakeVideo((el) => { el.duration = 7.5; el.onloadedmetadata(); }),
    });
    expect(d).toBe(7.5);
  });

  it('an unreadable file resolves to null rather than hanging or throwing', async () => {
    const d = await measureDuration('gone.mp4', {
      createVideo: fakeVideo((el) => el.onerror()),
    });
    expect(d).toBe(null);
  });

  it('Infinity is not a duration', async () => {
    // A stream with no declared length reports Infinity, and it must never
    // become an out point.
    const d = await measureDuration('live.mp4', {
      createVideo: fakeVideo((el) => { el.duration = Infinity; el.onloadedmetadata(); }),
    });
    expect(d).toBe(null);
  });

  it('gives up rather than spinning forever', async () => {
    // An expired link does not always error promptly. Without the timeout the
    // card spins with no explanation, which reads as the site being broken.
    const d = await measureDuration('stuck.mp4', {
      createVideo: () => ({ preload: '', muted: false, onloadedmetadata: null, onerror: null }),
      timeoutMs: 10,
    });
    expect(d).toBe(null);
  });
});

describe('what can and cannot go on the timeline', () => {
  it('a completed generation with a file is usable', () => {
    expect(usability(record()).ok).toBe(true);
  });

  it('names each unusable state instead of just refusing', () => {
    expect(usability(record({ status: 'pending' }))).toMatchObject({ ok: false, reason: 'pending' });
    expect(usability(record({ status: 'failed' }))).toMatchObject({ ok: false, reason: 'failed' });
    expect(usability(null)).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('a completed generation whose file has gone says SO, not "nothing here"', () => {
    // The expired-link case. The customer can see the item in their history,
    // so silence would read as our bug rather than as a link that has expired.
    const u = usability(record({ result_url: null }));
    expect(u.reason).toBe('no-file');
    expect(u.label).toMatch(/no longer available/i);
  });
});

describe('kind', () => {
  it('trusts the record type', () => {
    expect(kindOf(record({ type: 'image' }))).toBe('image');
    expect(kindOf(record({ type: 'video' }))).toBe('video');
  });

  it('falls back to the extension rather than assuming video', () => {
    // An image added as a video decodes to nothing at all.
    expect(kindOf({ result_url: 'https://s/x.png' })).toBe('image');
    expect(kindOf({ result_url: 'https://s/x.jpg?sig=abc' })).toBe('image');
    expect(kindOf({ result_url: 'https://s/x.mp4' })).toBe('video');
  });
});

describe('the library list', () => {
  it('is newest first', () => {
    const out = orderForLibrary([
      record({ id: 'old', created_date: '2026-08-01T00:00:00Z' }),
      record({ id: 'new', created_date: '2026-08-20T00:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('pushes unusable items last but NEVER removes them', () => {
    // A library that simply does not contain a failed generation reads as lost
    // work. The customer knows they made it.
    const out = orderForLibrary([
      record({ id: 'broken', status: 'failed', created_date: '2026-08-21T00:00:00Z' }),
      record({ id: 'fine', created_date: '2026-08-20T00:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['fine', 'broken']);
    expect(out, 'a failed generation was dropped from the library').toHaveLength(2);
  });

  it('labels a card with the prompt, truncated', () => {
    expect(labelFor(record(), 20)).toHaveLength(20);
    expect(labelFor(record({ prompt: '' }))).toBe('Seedance 2.5');
  });
});

// ─── SEARCHING THE LIBRARY ───────────────────────────────────────────────────
// The library is the differentiator — the customer's own generations, carrying
// the prompt that made them. Until 2026-08-23 the only way through it was
// scrolling, which stops working somewhere around the fiftieth video.

const rec = (over = {}) => ({
  id: 'r1', type: 'video', status: 'completed', result_url: 'https://s/v.mp4',
  prompt: 'a dragon over a castle', model: 'Kling 3.0', duration: 5,
  created_date: '2026-08-20T00:00:00Z', ...over,
});

describe('finding one among hundreds', () => {
  const lib = () => [
    rec({ id: 'a', prompt: 'a dragon over a castle', model: 'Kling 3.0', duration: 5,  created_date: '2026-08-20T00:00:00Z' }),
    rec({ id: 'b', prompt: 'a race car at golden hour', model: 'Seedance 2.5', duration: 12, created_date: '2026-08-22T00:00:00Z' }),
    rec({ id: 'c', prompt: 'a quiet street at dawn',   model: 'Kling 3.0', duration: 8,  created_date: '2026-08-21T00:00:00Z' }),
  ];

  it('searches the PROMPT, which is how anybody remembers a shot', () => {
    // "the castle one" — not "the third Kling from Tuesday".
    expect(filterLibrary(lib(), { query: 'castle' }).map((r) => r.id)).toEqual(['a']);
  });

  it('searches the model too', () => {
    expect(filterLibrary(lib(), { query: 'seedance' }).map((r) => r.id)).toEqual(['b']);
  });

  it('ignores case and surrounding space', () => {
    expect(filterLibrary(lib(), { query: '  DRAGON ' }).map((r) => r.id)).toEqual(['a']);
  });

  it('filters by model', () => {
    expect(filterLibrary(lib(), { model: 'Kling 3.0' }).map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  it('sorts newest first by default', () => {
    expect(filterLibrary(lib()).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts oldest and longest', () => {
    expect(filterLibrary(lib(), { sort: 'oldest' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(filterLibrary(lib(), { sort: 'longest' }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('does NOT reorder the array it was given', () => {
    // Mutating it would reorder the records held in state, and the next render
    // would disagree with this one.
    const src = lib();
    const before = src.map((r) => r.id);
    filterLibrary(src, { sort: 'longest' });
    expect(src.map((r) => r.id)).toEqual(before);
  });

  it('keeps a FAILED generation visible unless you ask otherwise', () => {
    // The customer remembers making it. A list that silently omits it reads as
    // lost work, not as a known state.
    const withFailed = [...lib(), rec({ id: 'x', status: 'failed', result_url: null })];
    expect(filterLibrary(withFailed).map((r) => r.id)).toContain('x');
    expect(filterLibrary(withFailed, { readyOnly: true }).map((r) => r.id)).not.toContain('x');
  });

  it('offers only the models that are actually there', () => {
    // A chip that can only ever return nothing is a wasted click.
    expect(modelsPresent(lib())).toEqual(['Kling 3.0', 'Seedance 2.5']);
  });

  it('survives an empty library and rubbish input', () => {
    expect(filterLibrary([])).toEqual([]);
    expect(filterLibrary(undefined)).toEqual([]);
    expect(filterLibrary(lib(), { sort: 'nonsense' })).toHaveLength(3);
    expect(modelsPresent()).toEqual([]);
  });
});

describe('a RECORDING declares no length', () => {
  // The bug behind "the recording, it's cutting" — 2026-08-25.
  //
  // MediaRecorder writes WebM as a stream, so the header carries no Duration
  // element and the browser reports Infinity. measureDuration correctly
  // refused Infinity, the caller fell back to a constant 1, and every take
  // arrived on the timeline as a ONE SECOND clip however long you had talked.
  //
  // Seeking absurdly far forces the browser to scan to the last cluster, and
  // only then is duration real.
  const fakeVideo = (duration, afterSeek) => {
    const el = {
      preload: '', muted: false, duration, _src: '',
      set src(v) { el._src = v; setTimeout(() => el.onloadedmetadata?.(), 0); },
      get src() { return el._src; },
      set currentTime(_v) {
        el.duration = afterSeek;
        setTimeout(() => el.onseeked?.(), 0);
      },
    };
    return el;
  };

  it('reads the real length after the probe seek', async () => {
    const el = fakeVideo(Infinity, 42.5);
    await expect(measureDuration('blob:x', { createVideo: () => el, probeUnsized: true }))
      .resolves.toBe(42.5);
  });

  it('does NOT probe unless asked — every other caller is a finished file', async () => {
    // An extra seek on each library item would be waste, and the existing
    // contract (null for an unmeasurable stream) has to keep holding.
    const el = fakeVideo(Infinity, 42.5);
    await expect(measureDuration('blob:x', { createVideo: () => el }))
      .resolves.toBeNull();
  });

  it('still answers null when even the probe cannot tell', async () => {
    // Then the caller uses how long the take actually ran — never a constant.
    const el = fakeVideo(Infinity, Infinity);
    await expect(measureDuration('blob:x', { createVideo: () => el, probeUnsized: true }))
      .resolves.toBeNull();
  });

  it('does not probe a file that already declares a length', async () => {
    let seeked = false;
    const el = fakeVideo(12, 99);
    Object.defineProperty(el, 'currentTime', { set() { seeked = true; } });
    await expect(measureDuration('blob:x', { createVideo: () => el, probeUnsized: true }))
      .resolves.toBe(12);
    expect(seeked).toBe(false);
  });
});
