// ─── whisper-model.test.js ───────────────────────────────────────────────────
// Putting the speech model in our own bucket.
//
// The failure to design against is a PARTIAL model. Six of seven files stored
// reads like progress and behaves like a crash — inside a web worker, on a
// customer's machine, with an error nobody can act on. So most of these tests
// are about refusing to call that success.

import { describe, it, expect, vi } from 'vitest';
import {
  installModel, modelReady, keyFor, MODEL_FILES, MODEL_ID, MODEL_PREFIX, MAX_FILE_BYTES,
} from './whisper-model.js';

const body = (n = 512) => Buffer.alloc(n, 7);

/** A working HuggingFace, a working bucket, an honest read-back. */
function harness(over = {}) {
  const puts = [];
  const sizes = new Map();
  return {
    puts,
    deps: {
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => body() })),
      exists: vi.fn(async () => false),
      put: vi.fn(async (key, buf) => { puts.push({ key, bytes: buf.length }); sizes.set(key, buf.length); }),
      size: vi.fn(async (key) => (sizes.has(key) ? sizes.get(key) : null)),
      ...over,
    },
  };
}

describe('what it fetches, and from where', () => {
  it('uses the MULTILINGUAL model — the workshops are Arabic-speaking', () => {
    // whisper-tiny.en would transcribe the rooms this is FOR into nonsense.
    expect(MODEL_ID).toBe('Xenova/whisper-tiny');
    expect(MODEL_ID).not.toMatch(/\.en$/);
  });

  it('stores under its own prefix, nowhere near customer media', () => {
    expect(MODEL_PREFIX).toMatch(/^models\//);
    expect(keyFor('config.json')).not.toMatch(/generations/);
  });

  it('asks for a NAMED list, not whatever it finds', () => {
    // A partial model fails at run time inside a worker. The list is the
    // difference between "broken" and "not installed yet".
    expect(MODEL_FILES).toContain('config.json');
    expect(MODEL_FILES.some((f) => f.endsWith('.onnx'))).toBe(true);
  });
});

describe('the happy path', () => {
  it('stores every file and reports complete', async () => {
    const h = harness();
    const out = await installModel(h.deps);
    expect(out.stored).toBe(MODEL_FILES.length);
    expect(out.failed).toBe(0);
    expect(out.complete).toBe(true);
  });

  it('reads each file back after writing it', async () => {
    // A PUT that returns 200 and stores nothing leaves a model that breaks
    // only when a customer tries to use it.
    const h = harness();
    await installModel(h.deps);
    expect(h.deps.size).toHaveBeenCalledTimes(MODEL_FILES.length);
  });

  it('skips what is already there, so re-running is free', async () => {
    const h = harness({ exists: vi.fn(async () => true) });
    const out = await installModel(h.deps);
    expect(out.skipped).toBe(MODEL_FILES.length);
    expect(out.stored).toBe(0);
    expect(h.deps.put).not.toHaveBeenCalled();
    expect(out.complete).toBe(true);
  });

  it('re-uploads everything when forced', async () => {
    const h = harness({ exists: vi.fn(async () => true) });
    const out = await installModel({ ...h.deps, force: true });
    expect(out.stored).toBe(MODEL_FILES.length);
  });
});

describe('NEVER calling a partial model complete', () => {
  it('one failed download means not complete', async () => {
    let n = 0;
    const h = harness({
      fetchImpl: vi.fn(async () => {
        n += 1;
        if (n === 3) return { ok: false, status: 503, arrayBuffer: async () => Buffer.alloc(0) };
        return { ok: true, status: 200, arrayBuffer: async () => body() };
      }),
    });
    const out = await installModel(h.deps);
    expect(out.failed).toBe(1);
    expect(out.complete, 'six of seven files is not a model').toBe(false);
    expect(out.problems[0].why).toMatch(/503/);
  });

  it('a file stored at the wrong size is a failure, not a success', async () => {
    // A truncated upload reads back fine and is still wrong.
    const h = harness({ size: vi.fn(async () => 12) });
    const out = await installModel(h.deps);
    expect(out.complete).toBe(false);
    expect(out.problems[0].why).toMatch(/expected/);
  });

  it('a file that cannot be read back is a failure', async () => {
    const h = harness({ size: vi.fn(async () => null) });
    expect((await installModel(h.deps)).complete).toBe(false);
  });

  it('an empty download is refused rather than stored', async () => {
    const h = harness({ fetchImpl: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(0) })) });
    const out = await installModel(h.deps);
    expect(out.complete).toBe(false);
    expect(h.deps.put).not.toHaveBeenCalled();
  });

  it('refuses something absurdly large', async () => {
    const h = harness({ fetchImpl: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(MAX_FILE_BYTES + 1) })) });
    expect((await installModel(h.deps)).complete).toBe(false);
  });

  it('names every problem rather than only counting them', async () => {
    const h = harness({ fetchImpl: vi.fn(async () => { throw new Error('network down'); }) });
    const out = await installModel(h.deps);
    expect(out.problems).toHaveLength(MODEL_FILES.length);
    expect(out.problems[0]).toHaveProperty('file');
    expect(out.problems[0]).toHaveProperty('why');
  });

  it('re-uploads when it CANNOT TELL whether a file is there', async () => {
    // null is "could not tell". Assuming present would produce a model that
    // fails inside a web worker — the hardest place to debug there is.
    const h = harness({ exists: vi.fn(async () => null) });
    const out = await installModel(h.deps);
    expect(out.stored).toBe(MODEL_FILES.length);
  });
});

describe('is the model ready to offer at all', () => {
  it('true only when every file is present', async () => {
    expect(await modelReady({ exists: async () => true })).toBe(true);
  });

  it('false when one is missing', async () => {
    let n = 0;
    expect(await modelReady({ exists: async () => { n += 1; return n !== 4; } })).toBe(false);
  });

  it('false when it CANNOT TELL — never offered on a maybe', async () => {
    // The feature is hidden rather than failing in front of a customer.
    expect(await modelReady({ exists: async () => null })).toBe(false);
  });
});

describe('the exact-key upload cannot reach customer media', () => {
  // uploadPublicAt takes a key from its caller, so it CAN overwrite. That is
  // fine only while every caller points it somewhere harmless — and a comment
  // saying so is not a mechanism, which is the whole reason this file exists.
  it('every call site writes under models/, never generations/', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));

    const callers = fs.readdirSync(here)
      .filter((f) => f.endsWith('.js') && !f.includes('.test.') && f !== 'storage.js')
      .filter((f) => fs.readFileSync(path.join(here, f), 'utf8').includes('uploadPublicAt'));

    expect(callers.length, 'nothing calls it — this guard is watching nothing').toBeGreaterThan(0);

    for (const file of callers) {
      const src = fs.readFileSync(path.join(here, file), 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(src, `${file} passes a generations/ key to uploadPublicAt`)
        .not.toMatch(/uploadPublicAt\([^)]*generations/);
    }
  });

  it('the model prefix is not inside the media prefix', () => {
    expect(MODEL_PREFIX.startsWith('generations')).toBe(false);
  });
});
