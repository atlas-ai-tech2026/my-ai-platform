// ─── video-charge-model-id.test.js ───────────────────────────────────────────
// Every video charge MUST record which provider and model it belongs to.
//
// This is the test that would have prevented 124 stuck charges.
//
// What happened: 8 of the 10 places that call trackVideoCharge omitted
// `modelId`. The column is nullable, so nothing complained. But the boot
// reconciler asks the provider "what happened to this job?" — and with no
// model recorded there is no provider to ask, so it returns 'pending'
// immediately, forever. 124 charges (real, paid-for subscription credits)
// accumulated behind that, and the hourly job reported "still pending 124"
// with no error, for days.
//
// The bug was invisible three times over: the column allows NULL, the
// reconciler failed silently, and the value was often IN SCOPE — at line 1449
// the very next statement returned `model_id: modelIdTag` to the browser.
//
// So this checks the CALL SITES, not the behaviour. A unit test on
// trackVideoCharge itself would have passed throughout: the function was
// always correct, it was simply never told.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'index.js'), 'utf8');

/** Every trackVideoCharge(...) call, as {line, text}. */
function callSites() {
  const out = [];
  source.split('\n').forEach((text, i) => {
    if (text.includes('trackVideoCharge(')) out.push({ line: i + 1, text: text.trim() });
  });
  return out;
}

describe('every video charge records its model', () => {
  it('finds the call sites at all (guards against a rename silently voiding this test)', () => {
    expect(callSites().length).toBeGreaterThanOrEqual(8);
  });

  // The finding itself.
  it('passes modelId at EVERY call site', () => {
    const missing = callSites().filter((c) => !/\bmodelId\s*:/.test(c.text));
    expect(
      missing.map((c) => `line ${c.line}: ${c.text.slice(0, 90)}`),
      'a charge with no model can never be reconciled — it stays pending forever'
    ).toEqual([]);
  });

  // A charge recorded as an empty string is no better than one recorded as
  // NULL: videoJobVerdict treats both as "no provider to ask".
  it('never passes an empty or literal-null model', () => {
    for (const c of callSites()) {
      expect(c.text, `line ${c.line}`).not.toMatch(/modelId:\s*(''|""|null|undefined)/);
    }
  });

  // kie jobs are routed by prefix — kie:jobs: → Jobs API, kie: → Veo. A kie
  // charge tagged without its prefix would be sent to FAL, which has never
  // heard of the id, and the row would stay stuck in a different way.
  it('tags kie charges with a routable kie: prefix', () => {
    for (const c of callSites()) {
      const m = c.text.match(/modelId:\s*'([^']*)'/);
      if (m && m[1].startsWith('kie')) {
        expect(m[1], `line ${c.line}`).toMatch(/^kie:(jobs:)?/);
      }
    }
  });
});

describe('the reconciler still refuses to guess', () => {
  // Recording the model is the fix; inventing one when it is absent would be
  // worse than the bug — it would send a real job id to the wrong provider.
  it('treats a missing model as a named reason, not a default provider', () => {
    expect(source).toMatch(/if \(!modelId\) return \{ verdict: 'pending', reason: 'no-model-id' \}/);
  });
});
