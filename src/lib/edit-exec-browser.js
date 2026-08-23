// ─── edit-exec-browser.js ────────────────────────────────────────────────────
// Phase 1's executor: it runs the tool layer's operations with ffmpeg compiled
// to WebAssembly, on the customer's own computer.
//
// ── WHY THE CUSTOMER'S COMPUTER AND NOT THE SERVER ─────────────────────────
// Verified 2026-08-21, both halves:
//   · DigitalOcean's Node buildpack has NO ffmpeg. Adding it needs an Aptfile,
//     and DO's own docs warn some codecs land in directories the app cannot
//     reach.
//   · Production is 2 × apps-s-1vcpu-1gb. ffmpeg on those boxes competes with
//     Express for the single core, so a render would slow the live site for
//     everyone — to prove a feature nobody has asked for yet.
//
// Running it in the browser costs $0/month, changes nothing about the deploy,
// and cannot touch the API's responsiveness. Phase 2 moves the same operations
// to a dedicated worker once the counter says people actually edit; the
// contract in edit-ops.js does not change when it does. That is the whole
// reason the contract exists.
//
// ── WHAT THIS FILE IS CAREFUL ABOUT ────────────────────────────────────────
// 1. The core is 32 MB (~9.8 MB gzipped). It is fetched on the FIRST OPERATION,
//    never on page load — someone who opens /edit and looks around downloads
//    nothing. Browsing must stay free.
// 2. It is served from our own origin. The CSP has no CDN in connectSrc and
//    must not gain one.
// 3. Single-threaded core: the multi-threaded build needs SharedArrayBuffer,
//    which needs COOP/COEP, which would break the customer's own media served
//    from Spaces and break the Clarity tag.
// 4. Metered operations are REFUSED here rather than passed through. They are
//    FAL/kie calls that spend credits; a local executor silently accepting one
//    would be a charge with no provider behind it.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

import { argsFor, isLocal } from './edit-ffmpeg-args.js';
import { exportPlan } from './timeline-export.js';
import { validate, isMetered, OPERATIONS } from './edit-ops.js';

/** Where copy-ffmpeg-core.mjs puts the binary. Same origin, so CSP 'self' covers it. */
const CORE_BASE = '/ffmpeg';

let instance = null;
let loading = null;

// ── WHY PROGRESS GOES THROUGH A MUTABLE SLOT ───────────────────────────────
// ffmpeg.on('progress') can only be registered on a FFmpeg object, and that
// object is created once and cached for the whole session. Registering the
// caller's callback inside loadFFmpeg therefore only ever works for whoever
// happens to trigger the very first load: every later export gets the cached
// instance, skips the registration entirely, and reports nothing.
//
// That failure is invisible in a single run and invisible in a test that only
// exports once. The progress bar simply never moves on the second export, and
// a bar that does not move is indistinguishable from a hung render.
//
// So the handler is registered ONCE against this slot, and each run swaps the
// slot for the duration of its own work.
let progressSink = null;
const setProgressSink = (fn) => { progressSink = fn || null; };

/**
 * Load ffmpeg once per session, and only when it is actually needed.
 *
 * Concurrent callers share ONE load. Without that, clicking two tools quickly
 * starts two 32 MB downloads and instantiates two runtimes — on a phone that is
 * enough to have the tab killed for memory, which the customer experiences as
 * the site crashing rather than as an edit being slow.
 */
