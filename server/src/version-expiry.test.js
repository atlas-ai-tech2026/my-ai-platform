// ─── version-expiry.test.js ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// THE RULE THIS MODULE WRITES MUST NEVER DELETE A LIVE FILE.
// ═══════════════════════════════════════════════════════════════════════════
//
// An S3 lifecycle rule has two expiry settings that differ by one word:
//
//     Expiration                  → deletes the CURRENT, LIVE object
//     NoncurrentVersionExpiration → deletes OLD versions of deleted files
//
// The first, set to 60 days, would delete every customer's live pictures and
// videos sixty days after they were made. All of them. Silently, over months,
// with no error anywhere — and nothing left to restore from once the old
// versions aged out behind them.
//
// That is the single most destructive thing anyone could ship to this
// platform, and it is one word in a JSON body nobody would read twice. So the
// first three tests exist only to make it impossible, and everything else is
// secondary.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expiryRule, describePlan, applyExpiry, NONCURRENT_DAYS, RULE_ID,
} from './version-expiry.js';

describe('☠ THE RULE CANNOT DELETE A LIVE FILE', () => {
  it('never sets Expiration', () => {
    const r = expiryRule(60);
    expect(r.Expiration, 'this would delete every customer file after 60 days').toBeUndefined();
  });

  it('and never sets it at ANY value it is asked for', () => {
    for (const d of [1, 7, 60, 3650, 0, -5, null, undefined, 'x', NaN]) {
      expect(expiryRule(d).Expiration, `days=${d}`).toBeUndefined();
    }
  });

  it('the serialised rule does not contain the word at all', () => {
    // Reads the JSON that would actually go over the wire, not the object we
    // think we built.
    const json = JSON.stringify(expiryRule(60));
    expect(json).not.toMatch(/"Expiration"/);
    expect(json).toMatch(/"NoncurrentVersionExpiration"/);
  });

  it('the SOURCE never assigns Expiration to anything but undefined', () => {
    // A future edit that sets it would pass every test above if it happened
    // somewhere else in the file. This reads the file.
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'version-expiry.js'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const assignments = [...src.matchAll(/(?<!Noncurrent(?:Version)?)\bExpiration:\s*([^,\n]+)/g)]
      .map((m) => m[1].trim());
    expect(assignments, 'something assigns Expiration a real value').toEqual(['undefined']);
  });
});

describe('what it actually expires', () => {
  it('old versions, after the given number of days', () => {
    expect(expiryRule(60).NoncurrentVersionExpiration).toEqual({ NoncurrentDays: 60 });
  });

  it('defaults to 60 — a month past the customer’s own 30-day window', () => {
    expect(NONCURRENT_DAYS).toBe(60);
    expect(NONCURRENT_DAYS).toBeGreaterThan(30);
    expect(expiryRule().NoncurrentVersionExpiration.NoncurrentDays).toBe(60);
  });

  it('junk never becomes zero days — that would expire versions immediately', () => {
    for (const d of [0, -5, null, undefined, 'x', NaN]) {
      expect(expiryRule(d).NoncurrentVersionExpiration.NoncurrentDays, `days=${d}`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it('carries an id, so it can be found and changed rather than duplicated', () => {
    expect(expiryRule().ID).toBe(RULE_ID);
  });
});

describe('it is described before it is applied', () => {
  it('says plainly that live files are never touched', () => {
    const p = describePlan([], 60);
    expect(p.summary).toMatch(/LIVE files are never touched/);
    expect(p.summary).toMatch(/60 days/);
  });

  it('notices when it is already set, and would change nothing', () => {
    const existing = [expiryRule(60)];
    expect(describePlan(existing, 60)).toMatchObject({ alreadySet: true, unchanged: true });
  });

  it('says what it would change FROM', () => {
    expect(describePlan([expiryRule(30)], 60).summary).toMatch(/from 30 to 60 days/);
  });

  it('names any OTHER rule it would leave alone', () => {
    const p = describePlan([{ ID: 'someone-elses' }], 60);
    expect(p.otherRules).toEqual(['someone-elses']);
  });

  it('SHOUTS about any existing rule that deletes live files, whoever wrote it', () => {
    const p = describePlan([{ ID: 'legacy-cleanup', Expiration: { Days: 90 } }], 60);
    expect(p.dangerousRules).toEqual(['legacy-cleanup']);
  });
});

describe('applying it', () => {
  const rules = (init = []) => {
    let cur = init;
    return {
      getRules: vi.fn(async () => cur),
      putRules: vi.fn(async (next) => { cur = next; }),
    };
  };

  it('writes the rule and reads it back', async () => {
    const d = rules();
    const out = await applyExpiry({ ...d, days: 60 });
    expect(out).toMatchObject({ ok: true, changed: true, verified: true });
    expect(d.putRules).toHaveBeenCalledTimes(1);
  });

  it('KEEPS every other rule — this adds one thing, it is not a config manager', async () => {
    const d = rules([{ ID: 'someone-elses', Status: 'Enabled' }]);
    await applyExpiry({ ...d, days: 60 });
    const written = d.putRules.mock.calls[0][0];
    expect(written.map((r) => r.ID)).toContain('someone-elses');
    expect(written.map((r) => r.ID)).toContain(RULE_ID);
  });

  it('replaces its OWN rule rather than adding a second copy', async () => {
    const d = rules([expiryRule(30)]);
    await applyExpiry({ ...d, days: 60 });
    const written = d.putRules.mock.calls[0][0];
    expect(written.filter((r) => r.ID === RULE_ID)).toHaveLength(1);
  });

  it('does nothing at all when it is already correct', async () => {
    const d = rules([expiryRule(60)]);
    const out = await applyExpiry({ ...d, days: 60 });
    expect(out).toMatchObject({ ok: true, changed: false });
    expect(d.putRules).not.toHaveBeenCalled();
  });

  it('will NOT write on top of a configuration it could not read', async () => {
    // "Could not read" is not "there are none". Writing blind could remove a
    // rule somebody depends on.
    const d = { getRules: vi.fn(async () => { throw new Error('access denied'); }), putRules: vi.fn() };
    const out = await applyExpiry({ ...d, days: 60 });
    expect(out).toMatchObject({ ok: false, stage: 'read' });
    expect(d.putRules).not.toHaveBeenCalled();
  });

  it('written-but-unverified is NOT success', async () => {
    // An unread bucket configuration is exactly the kind of thing that gets
    // assumed for months.
    let n = 0;
    const d = {
      getRules: vi.fn(async () => { n += 1; if (n === 1) return []; throw new Error('read failed'); }),
      putRules: vi.fn(async () => {}),
    };
    expect(await applyExpiry({ ...d, days: 60 })).toMatchObject({ ok: false, stage: 'verify' });
  });

  it('a wrong read-back is a failure, not a success', async () => {
    const d = {
      getRules: vi.fn(async () => [expiryRule(7)]),
      putRules: vi.fn(async () => {}),
    };
    const out = await applyExpiry({ ...d, days: 60 });
    expect(out).toMatchObject({ ok: false, stage: 'verify' });
    expect(out.error).toMatch(/read back 7/);
  });

  it('reports any live-expiry rule found afterwards, even one it did not write', async () => {
    const d = rules([{ ID: 'legacy', Expiration: { Days: 90 } }]);
    const out = await applyExpiry({ ...d, days: 60 });
    expect(out.liveExpiryRules).toEqual(['legacy']);
  });
});
