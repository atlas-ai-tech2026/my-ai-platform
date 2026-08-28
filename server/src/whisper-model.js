// ─── whisper-model.js ────────────────────────────────────────────────────────
// Put the speech model in OUR bucket, once, so customers' browsers never talk
// to a third party to get it.
//
// ── WHY THIS RUNS ON THE SERVER ────────────────────────────────────────────
// Same reason as ensureMediaCors and ensureVersioning: the Spaces secret is
// write-only in the app config, so the server is the only thing that holds it.
// It cannot be done from a laptop, and I could not do it even if asked.
//
// ── WHY NOT LET THE BROWSER FETCH IT FROM HUGGINGFACE ──────────────────────
// Two reasons, and the second is the one that decided it.
//
// 1. The CSP would need HuggingFace added to connectSrc. The whole argument
//    for browser transcription is "the audio never leaves your computer";
//    reaching out to a third party on every first use undercuts the sentence
//    we would be selling to a B2B customer.
// 2. mediaConnectSources() ALREADY allows our own bucket. So hosting it
//    ourselves needs no CSP change at all — which is the same reasoning that
//    put ffmpeg-core.wasm on our own origin instead of unpkg.
//
// The alternative was fetching it during the build, and that would have made
// every production deploy depend on HuggingFace being reachable. A model
// download has no business being able to break a deploy.
//
// ── AND WHY THE MULTILINGUAL MODEL ─────────────────────────────────────────
// `whisper-tiny`, not `whisper-tiny.en`. The workshops are Arabic-speaking;
// an English-only model would transcribe the rooms this is FOR into nonsense.
// Tiny rather than base: it is the difference between roughly 40 MB and 150 MB
// on a laptop's first use, and accuracy can be revisited once anybody has
// actually used it.

/** Upstream. Only ever read, and only by the server. */
export const MODEL_ID = 'Xenova/whisper-tiny';
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;

/** Where it lives in our bucket. A prefix of its own, nowhere near
 *  `generations/` — nothing here can reach a customer's media. */
export const MODEL_PREFIX = 'models/whisper-tiny';

/**
 * Exactly what transformers.js asks for. Listed rather than discovered,
 * because a partial model is worse than none: it fails at run time, inside a
 * worker, with an error nobody can read.
 */
export const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'generation_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

export const keyFor = (file) => `${MODEL_PREFIX}/${file}`;

const typeFor = (file) => (file.endsWith('.json') ? 'application/json' : 'application/octet-stream');

/** Anything bigger than this is not a model file we asked for. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Fetch each file and store it, skipping whatever is already there.
 *
 * Every dependency injected, so this is testable without a network or a
 * bucket. Returns a plain report — no throwing, because a half-finished model
 * needs to be described rather than raised.
 *
 * @param deps.fetchImpl  fetch, for reading from HuggingFace
 * @param deps.exists     (key) => Promise<boolean|null>   null = could not tell
 * @param deps.put        (key, buf, contentType) => Promise<void>
 * @param deps.size       (key) => Promise<number|null>    read back after write
 */
export async function installModel({
  fetchImpl = fetch, exists, put, size, files = MODEL_FILES, force = false,
} = {}) {
  const stored = []; const skipped = []; const problems = [];
  let bytes = 0;

  for (const file of files) {
    const key = keyFor(file);
    try {
      if (!force) {
        const already = await exists(key);
        // null means "could not tell". Re-uploading costs a minute; assuming
        // a file is present when it is not produces a model that fails inside
        // a web worker, which is the hardest possible place to debug.
        if (already === true) { skipped.push(file); continue; }
      }

      const resp = await fetchImpl(`${HF_BASE}/${file}`);
      if (!resp.ok) throw new Error(`upstream responded ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length) throw new Error('upstream returned an empty file');
      if (buf.length > MAX_FILE_BYTES) throw new Error(`unexpectedly large (${buf.length} bytes)`);

      await put(key, buf, typeFor(file));

      // Read it back. A PUT that returns 200 and stores nothing would leave a
      // model that is broken only when a customer tries to use it.
      const back = await size(key);
      if (back === null) throw new Error('stored file could not be read back');
      if (back !== buf.length) throw new Error(`stored ${back} bytes, expected ${buf.length}`);

      stored.push(file);
      bytes += buf.length;
    } catch (e) {
      problems.push({ file, why: e?.message || String(e) });
    }
  }

  const mb = (b) => Math.round((b / 1048576) * 10) / 10;
  return {
    modelId: MODEL_ID,
    prefix: MODEL_PREFIX,
    stored: stored.length,
    skipped: skipped.length,
    failed: problems.length,
    problems,
    downloadedMB: mb(bytes),
    // The only line that matters. A model missing one file is not a model, and
    // "5 of 7 stored" reads like progress rather than like broken.
    complete: problems.length === 0 && (stored.length + skipped.length) === files.length,
  };
}

/** Is every file present? Used before offering transcription at all, so the
 *  feature is hidden rather than failing in front of a customer. */
export async function modelReady({ exists, files = MODEL_FILES } = {}) {
  for (const file of files) {
    // Only `true` counts. null — "could not tell" — must not read as present.
    if (await exists(keyFor(file)) !== true) return false;
  }
  return true;
}
