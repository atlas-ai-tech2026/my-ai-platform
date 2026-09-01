// ─── onboarding.test.js ──────────────────────────────────────────────────────
// The first-run questions.
//
// Almost everything here defends ONE distinction, because Amr asked for one
// number and that number is impossible to compute if the distinction is lost:
//
//   "never reached this question"  ≠  "reached it and said no"
//
// If both were stored as null they would be the same row, and the skip rate
// would be unknowable forever. The tests below break the code deliberately to
// prove they would catch that.

import { describe, it, expect } from 'vitest';
import {
  stepPatch, merge, shouldShow, summarise, MIGRATION_SQL, SKIPPED, STATS_SQL,
} from './onboarding.js';

const user = (reached, answers, finished = false) => ({
  id: 1, created_at: '2026-08-01', onboarded_at: finished ? '2026-08-02' : null,
  onboarding: { v: 1, reached, answers },
});
const ans = (value, ms) => ({ value, at: '2026-08-01T00:00:00Z', ...(ms ? { ms } : {}) });

describe('☠ SKIPPED IS A VALUE, NOT AN ABSENCE', () => {
  it('a skip is stored explicitly', () => {
    const p = stepPatch({ screenId: 'about', answers: { role: SKIPPED }, index: 2 });
    expect(p.answers.role.value).toBe(SKIPPED);
  });

  it('☠ the skip rate counts only people who REACHED the question', () => {
    // Out of everybody would fall every time somebody quit on an earlier
    // screen — which says nothing at all about this question.
    const s = summarise([
      user(3, { role: ans('Designer') }),
      user(3, { role: ans(SKIPPED) }),
      user(1, { found: ans('Google') }),      // never got to `role`
    ]);
    expect(s.questions.role.answered).toBe(1);
    expect(s.questions.role.skipped).toBe(1);
    expect(s.questions.role.skipRate).toBe(50);   // not 33.3
  });

  it('a skipped answer is never counted as a value', () => {
    const s = summarise([user(1, { found: ans(SKIPPED) })]);
    expect(s.questions.found.values).toEqual([]);
  });

  it('and a question nobody reached has no entry at all, rather than 0%', () => {
    const s = summarise([user(1, { found: ans('Google') })]);
    expect(s.questions.role).toBeUndefined();
  });
});

describe('☠ NOTHING MEASURED MUST NEVER READ AS A RESULT', () => {
  it('an empty population gives null rates, not zero', () => {
    // "0% completion" on an empty screen reads as a catastrophe. "No data yet"
    // reads as the truth.
    const s = summarise([]);
    expect(s.total).toBe(0);
    expect(s.completionRate).toBeNull();
  });

  it('the stats query excludes customers backfilled by the migration', () => {
    // They have onboarded_at set and onboarding NULL. Counting them as
    // "finished without answering" would make completion look terrible forever.
    expect(STATS_SQL).toMatch(/onboarding IS NOT NULL/);
  });
});

describe('the funnel', () => {
  it('counts everyone who got at least that far', () => {
    // Three screens now — the generate screen is withdrawn until it generates.
    const s = summarise([user(1, {}), user(2, {}), user(3, {}, true)]);
    expect(s.funnel.map((f) => f.reached)).toEqual([3, 2, 1]);
  });

  it('☠ and clamps a stored reach that is higher than the flow', () => {
    // A row written when there were four screens must not draw a fourth bar
    // after the fourth screen was withdrawn.
    const s = summarise([user(4, {}, true)]);
    expect(s.funnel).toHaveLength(3);
    expect(s.funnel.at(-1).reached).toBe(1);
  });

  it('shows what share carried on from the screen before', () => {
    const s = summarise([user(2, {}), user(2, {}), user(1, {})]);
    expect(s.funnel[0].keptFrom).toBeNull();      // nothing before screen 1
    expect(s.funnel[1].keptFrom).toBeCloseTo(66.7, 1);
  });
});

describe('☠ SAVING PER SCREEN MUST NOT LOSE THE EARLIER ONES', () => {
  it('merge keeps answers from every screen', () => {
    // Postgres `||` is a SHALLOW merge: applied naively it would replace the
    // whole answers object and silently discard screen 1.
    const first = merge(null, stepPatch({ screenId: 'source', answers: { found: 'Google' }, index: 0 }));
    const second = merge(first, stepPatch({ screenId: 'use', answers: { products: ['images'] }, index: 1 }));
    expect(Object.keys(second.answers).sort()).toEqual(['found', 'products']);
    expect(second.answers.found.value).toBe('Google');
  });

  it('and never lets the furthest-reached counter go backwards', () => {
    const far = merge(null, stepPatch({ screenId: 'about', answers: {}, index: 2 }));
    const back = merge(far, stepPatch({ screenId: 'source', answers: {}, index: 0 }));
    expect(back.reached).toBe(3);
  });
});

describe('multi-select and timing', () => {
  it('counts each chosen option once', () => {
    const s = summarise([
      user(2, { products: ans(['images', 'videos']) }),
      user(2, { products: ans(['images']) }),
    ]);
    const v = Object.fromEntries(s.questions.products.values.map((x) => [x.label, x.count]));
    expect(v).toEqual({ images: 2, videos: 1 });
  });

  it('averages the seconds spent, so a confusing question is visible', () => {
    const s = summarise([user(1, { found: ans('Google', 4000) }), user(1, { found: ans('TikTok', 8000) })]);
    expect(s.questions.found.avgSeconds).toBe(6);
  });

  it('survives answers with no timing recorded', () => {
    const s = summarise([user(1, { found: ans('Google') })]);
    expect(s.questions.found.avgSeconds).toBeNull();
  });
});

describe('who is shown the flow', () => {
  it('a new customer sees it', () => {
    expect(shouldShow({ onboarded_at: null })).toBe(true);
  });

  it('somebody who has done it does not', () => {
    expect(shouldShow({ onboarded_at: '2026-08-01' })).toBe(false);
  });

  it('☠ DEV BEHAVES EXACTLY LIKE PRODUCTION — nothing is automatic', () => {
    // It used to return true unconditionally on a dev host. That made dev
    // unusable for anything else: the flow reopened on every page load while
    // Amr was trying to look at something different. Same rule in both places
    // now, which is also the only way the gate is genuinely tested.
    expect(shouldShow({ onboarded_at: '2026-08-01' })).toBe(false);
  });

  it('and only a DELIBERATE force reopens it', () => {
    // ?firstrun=1 on a dev host, and nothing else. The caller ANDs this with
    // the host check, so it is inert on production however it is sent.
    expect(shouldShow({ onboarded_at: '2026-08-01' }, true)).toBe(true);
  });

  it('and a missing row is treated as new, not as an error', () => {
    expect(shouldShow(null)).toBe(true);
    expect(shouldShow(undefined)).toBe(true);
  });
});

describe('☠ THE EXISTING CUSTOMERS ARE NOT ASKED', () => {
  it('the migration backfills them as already onboarded', () => {
    const sql = MIGRATION_SQL.join('\n');
    expect(sql).toMatch(/UPDATE users SET onboarded_at = created_at WHERE onboarded_at IS NULL/);
  });

  it('and it is safe to run twice', () => {
    // After the first run every row is non-NULL, so the WHERE matches nothing.
    expect(MIGRATION_SQL.join('\n')).toMatch(/ADD COLUMN IF NOT EXISTS onboarded_at/);
    expect(MIGRATION_SQL.join('\n')).toMatch(/ADD COLUMN IF NOT EXISTS onboarding/);
  });
});