export async function loadFFmpeg({ onProgress } = {}) {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const ffmpeg = new FFmpeg();

    // ffmpeg's own stderr. Kept behind a flag because it is extremely noisy,
    // but reachable — the platform's rule is that no failure may arrive as a
    // generic message, and when a filter graph fails THIS is the only place
    // that says why.
    ffmpeg.on('log', ({ message }) => {
      if (typeof window !== 'undefined' && window.__VOXEL_FFMPEG_LOG) {
        console.debug('[ffmpeg]', message);
      }
    });

    // Registered unconditionally, exactly once, and forwarded to whichever run
    // currently owns the slot. See the note on progressSink above.
    ffmpeg.on('progress', ({ progress }) => {
      // ffmpeg reports > 1 and occasionally negative values near the end of a
      // stream. Clamped, because a progress bar that jumps to 340% reads as
      // broken software.
      progressSink?.(Math.min(1, Math.max(0, progress || 0)));
    });
    if (onProgress) setProgressSink(onProgress);

    // ── WHY load() IS RACED AGAINST A CLOCK ──────────────────────────────
    // ffmpeg.load() can NEVER RESOLVE AND NEVER REJECT. It happened here on
    // 2026-08-21: Vite's dependency optimiser rewrote the library's internal
    // worker URL to a path that 404s, the worker never started, and load()
    // simply sat there — no exception, no console error, no failed request to
    // notice. The try/catch below was useless because nothing was ever thrown.
    //
    // The root cause is fixed in vite.config.js (optimizeDeps.exclude), but a
    // promise that hangs forever is a whole CLASS of failure — a corrupt
    // download, a killed worker, an out-of-memory tab — and every one of them
    // presents to the customer as the button doing nothing at all. Silent
    // failures are bugs here, so the hang is converted into a message.
    const LOAD_TIMEOUT_MS = 120_000; // generous: 32 MB on a slow connection
    let timer;
    await Promise.race([
      (async () => {
        // ── BLOB URLs IN DEV, PLAIN PATHS IN PRODUCTION ────────────────
        // These two environments fail in OPPOSITE directions, which is why
        // this needs a branch rather than one answer.
        //
        // THE VITE DEV SERVER breaks the plain path. ffmpeg-core.js is
        // fetched as a module, so Vite appends `?import` and tries to
        // transform a 112 KB emscripten bundle. It fails with "Failed to
        // fetch dynamically imported module" — for a file that HEAD-requests
        // 200 with the right byte count. toBlobURL fetches the bytes itself
        // and hands over a blob: URL that nothing gets to rewrite. This is
        // what ffmpeg.wasm's own docs do, and it is dev-only advice.
        //
        // PRODUCTION breaks the BLOB. The built app is served by Express
        // under a real Content-Security-Policy, and script-src is
        // 'self' 'wasm-unsafe-eval' — no blob:. The worker's import() of a
        // blob: URL is refused, with the SAME "Failed to fetch dynamically
        // imported module" message, so the dev fix looks like the dev bug.
        //
        // Found 2026-08-23 by exporting on dev.voxel-ai.ai rather than on
        // localhost. It passed every test and worked perfectly against the
        // Vite dev server, because the dev server sends no CSP at all.
        //
        // The tempting fix is `blob:` in script-src. It is refused here:
        // blob: in script-src is a standard way to turn a small injection
        // into arbitrary script execution, and we would be widening the
        // policy for the whole site to avoid a branch in one file.
        //
        // Both paths are same-origin either way. No CDN is involved.
        const [coreURL, wasmURL] = import.meta.env?.DEV
          ? await Promise.all([
            toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
            toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
          ])
          : [`${CORE_BASE}/ffmpeg-core.js`, `${CORE_BASE}/ffmpeg-core.wasm`];
        return ffmpeg.load({ coreURL, wasmURL });
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `the editor engine did not start within ${LOAD_TIMEOUT_MS / 1000}s. `
          + 'This is usually a slow or interrupted connection — it downloads '
          + 'about 10 MB the first time.',
        )), LOAD_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));

    instance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (err) {
    // Let the next attempt retry rather than caching a failed load forever.
    loading = null;
    throw new Error(
      `The editor could not start: ${err?.message || err}. `
      + 'If this keeps happening, reload the page.',
    );
  } finally {
    loading = null;
  }
}

/** Has the runtime already been downloaded this session? Drives the UI's copy. */
export const isReady = () => instance !== null;

/**
 * Run one operation and return the result as a Blob.
 *
 * `sources` maps the names used in the operation to something fetchFile can
 * read — a URL, a File, or a Blob. The customer's clips are already in Spaces,
 * so in practice these are URLs and nothing is ever uploaded.
 */
