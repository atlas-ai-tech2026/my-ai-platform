// ─── llm.js ──────────────────────────────────────────────────────────────────
// One place to ask a text model a question.
//
// ── WHY THIS EXISTS (#76, 2026-08-24) ──────────────────────────────────────
// Two features send text to an LLM: the prompt Enhance buttons on /Image and
// /Video, and the Voxel Edit Cut agent. Both called
// `falSubscribe('fal-ai/any-llm', { model: 'google/gemini-flash-1.5' })`,
// copy-pasted, and FAL now answers 403 Forbidden — the key is present on both
// apps (checked in the DigitalOcean spec) but the account rejects the call.
//
// So the agent was dead, and Enhance was dead the same way for the same
// reason. The owner reported the agent; nobody had pressed Enhance.
//
// ── WHY KIE AND NOT A NEW PROVIDER ─────────────────────────────────────────
// The obvious move was a direct Gemini or OpenAI key. It was the wrong one:
// kie.ai — which the platform already pays for and already has a key for —
// carries 27 chat models, including gemini-3-7-flash, GPT-5.6 and Claude
// Sonnet 5, on an OpenAI-compatible /api/v1/chat/completions. Read from their
// public catalogue, not assumed. So this needs NO new account, NO new key and
// NO new dependency — plain fetch, which Node has.
//
// ── FAL IS KEPT, DELIBERATELY ──────────────────────────────────────────────
// Build before you delete. FAL stays reachable behind LLM_PROVIDER=fal so a
// revived key still works and there is something to fall back to if kie's
// chat endpoint disappoints. Removing the only working-in-principle path
// while standing up its replacement is how you end up with neither.
//
// ── WHAT IS NOT VERIFIED, AND SAYING SO ────────────────────────────────────
// kie's chat endpoint EXISTS — probing it unauthenticated returns their
// {code:401} envelope, while a made-up sibling path returns a plain 404, so
// routing is real. What I could NOT check without a live key is the exact
// model-id string and the exact success shape. Their catalogue gives slugs
// (`gemini-3-7-flash`), which are probably but not certainly the API ids.
//
// Hence: the model is an env var, extraction accepts every shape this family
// of API realistically returns, and a rejected model NAMES the model in the
// error instead of failing as a mystery. One real call on dev settles it.

const KIE_BASE = 'https://api.kie.ai';

/**
 * kie puts the MODEL IN THE PATH, not in the body: /gemini-3-pro/v1/chat/completions
 *
 * This is the thing that broke the first attempt, and it is worth writing down
 * because the failure looked like something else entirely. I called the
 * generic /api/v1/chat/completions, which EXISTS — so it did not 404 — and
 * answered "This feature is currently not supported". That reads like a plan
 * or entitlement problem, and I would have gone asking about the account.
 *
 * It also means my probe was worthless: every path under this prefix returns
 * kie's 401 envelope, INCLUDING a model slug I invented. Auth is checked
 * before routing here, so "it 401s, therefore it exists" — which held on the
 * /api/v1/ paths — is false on this one. The docs are the authority.
 */
const kieChatPath = (model) => `/${encodeURIComponent(model)}/v1/chat/completions`;

/**
 * ⚠️ NOT EVERY kie CHAT MODEL SPEAKS THIS PROTOCOL. They ship models in two
 * flavours and the catalogue does not distinguish them:
 *
 *   OpenAI-compatible   /gemini-2.5-flash/v1/chat/completions      ← this module
 *   native vendor       /gemini/v1/models/gemini-3-7-flash:streamGenerateContent
 *
 * gemini-3-7-flash — the newest flash, and my first default purely because it
 * was newest — is the SECOND kind. It would have failed here no matter how
 * right the path shape was. Their docs mark the compatible ones "(openai)".
 *
 * So: before changing LLM_MODEL, open docs.kie.ai/market/<vendor>/<model> and
 * check the endpoint really ends in /v1/chat/completions. The slug in the
 * catalogue tells you the model exists, NOT how to call it.
 *
 * gemini-2.5-flash is documented OpenAI-compatible, cheap, and fast enough for
 * turning one sentence into a few JSON commands. Note the DOTS — newer slugs
 * use dashes (gemini-3-pro) and older ones dots, and it is not cosmetic, it is
 * the URL. Overridable with LLM_MODEL.
 */
const DEFAULT_MODEL = 'gemini-2.5-flash';

let cfg = { kieKey: null, falKey: null, falSubscribe: null, provider: null, model: null };

/**
 * Wire up the providers. Called once from index.js so this module stays
 * importable — and testable — without booting a server or holding a key.
 */
export function configureLlm({ kieKey, falKey, falSubscribe, provider, model } = {}) {
  cfg = {
    kieKey: kieKey || null,
    falKey: falKey || null,
    falSubscribe: falSubscribe || null,
    provider: provider || null,
    model: model || null,
  };
}

/**
 * Which provider will actually be used, and whether it can run at all.
 * Exported so /api/ready and the control panel can show it without making a
 * billable call — "is the assistant configured" should never cost anything.
 */
