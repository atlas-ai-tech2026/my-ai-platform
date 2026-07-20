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
};

let KIE_KEY = '';

export function configureKie(key) {
  KIE_KEY = (key || '').trim();
}

function familySpec(family) {
  const spec = FAMILIES[family];
  if (!spec) throw new Error(`kie.ai: unknown model family "${family}"`);
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
    throw new Error(`kie.ai error: ${reason}`);
  }
  return json?.data ?? {};
}

// Create a generation task. Returns the taskId string.
export async function kieCreateTask(family, input, { tag = 'KIE' } = {}) {
  if (!KIE_KEY) throw new Error('KIE_KEY not configured');
  const spec = familySpec(family);
  console.log(`[${tag}] createTask ${family}:`, JSON.stringify(input).slice(0, 300));
  const data = await kieFetch(spec.create, { method: 'POST', body: input, tag });
  const taskId = data?.taskId;
  if (!taskId) throw new Error('kie.ai createTask returned no taskId');
  console.log(`[${tag}] ✅ taskId: ${taskId}`);
  return taskId;
}

// Query a task once. Returns { state: 'pending'|'success'|'fail', resultUrls,
// failMsg } — normalized across families.
export async function kieGetTask(family, taskId, { tag = 'KIE' } = {}) {
  if (!KIE_KEY) throw new Error('KIE_KEY not configured');
  const spec = familySpec(family);
  const data = await kieFetch(`${spec.status}?taskId=${encodeURIComponent(taskId)}`, { tag });

  // successFlag is the cross-family state field: 0=generating, 1=success,
  // 2=create failed, 3=generation failed.
  const flag = Number(data?.successFlag);
  if (flag === 1) {
    const resultUrls = spec.extract(data);
    if (!resultUrls.length) throw new Error('kie.ai task succeeded but returned no result URLs');
    return { state: 'success', resultUrls, failMsg: null };
  }
  if (flag === 2 || flag === 3) {
    return { state: 'fail', resultUrls: [], failMsg: data?.errorMessage || 'Generation failed at kie.ai' };
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
    if (t.state === 'fail') throw new Error(`kie.ai generation failed: ${t.failMsg}`);
    if (Date.now() + intervalMs > deadline) {
      // The task may still complete on kie's side after we give up — log so
      // occurrences are countable (we refund the user but ate the kie cost).
      console.error(`[${tag}] timeout-after-create taskId=${taskId} (${timeoutMs}ms)`);
      throw new Error(`kie.ai timed out after ${Math.round(timeoutMs / 1000)}s — credits refunded`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
