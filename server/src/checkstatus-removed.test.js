// ─── checkstatus-removed.test.js ─────────────────────────────────────────────
// ☠ /api/checkStatus WAS A SECOND COPY OF THE REFUND LOGIC.
//
// It looked like tidiness — one more line on a structure report. It was not.
// The route branched on kie/fal exactly as /api/video-status does, and called
// settleVideoCharge() and refundFailedVideo() itself. Two copies of the rule
// that decides whether a customer is charged or refunded.
//
// The hazard is drift, not clutter: fix a settle-or-refund bug in one and not
// the other, and the unexercised copy does the wrong thing with money the day
// anything reaches it. This codebase has been bitten by two-copies-drifting
// before — it is why the reliability query was extracted rather than pasted.
//
// Removal was checked, not assumed: `git log -S checkStatus -- src/` finds no
// caller anywhere in the project's history, and the route required a JWT, so no
// outside integration could reach it either.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8');

describe('☠ THERE IS ONE VIDEO POLLER, NOT TWO', () => {
  it('/api/checkStatus is gone', () => {
    expect(src).not.toMatch(/app\.post\('\/api\/checkStatus'/);
  });

  it('and its replacement is still there, doing the same job', () => {
    // Removing the duplicate is only safe while the real one exists.
    expect(src).toMatch(/app\.post\('\/api\/video-status'/);
  });

  it('☠ settle and refund are called from ONE place for video status', () => {
    // The whole point. Two copies of a money rule is the hazard.
    const at = src.indexOf("app.post('/api/video-status'");
    const block = src.slice(at, at + 4000);
    expect(block).toMatch(/settleVideoCharge\(/);
    expect(block).toMatch(/refundFailedVideo\(/);
  });

  it('the removal is explained where the route used to be', () => {
    // A deleted route with no note is a mystery to whoever looks for it next.
    expect(src).toMatch(/\/api\/checkStatus REMOVED 2026-09-02/);
    expect(src).toMatch(/Two copies of refund logic is the hazard/);
  });
});

describe('the deferred customer notifications are DECLARED, not forgotten', () => {
  const integrity = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'sop-integrity.js'), 'utf8');

  it('all three are on the expected list', () => {
    for (const p of ['/api/notifications', '/api/notifications/read', '/api/notifications/:id/click']) {
      expect(integrity).toContain(`'${p}'`);
    }
  });

  it('☠ with a REASON, and a note saying when to take them off', () => {
    // An unexplained exemption is how a real finding gets waved through later.
    expect(integrity).toMatch(/DEFERRED ON PURPOSE/);
    expect(integrity).toMatch(/take these three off this list/);
  });
});

describe('the backup verification finally has a screen', () => {
  const api = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/adminApi.js'), 'utf8');
  const panel = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/components/admin/MaintenancePanel.jsx'), 'utf8');
  const outcome = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/maintenance-outcome.js'), 'utf8');

  it('both endpoints are reachable from the client', () => {
    expect(api).toMatch(/backupVerification:/);
    expect(api).toMatch(/backupVerifyNow:/);
  });

  it('and there is a control that calls them', () => {
    // The route's own comment says the answer to "are we safe?" should never be
    // "wait a month and find out" — on a route nothing could reach.
    expect(panel).toMatch(/preview: \(\) => adminApi\.backupVerification\(\)/);
    expect(panel).toMatch(/run: \(\) => adminApi\.backupVerifyNow\(\)/);
  });

  it('a FAILED verification reads as bad, not as a neutral result', () => {
    expect(outcome).toMatch(/A backup that cannot be `\s*\+ 'restored is not a backup/);
  });

  it('and "never verified" is its own answer, not a green tick', () => {
    expect(outcome).toMatch(/Never verified\./);
  });
});
