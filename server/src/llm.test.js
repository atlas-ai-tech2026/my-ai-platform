// ─── llm.test.js ─────────────────────────────────────────────────────────────
// The riskiest thing in llm.js is not the request, it is READING THE REPLY.
//
// kie.ai proxies OpenAI, Google and Anthropic models behind one
// OpenAI-compatible endpoint, and those three do not agree on where the text
// lives — Anthropic returns `content` as an ARRAY of parts, the others a
// string, and kie may wrap the whole thing in its own {code,msg,data}
// envelope. Guessing one shape and getting it wrong surfaces as "the
// assistant did not answer", which sends you to read the prompt instead of
// the parser. So most of this file is extraction.
//
// The second risk is kie answering HTTP 200 with {code: 401} in the body.
// Treating that as success would hand the customer an empty reply and no
// reason, and would never trip a monitor.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureLlm, llmConfig, llmText, extractText } from './llm.js';

const okResponse = (json, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => json,
});

const chat = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });

beforeEach(() => {
  configureLlm({ kieKey: 'kie-test-key' });
});

describe('reading the reply, whatever shape it arrives in', () => {
  it('OpenAI shape — choices[0].message.content', () => {
    expect(extractText(chat('hello'))).toBe('hello');
  });

  it('Anthropic shape — content is an ARRAY of parts', () => {
    // Claude Sonnet 5 and Claude Opus 5 are both in kie's chat catalogue, so
    // this shape is not hypothetical.
    expect(extractText(chat([{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }])))
      .toBe('one two');
  });

  it('kie envelope — the same thing wrapped in { code, msg, data }', () => {
    expect(extractText({ code: 200, msg: 'success', data: chat('wrapped') })).toBe('wrapped');
  });

  it("FAL's any-llm shape — output, not choices", () => {
    // The provider being replaced. Kept working on purpose.
    expect(extractText({ data: { output: 'from fal' } })).toBe('from fal');
  });

  it('a bare string', () => {
    expect(extractText('just text')).toBe('just text');
  });

  it('returns empty — NOT a crash — for shapes it does not know', () => {
    // An unknown shape must fall through to the caller's "returned nothing"
    // path, which names the model. Throwing here would lose that.
    expect(extractText({ something: 'else' })).toBe('');
    expect(extractText(null)).toBe('');
    expect(extractText({ choices: [] })).toBe('');
  });

  it('ignores whitespace-only content and keeps looking', () => {
    expect(extractText({ choices: [{ message: { content: '   ' } }], output: 'real' })).toBe('real');
  });

  it('trims, because prompts get pasted straight into a textarea', () => {
    expect(extractText(chat('  padded  '))).toBe('padded');
  });
});

describe('HTTP 200 with an error inside it', () => {
  it('RAISES on {code: 401} even though the status was 200', async () => {
    // kie's actual auth-failure shape — verified by probing the endpoint
    // unauthenticated. A 200 body carrying 401 must never read as success.
    const f = vi.fn().mockResolvedValue(okResponse({ code: 401, msg: 'Unauthorized – Authentication failed.' }));
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).rejects.toThrow(/Unauthorized/);
  });

  it('carries the provider status so a refusal can be told from our own bug', async () => {
    const f = vi.fn().mockResolvedValue(okResponse({ code: 403, msg: 'no access' }));
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('accepts a reply with NO code field — that is the OpenAI-shaped success', async () => {
    // The bug this guards: `json.code !== 200` is true for undefined, so a
    // naive check rejects every successful OpenAI-shaped response.
    const f = vi.fn().mockResolvedValue(okResponse(chat('fine')));
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).resolves.toBe('fine');
  });

  it('accepts code 200 explicitly', async () => {
    const f = vi.fn().mockResolvedValue(okResponse({ code: 200, data: chat('fine') }));
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).resolves.toBe('fine');
  });
});

describe('when it goes wrong, say something actionable', () => {
  it('names the MODEL when the answer is empty', async () => {
    // The one thing I could not verify without a live key is the model-id
    // string. If it is wrong, this is the error that says so.
    configureLlm({ kieKey: 'k', model: 'gemini-2.5-flash' });
    const f = vi.fn().mockResolvedValue(okResponse({ choices: [] }));
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).rejects.toThrow(/gemini-2\.5-flash/);
  });

  it('a timeout is a 504, not a 500 — it is not the customer\'s fault', async () => {
    const f = vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).rejects.toMatchObject({ httpStatus: 504 });
  });

  it('surfaces a non-2xx status with the provider message', async () => {
    const f = vi.fn().mockResolvedValue(okResponse({ msg: 'model overloaded' }, 503));
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).rejects.toMatchObject({
      httpStatus: 503, message: 'model overloaded',
    });
  });

  it('survives a provider that answers with non-JSON', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => { throw new Error('not json'); },
    });
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).rejects.toMatchObject({ httpStatus: 502 });
  });

  it('refuses to call out at all with no provider configured', async () => {
    configureLlm({});
    const f = vi.fn();
    await expect(llmText({ prompt: 'hi', fetchImpl: f })).rejects.toMatchObject({ httpStatus: 503 });
    expect(f, 'must not make a request it cannot authenticate').not.toHaveBeenCalled();
  });

  it('requires a prompt', async () => {
    await expect(llmText({ prompt: '   ' })).rejects.toThrow(/prompt is required/);
  });
});

