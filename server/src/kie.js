// ─── kie.js ──────────────────────────────────────────────────────────────────
// Thin HTTP client for kie.ai — the second model aggregator alongside FAL.
//
// kie.ai is plain REST with Bearer auth and an async task model: every family
// exposes POST .../generate → { data: { taskId } } and GET
// .../record-info?taskId= → { data: { successFlag, response/resultInfoJson,
// errorMessage } }. successFlag: 0 = generating, 1 = success, 2/3 = failed.
// Verified against docs.kie.ai (veo3-api, 4o-image-api, flux-kontext-api,
// mj-api) on 2026-07-20.
//
// IMPORTANT: index.js loads dotenv in its module body, but ES imports are
// hoisted — reading process.env.KIE_KEY at module load here would race the
// dotenv call and see it unset in local dev. So this module NEVER touches
// process.env; index.js calls configureKie(key) after dotenv, mirroring how
// fal.config() is called for FAL.
//
// Model routing lives in index.js (MODEL_CONFIG / VIDEO_DIRECT_MAP); this file
// only knows how to talk to kie.ai and normalize its per-family response
// shapes into one { state, resultUrls, failMsg }.

const BASE = 'https://api.kie.ai';

// family → endpoint pair + result extractor. Each family's record-info nests
// results differently; extract() returns an array of URL strings (possibly
// empty) from the `data` object.
const FAMILIES = {
  // GPT-4o image: response.resultUrls is string[]
  gpt4o: {
    create: '/api/v1/gpt4o-image/generate',
    status: '/api/v1/gpt4o-image/record-info',
    extract: (d) => d?.response?.resultUrls || [],
  },
  // Flux Kontext: response.resultImageUrl is a single string
  flux: {
    create: '/api/v1/flux/kontext/generate',
    status: '/api/v1/flux/kontext/record-info',
    extract: (d) => (d?.response?.resultImageUrl ? [d.response.resultImageUrl] : []),
  },
  // Midjourney: resultInfoJson (sometimes a JSON string) → resultUrls, whose
  // entries are either plain strings or { resultUrl } objects. One task
  // yields 4 images.
  mj: {
    create: '/api/v1/mj/generate',
    status: '/api/v1/mj/record-info',
    extract: (d) => {
      let info = d?.resultInfoJson ?? d?.response ?? null;
      if (typeof info === 'string') {
        try { info = JSON.parse(info); } catch { info = null; }
      }
      const urls = info?.resultUrls || [];
      return urls
        .map((u) => (typeof u === 'string' ? u : u?.resultUrl))
        .filter(Boolean);
    },
  },
  // Veo 3 video: response.resultUrls is string[]
  veo: {
    create: '/api/v1/veo/generate',
    status: '/api/v1/veo/record-info',
    extract: (d) => d?.response?.resultUrls || [],
  },
  // Unified Jobs API — the path for all newer "market" models (Nano Banana
  // Pro, GPT Image 2, Kling 3.0/2.6, Seedance 2.x, …). createTask takes
  // { model, input } (the caller builds that full body); record-info reports
  // state ('waiting'|'queuing'|'generating'|'success'|'fail') instead of
  // successFlag, and results come back in resultJson — a JSON STRING
  // containing { resultUrls }.
  jobs: {
    create: '/api/v1/jobs/createTask',
    status: '/api/v1/jobs/recordInfo',
    extract: (d) => {
      let rj = d?.resultJson;
      if (typeof rj === 'string') {
        try { rj = JSON.parse(rj); } catch { rj = null; }
      }
      return rj?.resultUrls || [];
    },
  },
};

let KIE_KEY = '';

export function configureKie(key) {
  KIE_KEY = (key || '').trim();
}

function familySpec(family) {
  const spec = FAMILIES[family];
  if (!spec) throw new Error(`generation service: unknown model family "${family}"`);
  return spec;
}

// Shared fetch wrapper: Bearer auth, JSON, bounded, and kie's error envelope
// ({ code, msg }) surfaced as a named Error so routes show the real reason.
async function kieFetch(path, { method = 'GET', body, signal, tag = 'KIE' } = {}) {
  const resp = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ?? AbortSignal.timeout(15000),
  });

  let json = null;
  try { json = await resp.json(); } catch { /* non-JSON error body */ }

  if (!resp.ok || (json && json.code !== 200)) {
    const reason = json?.msg || `HTTP ${resp.status}`;
    console.error(`[${tag}] kie.ai request failed: ${method} ${path} → ${reason}`);
    // Carry the status so callers can distinguish a definitive provider
    // rejection (4xx) from a transient failure (5xx / network) — refunds
    // must only fire on definitive failures.
    const e = new Error(`${reason}`);
    e.httpStatus = resp.status;
    e.kieCode = json?.code ?? null;
    throw e;
  }
  return json?.data ?? {};
}

// Upload a raw buffer to kie's file storage (base64 endpoint) and return its
// public download URL. This is how a data-URI reference becomes a URL that
// kie's generation models can fetch — kie models only accept http(s) urls in
// image inputs, never inline base64. Files auto-delete after ~3 days, which
// is fine for references (the generation fetches them within seconds); do
// NOT persist these urls anywhere durable. NOTE: this endpoint lives on a
// different host than the task API (kieai.redpandaai.co per docs.kie.ai —
// api.kie.ai 404s for it; verified 2026-07-25).
const UPLOAD_BASE = 'https://kieai.redpandaai.co';