export function llmConfig() {
  const model = cfg.model || DEFAULT_MODEL;

  // An explicit choice wins, even when it cannot run — silently falling back
  // to the other provider would hide a misconfiguration behind a bill.
  if (cfg.provider === 'kie') {
    return { provider: 'kie', model, ready: Boolean(cfg.kieKey),
      why: cfg.kieKey ? null : 'LLM_PROVIDER=kie but KIE_KEY is not set' };
  }
  if (cfg.provider === 'fal') {
    return { provider: 'fal', model: 'google/gemini-flash-1.5', ready: Boolean(cfg.falKey && cfg.falSubscribe),
      why: cfg.falKey ? null : 'LLM_PROVIDER=fal but FAL_KEY is not set' };
  }

  if (cfg.kieKey) return { provider: 'kie', model, ready: true, why: null };
  if (cfg.falKey && cfg.falSubscribe) {
    return { provider: 'fal', model: 'google/gemini-flash-1.5', ready: true, why: null };
  }
  return { provider: null, model, ready: false, why: 'no LLM provider configured (set KIE_KEY)' };
}

/**
 * Pull the answer out of whatever the provider sent back.
 *
 * Deliberately generous. kie proxies OpenAI, Google and Anthropic models
 * behind one endpoint, and those three do not agree on where the text lives —
 * Anthropic returns `content` as an ARRAY of parts, OpenAI a string, and kie
 * may or may not wrap the lot in its own `data` envelope. Guessing one shape
 * and getting it wrong reads as "the assistant did not answer", which sends
 * you looking at the prompt instead of the parser.
 */
export function extractText(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload.trim();

  // kie wraps some responses in { code, msg, data: {...} }.
  const body = payload.data && typeof payload.data === 'object' ? payload.data : payload;

  const choice = body?.choices?.[0];
  const candidates = [
    choice?.message?.content,
    choice?.delta?.content,
    choice?.text,
    body?.message?.content,
    body?.content,
    body?.output,
    body?.text,
    // FAL's any-llm puts it here.
    payload?.data?.output,
    payload?.output,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    // Anthropic-style content parts: [{ type: 'text', text: '…' }]
    if (Array.isArray(c)) {
      const joined = c
        .map((part) => (typeof part === 'string' ? part : part?.text || ''))
        .join('')
        .trim();
      if (joined) return joined;
    }
  }
  return '';
}

/** kie reports failure two ways: a non-2xx status, or 200 with {code: 4xx}.
 *  Both must raise, and both must carry the status so callers can tell a
 *  provider refusing us (401/403) from a bug on our side. */
function kieError(status, reason, model) {
  const e = new Error(reason);
  e.httpStatus = status;
  e.body = reason;
  e.llmModel = model;
  return e;
}

/**
 * Ask the configured model a question. Returns the answer as a string.
 *
 * @param {string}   system     system prompt (optional)
 * @param {string}   prompt     the user turn
 * @param {string}   tag        log prefix, e.g. 'EDIT-AGENT'
 * @param {number}   timeoutMs  hard deadline — a hung provider must not hold
 *                              the request, and its database connection, open
 * @param {Function} fetchImpl  injectable for tests
 */
export async function llmText({ system, prompt, tag = 'LLM', timeoutMs = 45_000, fetchImpl } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error('llmText: prompt is required');

  const { provider, model, ready, why } = llmConfig();
  if (!ready) {
    const e = new Error(why || 'no LLM provider configured');
    e.httpStatus = 503;
    throw e;
  }

  if (provider === 'fal') {
    const result = await cfg.falSubscribe('fal-ai/any-llm', {
      input: { model, prompt: String(prompt).trim(), ...(system ? { system_prompt: system } : {}) },
      logs: false,
    }, tag);
    return extractText(result);
  }

  // ── kie: OpenAI-compatible chat, model in the PATH ────────────────────
  const doFetch = fetchImpl || fetch;

  // Content is an ARRAY of typed parts, per kie's documented example — not
  // the bare string the plain OpenAI API accepts.
  const part = (text) => [{ type: 'text', text }];
  const messages = [];
  if (system) messages.push({ role: 'system', content: part(system) });
  messages.push({ role: 'user', content: part(String(prompt).trim()) });

  let resp;
  try {
    resp = await doFetch(KIE_BASE + kieChatPath(model), {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.kieKey}`, 'Content-Type': 'application/json' },
      // stream:false is NOT optional. kie's own example passes stream:true,
      // and a streamed reply is server-sent events — resp.json() would throw
      // on it and the whole thing would fail as "invalid JSON" rather than as
      // "you asked for a stream".
      body: JSON.stringify({ messages, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // A timeout here is not the customer's fault and not a 500 on our side.
    const err = new Error(e?.name === 'TimeoutError' ? 'the assistant took too long to answer' : e.message);
    err.httpStatus = e?.name === 'TimeoutError' ? 504 : 502;
    throw err;
  }

  let json = null;
  try { json = await resp.json(); } catch { /* provider sent non-JSON */ }

  if (!resp.ok) {
    throw kieError(resp.status, json?.msg || json?.error?.message || `HTTP ${resp.status}`, model);
  }
  // kie answers 200 with {code: 401, msg: '…'} on auth failure. A success has
  // either code 200 or — for the OpenAI-shaped replies — no code field at all,
  // so "no code" must NOT be read as failure.
  if (json && json.code != null && json.code !== 200) {
    throw kieError(json.code, json.msg || `provider code ${json.code}`, model);
  }

  const text = extractText(json);
  if (!text) {
    // Name the model. If the id is wrong this is where it shows up, and
    // "no answer" would otherwise send someone to read the prompt.
    const e = new Error(`the assistant returned nothing (model "${model}")`);
    e.httpStatus = 502;
    e.llmModel = model;
    throw e;
  }
  return text;
}
