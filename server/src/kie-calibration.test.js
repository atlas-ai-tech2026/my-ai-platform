// ─── kie-calibration.test.js ─────────────────────────────────────────────────
// Reporting what a supplier costs us is separate from deciding what to charge.
// This keeps the line between them.
//
// The calibration exists because KIE_USD_PER_CREDIT cannot fix a reporting
// error: credits are derived from our per-model USD table on the way in and
// multiplied back out on the way to a screen, so the constant cancels itself.
// Changing it would appear to correct rows already stored while leaving every
// future row wrong. The real gap is that our per-model prices run ~16% high,
// measured against kie.ai's own invoice.
//
// The danger in a calibration factor is that it is one number nobody can audit
// once the reason is forgotten — so these tests pin it to its evidence.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIE_USD_PER_CREDIT, KIE_CALIBRATION, kieBilledUsdPerCredit } from './kie-pricing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pricingSrc = readFileSync(path.join(here, 'kie-pricing.js'), 'utf8');
const creditsSrc = readFileSync(path.join(here, 'credits.js'), 'utf8');

describe('the factor is pinned to its evidence', () => {
  // If someone nudges the factor without updating the invoice numbers, the
  // provenance silently becomes a lie. This makes that fail instead.
  it('equals billed ÷ our estimate, from the recorded invoice', () => {
    const derived = KIE_CALIBRATION.billed_usd / KIE_CALIBRATION.our_estimate_usd;
    expect(KIE_CALIBRATION.factor).toBeCloseTo(derived, 5);
  });

  it('carries the window and date it was measured', () => {
    expect(KIE_CALIBRATION.measured_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(KIE_CALIBRATION.window).toMatch(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/);
    expect(KIE_CALIBRATION.billed_usd).toBeGreaterThan(0);
    expect(KIE_CALIBRATION.our_estimate_usd).toBeGreaterThan(0);
  });

  // A factor far from 1 means something bigger is wrong than a rounding drift,
  // and should be investigated rather than papered over.
  it('is a correction, not a rewrite', () => {
    expect(KIE_CALIBRATION.factor).toBeGreaterThan(0.5);
    expect(KIE_CALIBRATION.factor).toBeLessThan(1.5);
  });

  it('produces the rate the invoice implies', () => {
    expect(kieBilledUsdPerCredit()).toBeCloseTo(0.004318, 6);
    // And is BELOW the list rate, because our model prices run high.
    expect(kieBilledUsdPerCredit()).toBeLessThan(KIE_USD_PER_CREDIT);
  });
});

describe('it is display-only — charging is untouched', () => {
  // C1: pricing.js is the single charging authority. A calibration that leaked
  // into the recording path would change what customers are charged, which is
  // emphatically not what a reporting fix is for.
  it('never appears in the credit-recording path', () => {
    expect(creditsSrc).not.toMatch(/KIE_CALIBRATION|kieBilledUsdPerCredit/);
  });

  it('does not touch how credits are derived from model prices', () => {
    const line = pricingSrc.match(/const usdToCredits = .*/)[0];
    expect(line).toContain('KIE_USD_PER_CREDIT');
    expect(line).not.toContain('CALIBRATION');
  });

  it('leaves the list rate in place for everything else', () => {
    expect(KIE_USD_PER_CREDIT).toBe(0.005);
  });
});

describe('it says it needs re-measuring', () => {
  // One invoice, one window, one dominant model. Whoever reads this next needs
  // to know that before they trust it.
  it('warns in the source that a single window can drift', () => {
    expect(pricingSrc).toMatch(/ONE INVOICE, ONE WINDOW/i);
    expect(pricingSrc).toMatch(/Re-measure on the next invoice/i);
  });
});