export async function kieUploadBuffer(buf, contentType = 'image/png', { tag = 'KIE-UPLOAD' } = {}) {
  if (!KIE_KEY) throw new Error('Generation service is not configured on the server');
  if (!buf?.length) throw new Error('Empty file');
  const resp = await fetch(`${UPLOAD_BASE}/api/file-base64-upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64Data: `data:${contentType};base64,${buf.toString('base64')}`,
      uploadPath: 'images/references',
    }),
    signal: AbortSignal.timeout(30000),
  });
  let json = null;
  try { json = await resp.json(); } catch { /* non-JSON error body */ }
  const url = json?.data?.downloadUrl;
  if (!resp.ok || !url) {
    const reason = json?.msg || `HTTP ${resp.status}`;
    console.error(`[${tag}] base64 upload failed: ${reason}`);
    throw new Error(reason);
  }
  console.log(`[${tag}] ✅ reference uploaded → ${url}`);
  return url;
}

// Remaining credit balance on OUR kie.ai account. kie's "Get remaining
// credits" endpoint (docs.kie.ai) returns data as a plain number; tolerate
// an object shape too in case they wrap it later. Used by the admin API
// Usage page's balance widget — a failure here must never break anything
// else, so callers should catch.
export async function kieGetCredits({ tag = 'KIE-BALANCE' } = {}) {
  if (!KIE_KEY) throw new Error('kie.ai is not configured on the server');
  const data = await kieFetch('/api/v1/chat/credit', { tag });
  const credits = typeof data === 'number' ? data : Number(data?.credits ?? data?.balance);
  if (!Number.isFinite(credits)) throw new Error('kie.ai returned an unreadable balance');
  return credits;
}

// Create a generation task. Returns the taskId string.
export async function kieCreateTask(family, input, { tag = 'KIE' } = {}) {
  if (!KIE_KEY) throw new Error('Generation service is not configured on the server');
  const spec = familySpec(family);
  console.log(`[${tag}] createTask ${family}:`, JSON.stringify(input).slice(0, 300));
  const data = await kieFetch(spec.create, { method: 'POST', body: input, tag });
  const taskId = data?.taskId;
  if (!taskId) throw new Error('the request was not accepted — please try again');
  console.log(`[${tag}] ✅ taskId: ${taskId}`);
  return taskId;
}

// Query a task once. Returns { state: 'pending'|'success'|'fail', resultUrls,
// failMsg } — normalized across families. Dedicated families report
// successFlag (0 generating / 1 success / 2-3 failed); the Jobs API reports
// state ('waiting'|'queuing'|'generating'|'success'|'fail') with failMsg.
export async function kieGetTask(family, taskId, { tag = 'KIE' } = {}) {
  if (!KIE_KEY) throw new Error('Generation service is not configured on the server');
  const spec = familySpec(family);
  const data = await kieFetch(`${spec.status}?taskId=${encodeURIComponent(taskId)}`, { tag });

  const succeeded = typeof data?.state === 'string'
    ? data.state === 'success'
    : Number(data?.successFlag) === 1;
  const failed = typeof data?.state === 'string'
    ? data.state === 'fail'
    : (Number(data?.successFlag) === 2 || Number(data?.successFlag) === 3);

  if (succeeded) {
    const resultUrls = spec.extract(data);
    if (!resultUrls.length) throw new Error('no output was returned — please try again');
    return { state: 'success', resultUrls, failMsg: null };
  }
  if (failed) {
    return {
      state: 'fail',
      resultUrls: [],
      failMsg: data?.failMsg || data?.errorMessage || 'Generation failed',
    };
  }
  return { state: 'pending', resultUrls: [], failMsg: null };
}

// Poll until the task settles or the deadline hits. Used by the synchronous
// image path only (video polls via /api/video-status round-trips instead).
// Throws named errors so the route's catch can refund + surface the reason.
export async function kiePollUntilDone(family, taskId, { timeoutMs = 90_000, intervalMs = 3000, tag = 'KIE' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const t = await kieGetTask(family, taskId, { tag });
    if (t.state === 'success') return t;
    if (t.state === 'fail') throw new Error(t.failMsg || 'the model could not complete this generation');
    if (Date.now() + intervalMs > deadline) {
      // The task may still complete on kie's side after we give up — log so
      // occurrences are countable.
      console.error(`[${tag}] timeout-after-create taskId=${taskId} (${timeoutMs}ms)`);
      // `gaveUp` separates OUR IMPATIENCE from the provider actually failing,
      // and callers must be able to tell them apart: one deserves a hand-off,
      // the other a refund. Matching on the message would have been the third
      // string-matching bug of the week.
      //
      // On 2026-08-28 this path refunded six customers whose images had all
      // succeeded (94–314s). The message it used to carry — "we stopped and
      // refunded your credits" — is now only true if nothing catches this.
      const e = new Error('the image is taking longer than expected — it will keep going and appear when it is ready');
      e.gaveUp = true;
      e.taskId = taskId;
      throw e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
