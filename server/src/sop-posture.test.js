// ─── sop-posture.test.js ─────────────────────────────────────────────────────
// The security zone shows what is still OPEN and what could silently come
// UNDONE — not eighteen permanently-green ticks for findings already fixed.
//
// The admin-gate scan is the assertion that earns its place: routes are added
// here most weeks, and one registered without adminGate is an unauthenticated
// hole in the control panel that no lint, type check or existing test notices.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findUngatedAdminRoutes, checkSecurityConfig, checkRuntimeSupport,
  runPostureChecks, OPEN_ITEMS, NODE_EOL,
} from './sop-posture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('every admin route must carry the gate', () => {
  it('catches an admin route registered WITHOUT adminGate', () => {
    const found = findUngatedAdminRoutes([{ file: 'x.js', src: `
      app.get('/api/admin/safe', adminGate, async (req, res) => {});
      app.post('/api/admin/wide-open', async (req, res) => {});
    ` }], {});
    expect(found).toEqual(['POST /api/admin/wide-open (x.js)']);
  });

  it('accepts requireAdmin as well as adminGate', () => {
    expect(findUngatedAdminRoutes([{ file: 'x.js', src:
      `app.get('/api/admin/thing', verifyJwt, requireAdmin, async (req, res) => {});` }], {}))
      .toEqual([]);
  });

  it('ignores non-admin routes — they are gated differently by design', () => {
    expect(findUngatedAdminRoutes([{ file: 'x.js', src:
      `app.post('/api/waitlist', limiter, async (req, res) => {});` }], {})).toEqual([]);
  });

  it('honours a documented exception, and only a documented one', () => {
    const src = `app.get('/api/admin/public-thing', async (req, res) => {});`;
    expect(findUngatedAdminRoutes([{ file: 'x.js', src }], {})).toHaveLength(1);
    expect(findUngatedAdminRoutes([{ file: 'x.js', src }],
      { '/api/admin/public-thing': 'reason' })).toEqual([]);
  });

  // THE REAL ASSERTION: run it over this actual codebase.
  it('finds no ungated admin route in the real server', () => {
    const r = runPostureChecks({ root: ROOT, env: { JWT_SECRET: 'x', BACKUP_ENCRYPTION_PASSPHRASE: 'y' } });
    expect(r.ungated_admin_routes,
      'these admin endpoints are reachable without authentication').toEqual([]);
    expect(r.scanned_files, 'scan found no files — a green result would mean nothing')
      .toBeGreaterThan(10);
  });
});

describe('live configuration', () => {
  it('catches mail silently in test mode — password resets would not arrive', () => {
    const r = checkSecurityConfig({ MAIL_TEST_MODE: 'TRUE', JWT_SECRET: 'x', BACKUP_ENCRYPTION_PASSPHRASE: 'y' });
    expect(r.problems.join(' ')).toMatch(/password resets are not being delivered/);
  });

  it('catches a missing auth secret or backup passphrase', () => {
    expect(checkSecurityConfig({}).problems.join(' ')).toMatch(/JWT_SECRET is unset/);
    expect(checkSecurityConfig({ JWT_SECRET: 'x' }).problems.join(' '))
      .toMatch(/BACKUP_ENCRYPTION_PASSPHRASE is unset/);
  });

  // A short secret is worse than none: it blocks real traffic while a guesser
  // walks through, so it is a PROBLEM, not a note.
  it('treats a too-short origin secret as a problem, not a note', () => {
    const r = checkSecurityConfig({ JWT_SECRET: 'x', BACKUP_ENCRYPTION_PASSPHRASE: 'y',
      ORIGIN_SHARED_SECRET: 'short' });
    expect(r.problems.join(' ')).toMatch(/too short/);
  });

  it('notes an inert origin guard without calling it a failure', () => {
    const r = checkSecurityConfig({ JWT_SECRET: 'x', BACKUP_ENCRYPTION_PASSPHRASE: 'y' });
    expect(r.problems).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/origin guard inert/);
  });
});

describe('runtime support — a deadline, not novelty', () => {
  it('is critical past end of life', () => {
    const r = checkRuntimeSupport('v20.11.0', new Date('2026-08-18'));
    expect(r.state).toBe('critical');
    expect(r.detail).toMatch(/NO security patches/);
  });

  it('warns before the date, so the migration is planned', () => {
    expect(checkRuntimeSupport('v22.0.0', new Date('2027-02-01')).state).toBe('warn');
  });

  it('is fine on the version production now runs', () => {
    expect(checkRuntimeSupport('v24.15.0', new Date('2026-08-18')).state).toBe('ok');
  });

  it('says UNKNOWN for a version not in the schedule, rather than assuming safe', () => {
    expect(checkRuntimeSupport('v99.0.0', new Date('2026-08-18')).state).toBe('unknown');
  });

  it('records the EOL dates rather than guessing them', () => {
    expect(NODE_EOL[20]).toBe('2026-04-30');
    expect(NODE_EOL[24]).toBe('2028-04-30');
  });
});

describe('open items', () => {
  // Every one needs an OWNER action. An item with no action is a worry, not a task.
  it('each carries a detail and an action', () => {
    expect(OPEN_ITEMS.length).toBeGreaterThan(2);
    for (const i of OPEN_ITEMS) {
      expect(i.detail.length, i.key).toBeGreaterThan(30);
      expect(i.action.length, i.key).toBeGreaterThan(15);
    }
  });

  it('includes the Cloudflare origin item, so the panel tracks it and not my notes', () => {
    expect(OPEN_ITEMS.map((i) => i.key)).toContain('cloudflare-origin');
  });
});
