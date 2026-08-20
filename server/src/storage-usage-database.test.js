// ─── storage-usage-database.test.js ──────────────────────────────────────────
// The database is watched the same way the buckets are — but it is the one that
// does not degrade gracefully.
//
// Over its allowance, Spaces costs money and keeps working. A Postgres disk
// that fills STOPS ACCEPTING WRITES: generations fail, nobody can sign in, and
// there is no invoice to warn you first. So the projection matters more here
// than anywhere else on the screen, and the action must say "resize", never
// "expect a larger bill".
//
// The owner's question on 2026-08-20 was the direct cause:
//   "old data just I need the historical and become in the control panel...
//    I think it will be not useful except if it will make a problem on the
//    database. Tell me your recommendation before start."
//
// Nobody could answer it. The database only accepts connections from trusted
// sources, so it cannot be measured from a laptop — which is correct security,
// and is exactly why the answer had to become a permanent line on the screen
// rather than a number one of us looked up once.

import { describe, it, expect } from 'vitest';
import {
  measureDatabase, describeTables, judgeUsage, ALLOWANCES, GIB,
} from './storage-usage.js';

/** A pool that answers the two queries by shape, so a typo cannot pass. */
const fakePool = ({ bytes, tables, fail }) => ({
  query: async (sql) => {
    if (fail) throw new Error(fail);
    if (/pg_database_size/.test(sql)) return { rows: [{ bytes: String(bytes) }] };
    if (/pg_total_relation_size/.test(sql)) {
      return { rows: tables.map((t) => ({
        name: t.name, bytes: String(t.bytes), live_rows: String(t.rows),
      })) };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  },
});

const TABLES = [
  { name: 'entities', bytes: 380 * 1024 * 1024, rows: 18256 },
  { name: 'credits_history', bytes: 41 * 1024 * 1024, rows: 29195 },
  { name: 'users', bytes: 2 * 1024 * 1024, rows: 601 },
  { name: 'promo_codes', bytes: 98304, rows: 42 },
  { name: 'alerts', bytes: 65536, rows: 12 },
  { name: 'storage_usage', bytes: 32768, rows: 9 },
];

describe('measuring the database', () => {
  it('reports the size Postgres itself reports', async () => {
    const m = await measureDatabase(fakePool({ bytes: 460_000_000, tables: TABLES }));
    expect(m.bytes).toBe(460_000_000);
    expect(m.error).toBeUndefined();
  });

  // The bug I wrote first: summing the biggest five and labelling it the row
  // total. It looks right, it is smaller than the truth, and nothing catches it.
  it('counts rows across EVERY table, not just the ones it shows', async () => {
    const m = await measureDatabase(fakePool({ bytes: 1, tables: TABLES }), { topTables: 2 });
    const everyRow = TABLES.reduce((s, t) => s + t.rows, 0);
    expect(m.objects, 'the row total was taken from the shown tables only').toBe(everyRow);
    expect(m.tables).toHaveLength(2);
    expect(m.tableCount).toBe(TABLES.length);
  });

  it('names the biggest tables, largest first', async () => {
    const m = await measureDatabase(fakePool({ bytes: 1, tables: TABLES }));
    expect(m.tables[0].name).toBe('entities');
    expect(describeTables(m.tables)).toMatch(/entities 380 MiB \(18,256 rows\)/);
  });

  // An unreachable database must never read as a healthy one.
  it('an unreachable database renders as UNKNOWN, never as ok', async () => {
    const m = await measureDatabase(fakePool({ fail: 'no pg_hba.conf entry for host' }));
    expect(m.error).toMatch(/pg_hba/);
    const v = judgeUsage({ provider: 'database', measurement: m });
    expect(v.state).toBe('unknown');
    expect(v.state).not.toBe('ok');
  });
});

describe('judging it', () => {
  const measurement = { bytes: 460 * 1024 * 1024, objects: 48_115, bucket: 'postgres' };
  const daily = (n, step) => Array.from({ length: n }, (_, i) => ({
    bytes: measurement.bytes - (n - 1 - i) * step,
    at: new Date(Date.UTC(2026, 7, 10 + i)),   // usageHistory maps measured_at → at
  }));

  it('measures against the 10 GiB disk of the db-s-1vcpu-1gb plan', () => {
    expect(ALLOWANCES.database.limitBytes).toBe(10 * GIB);
    const v = judgeUsage({ provider: 'database', measurement });
    expect(v.detail).toMatch(/of 10 GiB \(4%\)/);
  });

  // The distinction the owner asked for in the first place: not "you are over",
  // but "you are about to be over" — with a date, because a percentage could be
  // six days or six months away.
  it('gives a DATE once it has enough daily readings', () => {
    const v = judgeUsage({ provider: 'database', measurement, history: daily(6, 200 * 1024 * 1024) });
    expect(v.detail).toMatch(/growing/);
    expect(v.detail).toMatch(/crosses the allowance in about \d+ days/);
  });

  it('refuses to project from one or two readings', () => {
    const v = judgeUsage({ provider: 'database', measurement, history: daily(2, 200 * 1024 * 1024) });
    expect(v.detail).toMatch(/unknown rate/);
    expect(v.detail).not.toMatch(/crosses the allowance/);
  });

  // THE POINT OF THIS WHOLE FILE. Storage over quota is an invoice. A database
  // over quota is an outage, and the wording has to carry that difference or
  // the line will be read as "we will pay a bit more".
  it('says RESIZE, and says the platform stops — not that it costs more', () => {
    const v = judgeUsage({
      provider: 'database',
      measurement: { ...measurement, bytes: 9.7 * GIB },
    });
    expect(v.state).toBe('critical');
    expect(v.action).toMatch(/[Rr]esize/);
    expect(v.action).toMatch(/stops accepting writes/);
    expect(v.action, 'a full database was described as a billing event')
      .not.toMatch(/larger invoice|bills automatically/);
  });

  it('calls them rows, not objects — and says the count is an estimate', () => {
    const v = judgeUsage({ provider: 'database', measurement });
    expect(v.detail).toMatch(/48,115 rows/);
    expect(v.detail).toMatch(/estimated/);
    expect(v.detail).not.toMatch(/objects/);
  });
});

// ── THE UNIT BUG, KEPT DEAD ────────────────────────────────────────────────
// Found by running the real code against a real Postgres rather than by
// reading it: an 11 MiB database rendered as "0.0 GiB of 10 GiB (0%) · growing
// 0.0 GiB/day · crosses the allowance in about 7 days". Every number in that
// sentence was correct and the sentence was unreadable — and a screen that
// looks broken stops being read, which costs more than a wrong number.
describe('sizes are printed in a unit a human would have chosen', () => {
  it('does not flatten a small database to 0.0 GiB', () => {
    const v = judgeUsage({
      provider: 'database',
      measurement: { bytes: 11_919_887, objects: 13_601, bucket: 'postgres' },
    });
    expect(v.detail).toMatch(/^11 MiB of 10 GiB/);
    expect(v.detail).not.toMatch(/0\.0 GiB/);
  });

  it('does not flatten a daily growth rate to 0.0 GiB/day', () => {
    const at = (d) => new Date(Date.UTC(2026, 7, d));
    const v = judgeUsage({
      provider: 'database',
      measurement: { bytes: 500 * 1024 ** 2, objects: 1, bucket: 'postgres' },
      history: [
        { bytes: 380 * 1024 ** 2, at: at(15) },
        { bytes: 440 * 1024 ** 2, at: at(16) },
        { bytes: 500 * 1024 ** 2, at: at(17) },
      ],
    });
    expect(v.detail).toMatch(/growing 60 MiB\/day/);
  });

  // Backblaze's free tier is 10 DECIMAL GB. Printing binary units against it
  // would show 9.5 GiB — under the limit — for a bucket already over it.
  it('uses decimal units for the decimal allowance, so "under" means under', () => {
    const v = judgeUsage({
      provider: 'offsite',
      measurement: { bytes: 9.5 * 1024 ** 3, objects: 12, bucket: 'voxel-offsite-backups' },
    });
    expect(v.detail).toMatch(/GB/);
    expect(v.detail).not.toMatch(/GiB/);
    expect(v.state, '10.2 GB against a 10 GB allowance was reported as fine').not.toBe('ok');
  });
});
