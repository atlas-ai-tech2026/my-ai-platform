// ─── whisper.js ──────────────────────────────────────────────────────────────
// Transcribe speech in the browser, with a model that DETECTS the language
// instead of being told one.
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
// Amr, twice: "I never think to choose the language", and then "please remove
// it, I don't need to see it." The browser's own recogniser genuinely cannot
// do this — it must be handed a language tag and will hear nothing else. That
// is the API, not a setting.
//
// So the picker came off the screen and the limitation went underneath it,
// which fixed what he could see and none of what he meant. Whisper is the
// actual answer: one multilingual model, no tag, and Arabic and English in the
// same sentence.
//
// ── WHAT IT COSTS, STATED BEFORE IT IS MEASURED ────────────────────────────
// ~43 MB on first use (39.6 MB model + ~3.1 MB gzipped runtime), cached for a
// year afterwards. And it transcribes AFTER you stop rather than as you speak,
// because that is what the model does — it is handed a finished clip.
//
// Whether that is acceptable is a measurement, not an opinion, which is why
// SpeechLab exists and why nothing here is wired to a customer's prompt box
// yet.
//
// ── EVERYTHING IS SERVED FROM OUR OWN ORIGIN ───────────────────────────────
// transformers.js defaults to fetching both the model and the WASM runtime
// from CDNs. Under this site's CSP that is refused — and refused INVISIBLY on
// a laptop, because Vite's dev server sends no CSP at all. That is precisely
// how Export shipped broken. So: the runtime comes from /onnx/ (copied out of
// node_modules at build time by scripts/copy-onnx-runtime.mjs) and the model
// from our own bucket or our own API.

import { pipeline, env } from '@huggingface/transformers';

/** Whisper wants 16 kHz mono, and will be quietly wrong given anything else. */
export const SAMPLE_RATE = 16000;

/** Where the model files live, in order of preference. */
export const SOURCES = {
  // The CDN. Free, fast, and absorbs a workshop's twenty first-uses without
  // touching our two 1-vCPU boxes. Needs the bucket to answer with
  // Access-Control-Allow-Origin — which on 2026-08-30 it did not.
  cdn: 'cdn',
  // Our own origin. Always works, no CORS involved, but every byte goes
  // through the same Express process that answers /api/generate.
  origin: 'origin',
};

/**
 * Can this browser run it at all?
 *
 * WebAssembly is the floor. Everything else — WebGPU, threads — is an
 * optimisation that onnxruntime decides for itself.
 */
export function whisperSupported(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  return typeof win.WebAssembly === 'object'
    && typeof win.AudioContext !== 'undefined'
    && Boolean(win.navigator?.mediaDevices?.getUserMedia);
}

/**
 * Is the bucket readable from script on this page?
 *
 * ── WHY THIS IS A REAL FETCH AND NOT A GUESS ───────────────────────────────
 * There is no way to ask a browser "would CORS allow this" — you try it. A
 * HEAD of the smallest file costs a few hundred bytes and answers definitively,
 * and it is the difference between a 43 MB download that fails at the end and
 * one that is never started.
 */
export async function cdnReadable(base, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  if (!base) return false;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${base}/models/whisper-tiny/config.json`, {
      method: 'GET', mode: 'cors', signal: stop.signal,
    });
    // Reading the body is the point: a browser will happily perform the request
    // and then refuse to let script see it. `r.ok` alone does not prove that.
    if (!r.ok) return false;
    await r.json();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Point transformers.js at us and nothing else. */
export function configure({ source, cdnBase, environment = env } = {}) {
  environment.allowLocalModels = false;
  environment.useBrowserCache = true;
  // The runtime, from our own origin. Without this it goes to jsDelivr and the
  // CSP refuses it — silently, on a page that worked on localhost.
  environment.backends.onnx.wasm.wasmPaths = '/onnx/';
  // Single-threaded, and not by choice: real threads need SharedArrayBuffer,
  // which needs COOP+COEP, which would break every cross-origin resource this
  // site embeds — including customers' own media. Same trade already made for
  // ffmpeg. It is a genuine part of why this is slower than a benchmark.
  environment.backends.onnx.wasm.numThreads = 1;

  environment.remoteHost = source === SOURCES.cdn
    ? `${cdnBase}/models/`
    : `${window.location.origin}/api/speech/model/`;
  // Our bucket has no {revision} directory — the files sit directly under the
  // model name — so the default '{model}/{revision}' template would 404 on
  // every file.
  environment.remotePathTemplate = '{model}';
  return environment;
}

/**
 * Build the transcriber. Slow exactly once per browser, then cached.
 *
 * @param onProgress ({file, loaded, total, progress}) => void
 */
export async function loadTranscriber({
  source, cdnBase, onProgress, build = pipeline, environment = env,
} = {}) {
  configure({ source, cdnBase, environment });
  return build('automatic-speech-recognition', 'whisper-tiny', {
    // Matches the files actually installed in the bucket:
    // encoder_model_quantized.onnx / decoder_model_merged_quantized.onnx.
    // Ask for anything else and it 404s on a file nobody uploaded.
    dtype: 'q8',
    progress_callback: onProgress,
  });
}

/**
 * Decode recorded audio to the mono 16 kHz Float32 Whisper expects.
 *
 * Kept separate from the recording so it can be tested, and so a fixed clip
 * can be measured repeatedly — a timing you cannot repeat is not a
 * measurement.
 */
export async function toMono16k(arrayBuffer, { AudioCtx } = {}) {
  const Ctx = AudioCtx
    || (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext));
  if (!Ctx) throw new Error('This browser cannot decode audio.');
  // Decoding at the target rate lets the browser resample in native code,
  // which is both faster and better than anything hand-written here.
  const ctx = new Ctx(1, 1, SAMPLE_RATE);
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  // Downmix. Whisper is mono; handing it one channel of a stereo recording
  // would throw away half of a quiet speaker.
  const left = decoded.getChannelData(0);
  const right = decoded.getChannelData(1);
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) out[i] = (left[i] + right[i]) / 2;
  return out;
}

/**
 * Transcribe.
 *
 * No `language` option, deliberately — omitting it is what makes Whisper
 * detect one, which is the entire reason for choosing it over the browser's
 * recogniser.
 */
export async function transcribe(transcriber, audio) {
  const out = await transcriber(audio, {
    // Long enough for a prompt said in one breath; Whisper's own window is 30s
    // and anything past it needs chunking, which costs accuracy at the seams.
    chunk_length_s: 30,
    return_timestamps: false,
  });
  return String(out?.text ?? '').trim();
}
