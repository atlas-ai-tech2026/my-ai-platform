// ─── credit-source.test.js ───────────────────────────────────────────────────
// ☠ EVERY CREDIT ROW MUST SAY WHO PUT IT THERE.
//
// The owner asked for one screen: "where can I see all the credits I added by
// hand?" It sounds like a filter. It was not, because BULK PROVISIONING WRITES
// THE SAME WORD as a hand-typed grant — action 'grant', both of them. The only
// thing separating them was the sentence bulk happens to put in `reason`:
// "bulk provision: Basic plan".
//
// Filtering on that sentence works right up until somebody edits the wording,
// and then the Manual Credits screen silently starts including hundreds of
// bulk rows with nothing to say so. And the owner's whole reason for wanting
// the screen was that finding his own money already depended on knowing what
// somebody typed months ago — "SPA4", "spa 4", "Spa 4." — three spellings of
// one workshop. Replacing one typed string with another solves nothing.
//
// So the ledger now carries `source`, chosen from a fixed set at the moment of
// writing. This test is what keeps it true: a path that gives or takes credits
// and forgets to say where it came from fails the build, instead of landing as
// NULL and looking like an old row nobody classified.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = __dirname;
const SOURCES = ['manual', 'bulk', 'promo', 'gift', 'system'];

/** Every INSERT into the ledger, wherever it lives. */
function ledgerInserts() {
  const out = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const src = readFileSync(join(DIR, f), 'utf8');
    const re = /INSERT INTO credits_history\s*\n?\s*\(([^)]*)\)\s*\n?\s*VALUES \(([^)]*)\)/g;
    let m;
    while ((m = re.exec(src))) {
      // the statement plus the parameter array that follows it
      const tail = src.slice(m.index, m.index + m[0].length + 320);
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ file: f, line, cols: m[1], vals: m[2], tail });
    }
  }
  return out;
}

describe('☠ EVERY PATH THAT WRITES A CREDIT ROW NAMES ITS SOURCE', () => {
  const inserts = ledgerInserts();

  it('finds them all — a test with nothing to check is not a check', () => {
    expect(inserts.length).toBeGreaterThanOrEqual(11);
  });

  it.each(inserts.map((i) => [`${i.file}:${i.line}`, i]))('%s', (_label, insert) => {
    expect(insert.cols,
      `This INSERT does not set \`source\`. A credit row with no source lands as NULL, which `
      + `means "written before the column existed" — so a forgotten path disguises itself as `
      + `history. Add source, and give it one of: ${SOURCES.join(', ')}.`).toMatch(/\bsource\b/);

    // and the value has to be one of the five, not an invented word
    const named = SOURCES.filter((s) => insert.tail.includes(`'${s}'`));
    expect(named.length,
      `${_label} sets \`source\` but not to one of ${SOURCES.join(', ')}.`).toBeGreaterThan(0);
  });
});

describe('the five sources mean what the screens assume they mean', () => {
  const inserts = ledgerInserts();
  const find = (needle) => inserts.find((i) => i.tail.includes(needle) || i.vals.includes(needle));

  it("the panel's own credit box is the ONLY 'manual'", () => {
    const manual = inserts.filter((i) => i.tail.includes("'manual'"));
    expect(manual).toHaveLength(1);
    // It is the route behind Users → + Credits, which writes grant/revoke/set.
    expect(manual[0].file).toBe('index.js');
  });

  it("☠ bulk provisioning is 'bulk', NOT 'manual' — the whole point", () => {
    // Found by `provisionReason`, not by the literal "bulk provision": the
    // sentence is now built once above and shared by the ledger row and the
    // credit lot, so a typed workshop name reaches both and they cannot
    // describe the same batch differently.
    const bulk = find('provisionReason');
    expect(bulk, 'the bulk provisioning insert vanished').toBeTruthy();
    expect(bulk.tail).toContain("'bulk'");
    expect(bulk.tail).not.toContain("'manual'");
  });

  it("a redeemed code is 'promo' and a gift card is 'gift', decided from the action", () => {
    const g = find("action === 'gift' ? 'gift' : 'promo'");
    expect(g, 'grantRedeemedCredits no longer distinguishes promo from gift').toBeTruthy();
  });

  it("spend, refund, expiry, signup, ban and password reset are all 'system'", () => {
    for (const marker of ["'spend'", "'refund'", "'expire'", "'signup'", "'password_reset'"]) {
      const row = find(marker);
      expect(row, `no ledger insert writes ${marker} any more`).toBeTruthy();
      expect(row.tail, `${marker} should be 'system'`).toContain("'system'");
    }
  });

  it('☠ and nothing writes a source outside the five', () => {
    // An invented sixth value would be invisible on every screen that filters
    // by the five — present in the data, absent from every total.
    for (const i of inserts) {
      const quoted = [...i.vals.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      const suspect = quoted.filter((v) =>
        !SOURCES.includes(v) &&
        ['manual', 'bulk', 'promo', 'gift', 'system'].some((s) => v.includes(s)));
      expect(suspect, `${i.file}:${i.line} writes an unknown source-like value`).toEqual([]);
    }
  });
});

describe('the column itself', () => {
  const db = readFileSync(join(DIR, 'db.js'), 'utf8');

  it('exists, and is added the safe way', () => {
    expect(db).toMatch(/ADD COLUMN IF NOT EXISTS source VARCHAR\(16\)/);
  });

  it('is NULLABLE on purpose, so old rows are visibly unclassified', () => {
    // A DEFAULT would stamp every historical row with a guess and leave no way
    // to tell a classified row from an assumed one. NULL means "nobody has
    // decided yet", which is the truth until the backfill runs.
    expect(db).not.toMatch(/source VARCHAR\(16\) NOT NULL/);
    expect(db).not.toMatch(/ADD COLUMN IF NOT EXISTS source VARCHAR\(16\) DEFAULT/);
  });

  it('is indexed, because the screen filters on it', () => {
    expect(db).toMatch(/credits_history_source_idx[\s\S]*?\(source, created_at DESC\)/);
  });
});
