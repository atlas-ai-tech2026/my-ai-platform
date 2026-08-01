// ─── base44Client.test.js ────────────────────────────────────────────────────
// H7 (security audit 2026-07-28): the API client used to `catch {}` every
// failure and return localStorage data, so a 500 was indistinguishable from
// a successful save — `create` fabricated a row the server never saw and
// handed it back as if persisted. These tests prove that is closed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal axios mock: every method delegates to `handler`, which each test
// sets to either resolve or reject the way axios really would.
let handler = async () => ({ data: null });
const instance = {
  get: (...a) => handler('get', ...a),
  post: (...a) => handler('post', ...a),
  put: (...a) => handler('put', ...a),
  delete: (...a) => handler('delete', ...a),
  interceptors: { request: { use: () => {} } },
};
vi.mock('axios', () => ({ default: { create: () => instance } }));

const { base44, ApiError, isOffline } = await import('./base44Client.js');

// How axios reports each situation:
const serverError = (status, body = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: body },
  });
const networkError = () =>
  Object.assign(new Error('Network Error'), { request: {}, response: undefined });

beforeEach(() => {
  localStorage.clear();
  handler = async () => ({ data: null });
});

describe('H7 — a server error ALWAYS reaches the caller', () => {
  it('a 500 on create throws instead of faking a saved row', async () => {
    handler = async () => { throw serverError(500, { error: 'Database is down' }); };
    await expect(base44.entities.GenerationHistory.create({ prompt: 'x' }))
      .rejects.toBeInstanceOf(ApiError);
    // …and nothing was invented in localStorage.
    expect(localStorage.getItem('voxel_GenerationHistory')).toBe(null);
  });

  it('the thrown error carries the status and the server message', async () => {
    handler = async () => { throw serverError(500, { error: 'Database is down' }); };
    const err = await base44.entities.GenerationHistory.create({ prompt: 'x' }).catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.offline).toBe(false);
    expect(err.message).toBe('Database is down');
  });

  it('402 (out of credits) and 403 (banned) reach the caller intact', async () => {
    handler = async () => { throw serverError(402, { error: 'Not enough credits' }); };
    const err = await base44.entities.GenerationHistory.create({}).catch((e) => e);
    expect(err.status).toBe(402);
    expect(err.message).toBe('Not enough credits');

    handler = async () => { throw serverError(403, { error: 'Account is banned.' }); };
    await expect(base44.entities.GenerationHistory.update('1', {})).rejects.toThrow('Account is banned.');
  });

  it('update, delete and upload all throw on a server error', async () => {
    handler = async () => { throw serverError(500, { error: 'boom' }); };
    await expect(base44.entities.GenerationHistory.update('id-1', { saved: true })).rejects.toBeInstanceOf(ApiError);
    await expect(base44.entities.GenerationHistory.delete('id-1')).rejects.toBeInstanceOf(ApiError);
    await expect(base44.storage.upload(new Blob(['x']))).rejects.toBeInstanceOf(ApiError);
  });

  it('upload never returns a blob: URL the server has not seen', async () => {
    handler = async () => { throw serverError(415, { error: 'Unsupported file type' }); };
    const result = await base44.storage.upload(new Blob(['x'])).catch((e) => e);
    expect(result).toBeInstanceOf(ApiError);
    expect(result.url).toBeUndefined();
  });

  it('READS also surface a server error rather than silently serving cache', async () => {
    localStorage.setItem('voxel_GenerationHistory', JSON.stringify([{ id: 'stale' }]));
    handler = async () => { throw serverError(500, { error: 'boom' }); };
    await expect(base44.entities.GenerationHistory.list()).rejects.toBeInstanceOf(ApiError);
    await expect(base44.entities.GenerationHistory.filter({})).rejects.toBeInstanceOf(ApiError);
    await expect(base44.entities.GenerationHistory.get('stale')).rejects.toBeInstanceOf(ApiError);
  });

  it('auth.me() on 401 throws — a revoked session can no longer look valid', async () => {
    localStorage.setItem('voxel_user', JSON.stringify({ email: 'ghost@example.com' }));
    handler = async () => { throw serverError(401, { error: 'Invalid or expired token.' }); };
    await expect(base44.auth.me()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('H7 — a genuine network outage is distinguished from a server error', () => {
  it('isOffline() tells the two apart', () => {
    expect(isOffline(networkError())).toBe(true);
    expect(isOffline(serverError(500))).toBe(false);
  });

  it('offline READS may serve the cache (a read-only convenience)', async () => {
    localStorage.setItem('voxel_GenerationHistory', JSON.stringify([{ id: 'cached', prompt: 'p' }]));
    handler = async () => { throw networkError(); };
    const items = await base44.entities.GenerationHistory.list();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('cached');
    expect(await base44.entities.GenerationHistory.get('cached')).toMatchObject({ id: 'cached' });
  });

  it('offline WRITES still throw — a write that never reached the server did not happen', async () => {
    handler = async () => { throw networkError(); };
    const err = await base44.entities.GenerationHistory.create({ prompt: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.offline).toBe(true);
    expect(err.status).toBe(null);
    expect(err.message).toMatch(/offline/i);
    expect(localStorage.getItem('voxel_GenerationHistory')).toBe(null);
  });

  it('offline auth.me() falls back to the cached user (no server verdict to honour)', async () => {
    localStorage.setItem('voxel_user', JSON.stringify({ email: 'a@b.c' }));
    handler = async () => { throw networkError(); };
    expect(await base44.auth.me()).toMatchObject({ email: 'a@b.c' });
  });
});

describe('H7 — success paths are unchanged', () => {
  it('a successful create returns the SERVER row, not a local invention', async () => {
    handler = async () => ({ data: { id: 'server-id-42', prompt: 'x', created_date: '2026-08-01' } });
    const row = await base44.entities.GenerationHistory.create({ prompt: 'x' });
    expect(row.id).toBe('server-id-42');
  });

  it('a successful list returns server data', async () => {
    handler = async () => ({ data: [{ id: 'a' }, { id: 'b' }] });
    expect(await base44.entities.GenerationHistory.list()).toHaveLength(2);
  });

  it('a successful upload returns the server URL', async () => {
    handler = async () => ({ data: { url: 'https://v3.fal.media/x.png' } });
    expect((await base44.storage.upload(new Blob(['x']))).url).toBe('https://v3.fal.media/x.png');
  });
});
