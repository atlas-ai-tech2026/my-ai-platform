// ─── thumbnail-sweep-wired.test.js ───────────────────────────────────────────
// THE SWEEP IS ONLY WORTH ANYTHING IF SOMETHING RUNS IT.
//
// thumbnail-sweep.js has 26 passing tests and, on its own, does nothing at all.
// That is not a hypothetical failure in this project: `copyAndRecord()` in
// offsite-ledger.js was fully tested, correct, and CALLED BY NOBODY while the
// backup silently recorded files it had never read back. And `upsertTask` was
// tested and correct while the seed skipped existing rows, so nothing ever
// reached the board.
//
// So this file tests the CALL SITE. It reads index.js as text, because that is
// the only place the question "does this ever run?" can be answered.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8');

describe('☠ SOMETHING ACTUALLY RUNS THE SWEEP', () => {
  it('sweepOnce is imported AND called', () => {
    expect(src, 'sweepOnce is never imported').toMatch(/sweepOnce/);
    // Imported-but-uncalled is the exact shape of the dead-code bug above, so
    // a mention is not enough: there must be a call.
    expect(src, 'sweepOnce is imported but never called').toMatch(/await sweepOnce\(/);
  });

  it('on a repeating timer, not once at boot', () => {
    // A one-shot at startup would clear 25 rows and never run again.
    const call = src.indexOf('await sweepOnce(');
    expect(call).toBeGreaterThan(-1);
    const after = src.slice(call, call + 3000);
    expect(after, 'not on an interval').toMatch(/SWEEP_EVERY_MS\)\.unref/);
  });

  it('behind the advisory lock, or two instances pay twice for one result', () => {
    const call = src.indexOf('await sweepOnce(');
    const before = src.slice(Math.max(0, call - 2000), call);
    expect(before).toMatch(/pg_try_advisory_lock\(\$1\)/);
    expect(before).toMatch(/SWEEP_LOCK_ID/);
  });

  it('and the lock is released on every path, including a throw', () => {
    const call = src.indexOf('await sweepOnce(');
    const after = src.slice(call, call + 3000);
    // A `finally`, not a trailing statement: an unreleased advisory lock
    // survives until the connection dies and blocks the other instance for
    // ever. This is the same shape as the socket the backup forgot to destroy.
    expect(after).toMatch(/finally\s*\{[^}]*pg_advisory_unlock/s);
  });
});

describe('☠ IT USES THE RESIZER THAT ALREADY EXISTS', () => {
  it('the sweep hands its rows to backfillRows, not to a second resizer', () => {
    // Two copies of the resizing rules drift, and then disagree about a
    // customer's picture. index.js says so itself at the makeThumbnail import.
    const call = src.indexOf('await sweepOnce(');
    const block = src.slice(call, call + 3000);
    expect(block).toMatch(/backfill:\s*\(batch, \{ onDone \}\) => backfillRows\(/);
  });

  it('and reports each success by id, so a done row is never marked failed', () => {
    const call = src.indexOf('await sweepOnce(');
    const block = src.slice(call, call + 3000);
    expect(block).toMatch(/onProgress:\s*\(p\) => onDone\(p\.id\)/);
  });

  it('scopes every write to the row OWNER, taken from the row', () => {
    // This sweep crosses accounts. SET_THUMB_SQL is scoped by user_id, so a
    // wrong owner writes nothing rather than writing to someone else.
    const call = src.indexOf('await sweepOnce(');
    const block = src.slice(call, call + 3000);
    expect(block).toMatch(/owner\.get\(id\)/);
    expect(block).toMatch(/owner\.set\(r\.id, r\.user_id\)/);
  });
});

describe('it does not run where it cannot work', () => {
  it('checks the database and the bucket first', () => {
    const call = src.indexOf('await sweepOnce(');
    const before = src.slice(Math.max(0, call - 2000), call);
    expect(before).toMatch(/if \(!dbReady\(\) \|\| !spacesReady\(\)\) return;/);
  });
});
