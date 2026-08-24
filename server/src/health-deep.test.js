// ─── health-deep.test.js ─────────────────────────────────────────────────────
// The test that matters most here is the status code, and it is worth saying
// why: an uptime monitor reads the CODE, not the body. A check that answers
// {"ok":false} with a 200 attached never fires an alert — which is worse than
// having no check at all, because it actively reassures you.
//
// This exists because /api/health could not see a dead database. It reported
// `db_configured: pool !== null` — true from boot until the process ends,
// whatever Postgres is doing.

import { describe, it, expect, vi } from 'vitest';
import { deepHealth } from './health-deep.js';

const okPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) });
const deadPool = () => ({ query: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:25060')) });
const hangingPool = () => ({ query: vi.fn(() => new Promise(() => {})) });   // never settles

describe('a dead database is NOT ok', () => {
  it('answers 503 when the database refuses', async () => {
    // The whole reason this file exists.
    const r = await deepHealth({ pool: deadPool(), storageReady: true });
    expect(r.ok).toBe(false);
    expect(r.status, 'a monitor reads the STATUS CODE').toBe(503);
  });

  it('answers 503 when the database HANGS rather than waiting forever', async () => {
    // A hanging dependency must not become a hanging endpoint — that is the
    // same failure moved one layer up, where it is harder to see.
    const r = await deepHealth({ pool: hangingPool(), storageReady: true, timeoutMs: 30 });
    expect(r.status).toBe(503);
    expect(r.checks.find((c) => c.name === 'database').detail).toBe('timed out');
  });

  it('answers 503 when there is no pool at all', async () => {
    const r = await deepHealth({ pool: null });
    expect(r.status).toBe(503);
    expect(r.checks.find((c) => c.name === 'database').detail).toBe('not configured');
  });

  it('answers 200 when the database really replies', async () => {
    const pool = okPool();
    const r = await deepHealth({ pool, storageReady: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(pool.query, 'it must actually ASK, not just check a flag').toHaveBeenCalledWith('SELECT 1');
  });
});

describe('what it says out loud', () => {
  it('NEVER leaks the host, port or user from a pg error', async () => {
    // Unauthenticated on purpose, so a monitor can call it. A raw pg error
    // carries the connection string in all but name.
    const r = await deepHealth({ pool: deadPool(), storageReady: true });
    const said = JSON.stringify(r);
    expect(said).not.toMatch(/ECONNREFUSED/);
    expect(said).not.toMatch(/10\.0\.0\.5/);
    expect(said).not.toMatch(/25060/);
    expect(r.checks.find((c) => c.name === 'database').detail).toBe('unreachable');
  });

  it('names each dependency so an alert says WHERE to look', async () => {
    const r = await deepHealth({ pool: okPool(), storageReady: true });
    expect(r.checks.map((c) => c.name).sort()).toEqual(['database', 'storage']);
  });
});

describe('storage is reported, but does not decide', () => {
  it('stays UP when storage is unconfigured but the database answers', async () => {
    // Conflating them means every alert has to be investigated from scratch.
    // No storage is a real problem and a different one.
    const r = await deepHealth({ pool: okPool(), storageReady: false });
    expect(r.status).toBe(200);
    expect(r.checks.find((c) => c.name === 'storage').ok).toBe(false);
  });

  it('storage being fine does NOT rescue a dead database', async () => {
    const r = await deepHealth({ pool: deadPool(), storageReady: true });
    expect(r.status).toBe(503);
  });
});

describe('it stays cheap', () => {
  it('asks the database exactly ONCE per call', async () => {
    // Called every two minutes forever. One query, no rows, no table.
    const pool = okPool();
    await deepHealth({ pool, storageReady: true });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('does not touch storage over the network at all', async () => {
    // A HEAD request every two minutes is a request we pay for, and Spaces
    // being slow is not a reason to declare the site down.
    const r = await deepHealth({ pool: okPool(), storageReady: true });
    expect(r.checks.find((c) => c.name === 'storage').detail).toBeUndefined();
  });
});