describe('what it sends', () => {
  it('puts the MODEL IN THE PATH — the mistake that cost the first attempt', async () => {
    // Calling the generic /api/v1/chat/completions does not 404. It exists,
    // and answers "This feature is currently not supported", which reads like
    // an account or plan problem and sends you to the wrong place entirely.
    configureLlm({ kieKey: 'k', model: 'gemini-2.5-flash' });
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hi', fetchImpl: f });
    expect(f.mock.calls[0][0]).toBe('https://api.kie.ai/gemini-2.5-flash/v1/chat/completions');
  });

  it('defaults to a model kie documents as OpenAI-COMPATIBLE', async () => {
    // The trap: kie ships chat models in two protocols and the catalogue does
    // not say which is which. gemini-3-7-flash is newer, and is the NATIVE
    // Google shape (…:streamGenerateContent) — it would fail here however
    // right the path was. Only "(openai)" models belong in this default.
    configureLlm({ kieKey: 'k' });
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hi', fetchImpl: f });
    expect(f.mock.calls[0][0]).toMatch(/\/v1\/chat\/completions$/);
    expect(f.mock.calls[0][0], 'gemini-3-7-flash is NOT OpenAI-compatible on kie')
      .not.toContain('gemini-3-7-flash');
  });

  it('never sends the model in the BODY — the path already carries it', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hi', fetchImpl: f });
    expect(JSON.parse(f.mock.calls[0][1].body).model).toBeUndefined();
  });

  it('sends stream:false — a streamed reply is SSE and resp.json() would throw', async () => {
    // kie's own documented example passes stream:true. Inheriting that would
    // fail as "invalid JSON" rather than as "you asked for a stream", which
    // is a much worse thing to have to debug.
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hi', fetchImpl: f });
    expect(JSON.parse(f.mock.calls[0][1].body).stream).toBe(false);
  });

  it('sends content as an ARRAY of typed parts, per the documented shape', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ system: 'you are a robot', prompt: 'hello', fetchImpl: f });
    expect(JSON.parse(f.mock.calls[0][1].body).messages).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'you are a robot' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('omits the system message when there is none', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hello', fetchImpl: f });
    expect(JSON.parse(f.mock.calls[0][1].body).messages).toHaveLength(1);
  });

  it('escapes the model so a stray slug cannot rewrite the path', async () => {
    configureLlm({ kieKey: 'k', model: '../../admin' });
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hi', fetchImpl: f });
    expect(f.mock.calls[0][0]).not.toContain('../');
  });

  it('authenticates with the kie key as a Bearer token', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hi', fetchImpl: f });
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer kie-test-key');
  });

  it('sends a deadline — a hung provider must not hold the request open', async () => {
    const f = vi.fn().mockResolvedValue(okResponse(chat('ok')));
    await llmText({ prompt: 'hi', fetchImpl: f });
    expect(f.mock.calls[0][1].signal).toBeDefined();
  });
});

describe('choosing a provider', () => {
  it('prefers kie when both keys exist — FAL is the one that is broken', () => {
    configureLlm({ kieKey: 'k', falKey: 'f', falSubscribe: vi.fn() });
    expect(llmConfig()).toMatchObject({ provider: 'kie', ready: true });
  });

  it('falls back to FAL when only FAL is configured', () => {
    // Build before you delete: a revived FAL key must still work.
    configureLlm({ falKey: 'f', falSubscribe: vi.fn() });
    expect(llmConfig()).toMatchObject({ provider: 'fal', ready: true });
  });

  it('honours an explicit LLM_PROVIDER even when it CANNOT run', () => {
    // Silently using the other provider would hide the misconfiguration
    // behind a bill on an account the owner did not choose.
    configureLlm({ kieKey: 'k', provider: 'fal' });
    expect(llmConfig()).toMatchObject({ provider: 'fal', ready: false });
    expect(llmConfig().why).toMatch(/FAL_KEY/);
  });

  it('reports not-ready with nothing configured, and says why', () => {
    configureLlm({});
    expect(llmConfig()).toMatchObject({ provider: null, ready: false });
    expect(llmConfig().why).toMatch(/KIE_KEY/);
  });

  it('routes through falSubscribe when FAL is the provider', async () => {
    const falSubscribe = vi.fn().mockResolvedValue({ data: { output: 'fal said this' } });
    configureLlm({ falKey: 'f', falSubscribe });
    await expect(llmText({ prompt: 'hi', system: 'sys' })).resolves.toBe('fal said this');
    expect(falSubscribe).toHaveBeenCalledWith('fal-ai/any-llm', expect.objectContaining({
      input: expect.objectContaining({ prompt: 'hi', system_prompt: 'sys' }),
    }), 'LLM');
  });

  it('llmConfig costs nothing — it never calls the provider', () => {
    const falSubscribe = vi.fn();
    configureLlm({ kieKey: 'k', falKey: 'f', falSubscribe });
    llmConfig(); llmConfig();
    expect(falSubscribe).not.toHaveBeenCalled();
  });
});
