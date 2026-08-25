// ─── provider-error.test.js ──────────────────────────────────────────────────
// The test for the thing that was missing when it was actually needed.
//
// On 2026-08-23 the Edit Cut agent failed twice on dev and the whole log said
// "❌ Forbidden" both times. The model id was valid, the input shape was
// valid, and the one part that would have explained it — the provider's body —
// had been thrown away by the catch block.

import { describe, it, expect } from 'vitest';
import { providerErrorParts, isProviderRefusal, formatProviderError } from './provider-error.js';

describe('digging the reason out of whatever was thrown', () => {
  it('reads a fal-client error, where status and body sit ON the error', () => {
    const e = Object.assign(new Error('Forbidden'), {
      status: 403,
      body: { detail: 'Exhausted balance. Top up at fal.ai/dashboard/billing' },
    });
    const { status, message, body } = providerErrorParts(e);

    expect(status).toBe(403);
    expect(message).toBe('Forbidden');
    expect(body.detail).toMatch(/Exhausted balance/);
  });

  it('reads an axios error, where they are nested under response', () => {
    const e = { message: 'Request failed', response: { status: 401, data: { error: 'bad key' } } };
    expect(providerErrorParts(e)).toEqual({
      status: 401, message: 'Request failed', body: { error: 'bad key' },
    });
  });

  it('survives a plain Error with neither', () => {
    const { status, message, body } = providerErrorParts(new Error('socket hang up'));
    expect(status).toBe(null);
    expect(message).toBe('socket hang up');
    expect(body).toBe(null);
  });

  it('survives being handed nothing at all', () => {
    // A logger that throws while logging an error is the worst possible time
    // for it to throw.
    expect(() => providerErrorParts(undefined)).not.toThrow();
    expect(providerErrorParts(null).message).toBe('unknown error');
  });
});

describe('an account problem is not a bug and not a retry', () => {
  it('treats 401 and 403 as the provider refusing us', () => {
    expect(isProviderRefusal(403)).toBe(true);
    expect(isProviderRefusal(401)).toBe(true);
  });

  it('does NOT treat a real failure as an account problem', () => {
    // A 500 from the provider, or our own bug, must stay loud.
    for (const s of [500, 422, 429, null, undefined]) {
      expect(isProviderRefusal(s), `status ${s}`).toBe(false);
    }
  });
});

describe('what actually reaches the log', () => {
  it('carries the status AND the body — the two things that were missing', () => {
    const e = Object.assign(new Error('Forbidden'), {
      status: 403, body: { detail: 'Exhausted balance' },
    });
    const lines = formatProviderError('EDIT-AGENT', e);

    expect(lines[0]).toBe('[EDIT-AGENT] ❌ 403 Forbidden');
    expect(lines[1]).toMatch(/Exhausted balance/);
  });

  it('says ??? rather than pretending to know the status', () => {
    expect(formatProviderError('X', new Error('boom'))[0]).toBe('[X] ❌ ??? boom');
  });

  it('does not add a useless second line for an empty body', () => {
    const e = Object.assign(new Error('nope'), { status: 500, body: {} });
    expect(formatProviderError('X', e)).toHaveLength(1);
  });

  it('truncates a provider that answers with an entire HTML page', () => {
    // The log buffer holds a few hundred lines. One error must not push away
    // the context needed to read it — which is how the first two failures
    // ended up with nothing around them.
    const e = Object.assign(new Error('bad'), { status: 500, body: 'x'.repeat(50_000) });
    const lines = formatProviderError('X', e, { limit: 200 });
    expect(lines[1].length).toBeLessThan(300);
  });

  it('handles a string body without JSON-quoting it into noise', () => {
    const e = Object.assign(new Error('bad'), { status: 403, body: 'Forbidden: no access to this endpoint' });
    expect(formatProviderError('X', e)[1]).toMatch(/provider said: Forbidden: no access/);
  });
});

describe('kie sets httpStatus, not status', () => {
  // Found 2026-08-24 from a real log line: `[EDIT-AGENT] ❌ ??? This feature
  // is currently not supported`. The ??? is the status this module could not
  // find, because kie.js and llm.js both name the field `httpStatus` and this
  // file only looked for `status`.
  //
  // The log was the smaller half. isProviderRefusal() reads the same value —
  // so a kie 401 or 403 was never recognised as an account problem and came
  // back to the customer as a generic 500 that invites retrying forever.
  it('reads httpStatus so a kie failure is not logged as "???"', () => {
    const e = Object.assign(new Error('This feature is currently not supported'), { httpStatus: 404 });
    expect(providerErrorParts(e).status).toBe(404);
  });

  it('a kie 401 now counts as a provider REFUSAL', () => {
    const e = Object.assign(new Error('Unauthorized'), { httpStatus: 401 });
    expect(isProviderRefusal(providerErrorParts(e).status)).toBe(true);
  });

  it('still prefers `status` when both are present', () => {
    // fal-style errors carry `status`; nothing about this change may move them.
    const e = Object.assign(new Error('x'), { status: 403, httpStatus: 500 });
    expect(providerErrorParts(e).status).toBe(403);
  });

  it('the log line now carries the status through', () => {
    const e = Object.assign(new Error('This feature is currently not supported'), { httpStatus: 404 });
    expect(formatProviderError('EDIT-AGENT', e)[0]).toContain('404');
  });
});