export async function runOperation(op, { sources = {}, input, onProgress, quality = 1080 } = {}) {
  const name = typeof op === 'string' ? op : op?.op;
  const spec = OPERATIONS[name];

  if (!spec) throw new Error(`Unknown operation: ${name}`);

  // A metered operation reaching here is a routing bug, and the failure mode is
  // bad: it would look like an edit that quietly did nothing, on an action the
  // customer expects to have paid for. Named explicitly instead.
  if (isMetered(name)) {
    throw new Error(
      `"${spec.label}" is generated by a model and cannot run in the browser. `
      + 'It has to go through the API so the credits are recorded.',
    );
  }
  if (!isLocal(op)) throw new Error(`No local implementation for: ${name}`);

  const errors = validate(op);
  if (errors.length) throw new Error(errors.join(' '));

  const ffmpeg = await loadFFmpeg({ onProgress });

  const inName = 'in.mp4';
  const outName = `out.${name === 'volume' ? 'm4a' : 'mp4'}`;
  const built = argsFor(op, { input: inName, output: outName, quality });

  // Write every input the command declared. `built.inputs` is why the executor
  // never has to guess which arguments are file paths.
  const written = new Set();
  for (const src of built.inputs) {
    const key = src === inName ? '__input__' : src;
    const from = key === '__input__' ? input : (sources[src] ?? src);
    if (!from) throw new Error(`Missing file for "${src}".`);
    await ffmpeg.writeFile(src, await fetchFile(from));
    written.add(src);
  }

  try {
    await ffmpeg.exec(built.args);
    const data = await ffmpeg.readFile(outName);
    if (!data || data.length === 0) {
      throw new Error('ffmpeg produced an empty file.');
    }
    return {
      blob: new Blob([data.buffer], { type: outName.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4' }),
      note: built.note,
      bytes: data.length,
    };
  } finally {
    // ffmpeg.wasm keeps its virtual filesystem in memory for the whole session.
    // Without this, editing ten clips holds all ten plus every intermediate,
    // and the tab is killed for memory partway through — which the customer
    // reads as the site crashing, not as a memory limit.
    for (const f of written) await ffmpeg.deleteFile(f).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
  }
}

/**
 * Run several operations in order, each fed the previous one's output.
 *
 * Reports which STEP failed. "Step 3 of 5 (Watermark) failed: …" is actionable;
 * "ffmpeg error" is not, and the platform's standing rule is that an error must
 * name its cause.
 */
export async function runPlan(ops = [], { input, sources = {}, onProgress, onStep, quality = 1080 } = {}) {
  let current = input;
  const notes = [];

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    const label = OPERATIONS[typeof op === 'string' ? op : op?.op]?.label || 'Step';
    onStep?.({ index: i, total: ops.length, label });

    try {
      const result = await runOperation(op, {
        input: current,
        sources,
        quality,
        onProgress: onProgress
          ? (p) => onProgress((i + p) / ops.length)
          : undefined,
      });
      current = result.blob;
      notes.push(result.note);
    } catch (err) {
      throw new Error(
        `Step ${i + 1} of ${ops.length} (${label}) failed: ${err?.message || err}`,
      );
    }
  }

  return { blob: current, notes };
}

/**
 * Render a whole timeline to one MP4.
 *
 * Different in kind from runOperation: that runs one filter over one file,
 * this runs a single filter_complex graph over every source at once. It has to
 * be one pass — rendering clip by clip and concatenating afterwards re-encodes
 * every segment twice and doubles both the wait and the quality loss.
 *
 * The graph itself is built in timeline-export.js, which is pure and tested.
 * What lives here is the part that needs a browser: fetching the sources into
 * the virtual filesystem, reporting progress, and cleaning up after.
 */
export async function runExport(project, {
  ratio, quality = 1080, mode = 'crop', onProgress, onStage,
} = {}) {
  const plan = exportPlan(project, { ratio, quality, mode, output: 'export.mp4' });

  // Refuse BEFORE downloading 32 MB of runtime. Somebody with an empty
  // timeline should not wait for a WebAssembly download to be told so.
  if (!plan.ok) throw new Error(plan.problems.join(' '));

  onStage?.('Loading the video engine');
  const ffmpeg = await loadFFmpeg();

  const written = new Set();
  try {
    // Claim the progress slot for this run only. Set AFTER load so the 32 MB
    // download does not report itself as render progress — two different waits
    // sharing one bar is how a progress bar starts lying.
    setProgressSink(onProgress);
    for (const [i, input] of plan.inputs.entries()) {
      onStage?.(`Reading clip ${i + 1} of ${plan.inputs.length}`);
      let data;
      try {
        data = await fetchFile(input.url);
      } catch (err) {
        // A source url that has expired is the most likely failure in
        // production, and "export failed" would send the customer looking at
        // their edit rather than at the clip that went missing.
        throw new Error(`Could not read the media for one of the clips (${input.url}): ${err?.message || err}`);
      }
      await ffmpeg.writeFile(input.file, data);
      written.add(input.file);
    }

    onStage?.('Rendering');
    const code = await ffmpeg.exec(plan.args);
    if (code !== 0 && code !== undefined && code !== null) {
      throw new Error(`ffmpeg exited with code ${code}. The log above says why.`);
    }

    const data = await ffmpeg.readFile('export.mp4');
    if (!data || data.length === 0) throw new Error('The render produced an empty file.');

    return {
      blob: new Blob([data.buffer], { type: 'video/mp4' }),
      bytes: data.length,
      duration: plan.duration,
      dimensions: plan.dimensions,
      warnings: plan.warnings,
    };
  } finally {
    // Same reason as runOperation: the virtual filesystem lives for the whole
    // session, and a 40 MB source left behind is 40 MB the next export cannot
    // use. onProgress is unhooked here too so a cancelled run stops reporting.
    for (const f of written) await ffmpeg.deleteFile(f).catch(() => {});
    await ffmpeg.deleteFile('export.mp4').catch(() => {});
    // Release the slot, or a failed run keeps driving a bar that is gone.
    setProgressSink(null);
  }
}
