// ─── whisper.test.js ─────────────────────────────────────────────────────────
// The browser-side speech model.
//
// Most of this file guards ONE property, and it is not about transcription:
//
//   NOTHING IS EVER FETCHED FROM A THIRD-PARTY CDN.
//
// transformers.js defaults to jsDelivr for the runtime and HuggingFace for the
// model. Under this site's CSP both are refused — and refused INVISIBLY on a
// laptop, because Vite's dev server sends no CSP at all. That exact gap
// shipped a broken Export to every user of dev once already. A unit test is
// not proof of CSP behaviour, but it does make the default impossible to
// re-inherit by accident, which is the part that bit us.

import { describe, it, expect, vi } from 'vitest';
import { configure, cdnReadable, whisperSupported, SOURCES, SAMPLE_RATE } from './whisper.js';

/** A stand-in for transformers.js's `env`, shaped like the real one. */
const fakeEnv = () => ({
  allowLocalModels: true,
  useBrowserCache: false,
  remoteHost: 'https://huggingface.co/',
  remotePathTemplate: '{model}/{revision}',
  backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/', numThreads: 4 } } },
});

describe('☠ NOTHING COMES FROM A THIRD-PARTY CDN', () => {
  it('the WASM runtime is pulled from our own origin', () => {
    const env = fakeEnv();
    configure({ source: SOURCES.origin, environment: env });
    expect(env.backends.onnx.wasm.wasmPaths).toBe('/onnx/');
    expect(env.backends.onnx.wasm.wasmPaths).not.toMatch(/jsdelivr|unpkg|cdn\./);
  });

  it('the model host is never huggingface, on either source', () => {
    for (const source of [SOURCES.cdn, SOURCES.origin]) {
      const env = fakeEnv();
      configure({ source, cdnBase: 'https://voxel-ai-store.nyc3.cdn.digitaloceanspaces.com', environment: env });
      expect(env.remoteHost).not.toMatch(/huggingface/i);
    }
  });

  it('local model files are refused, so a missing file cannot be papered over', () => {
    const env = fakeEnv();
    configure({ source: SOURCES.origin, environment: env });
    expect(env.allowLocalModels).toBe(false);
  });
});

describe('where the model is actually asked for', () => {
  it('the CDN path lands on our bucket prefix', () => {
    const env = fakeEnv();
    configure({ source: SOURCES.cdn, cdnBase: 'https://bucket.example', environment: env });
    // remoteHost + template + file must produce models/whisper-tiny/config.json
    expect(`${env.remoteHost}whisper-tiny/config.json`)
      .toBe('https://bucket.example/models/whisper-tiny/config.json');
  });

  it('the template has no {revision} — our bucket has no such directory', () => {
    // The default '{model}/{revision}' would 404 on every single file, which
    // surfaces inside a web worker as an unreadable error.
    const env = fakeEnv();
    configure({ source: SOURCES.cdn, cdnBase: 'https://bucket.example', environment: env });
    expect(env.remotePathTemplate).toBe('{model}');
    expect(env.remotePathTemplate).not.toMatch(/revision/);
  });

  it('threads are pinned to 1, because COOP+COEP would break customer media', () => {
    const env = fakeEnv();
    configure({ source: SOURCES.origin, environment: env });
    expect(env.backends.onnx.wasm.numThreads).toBe(1);
  });
});

describe('☠ THE CORS CHECK MUST READ THE BODY, NOT JUST THE STATUS', () => {
  it('a response that cannot be read counts as NOT readable', () => {
    // A browser will happily perform the request and then refuse to let script
    // see it. Trusting `r.ok` would start a 43 MB download that fails at the
    // very end — which is exactly the shape the dev bucket was in on
    // 2026-08-30: 200, Vary: Origin, and no allow-origin header.
    const fetchImpl = async () => ({ ok: true, json: async () => { throw new TypeError('Failed to fetch'); } });
    return expect(cdnReadable('https://bucket.example', { fetchImpl })).resolves.toBe(false);
  });

  it('a real readable answer counts as readable', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ model_type: 'whisper' }) });
    await expect(cdnReadable('https://bucket.example', { fetchImpl })).resolves.toBe(true);
  });

  it('a 403 is not readable', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(cdnReadable('https://bucket.example', { fetchImpl })).resolves.toBe(false);
  });

  it('never throws — a thrown check would take the prompt box with it', async () => {
    const fetchImpl = async () => { throw new Error('network'); };
    await expect(cdnReadable('https://bucket.example', { fetchImpl })).resolves.toBe(false);
    await expect(cdnReadable(null, { fetchImpl })).resolves.toBe(false);
    await expect(cdnReadable('', { fetchImpl })).resolves.toBe(false);
  });

  it('asks for the SMALLEST file, not the 29 MB one', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await cdnReadable('https://bucket.example', { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/config\.json$/);
    expect(fetchImpl.mock.calls[0][0]).not.toMatch(/\.onnx$/);
  });
});

describe('support detection', () => {
  it('says no when there is no window at all', () => {
    expect(whisperSupported(undefined)).toBe(false);
  });

  it('needs WebAssembly, audio AND a microphone — not one of the three', () => {
    const full = {
      WebAssembly: {}, AudioContext: function () {},
      navigator: { mediaDevices: { getUserMedia: () => {} } },
    };
    expect(whisperSupported(full)).toBe(true);
    expect(whisperSupported({ ...full, WebAssembly: undefined })).toBe(false);
    expect(whisperSupported({ ...full, AudioContext: undefined })).toBe(false);
    expect(whisperSupported({ ...full, navigator: {} })).toBe(false);
  });
});

describe('the audio Whisper is handed', () => {
  it('is 16 kHz — anything else is quietly wrong rather than an error', () => {
    expect(SAMPLE_RATE).toBe(16000);
  });
});
