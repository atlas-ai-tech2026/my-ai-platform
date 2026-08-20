// ─── totp.test.js ────────────────────────────────────────────────────────────
// H5 (security audit 2026-07-28): admin TOTP 2FA.
//
// The correctness of this implementation is pinned by the OFFICIAL test
// vectors published in the RFCs — if these pass, the codes we generate are
// the same codes Google Authenticator / Authy will show.
//   RFC 4226 Appendix D (HOTP)  — https://www.rfc-editor.org/rfc/rfc4226
//   RFC 6238 Appendix B (TOTP)  — https://www.rfc-editor.org/rfc/rfc6238

import { describe, it, expect } from 'vitest';
import {
  hotp, generateTotp, verifyTotp, generateSecret, currentStep,
  base32Encode, base32Decode, buildOtpAuthUri, evaluateSecondFactor,
  generateRecoveryCodes, hashRecoveryCode, matchRecoveryCode, normalizeRecoveryCode,
} from './totp.js';

// RFC 4226 / 6238 use the ASCII secret "12345678901234567890".
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = base32Encode(Buffer.from(RFC_SECRET_ASCII));

describe('RFC 4226 Appendix D — official HOTP vectors', () => {
  const EXPECTED = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];
  it.each(EXPECTED.map((code, counter) => [counter, code]))(
    'counter %i → %s',
    (counter, expected) => {
      expect(hotp(Buffer.from(RFC_SECRET_ASCII), counter)).toBe(expected);
    }
  );
});

describe('RFC 6238 Appendix B — official TOTP vectors (SHA-1)', () => {
  // [unix seconds, expected 8-digit code]. The RFC table is 8 digits; we
  // run at 8 here to compare against it exactly, then confirm our 6-digit
  // production setting is the last 6 of the same value.
  const VECTORS = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(VECTORS)('t=%i → %s', (seconds, expected) => {
    const code = generateTotp(RFC_SECRET_B32, { timestampMs: seconds * 1000, digits: 8 });
    expect(code).toBe(expected);
  });

  it('our production 6-digit setting matches the RFC value truncated', () => {
    for (const [seconds, expected8] of VECTORS) {
      const code6 = generateTotp(RFC_SECRET_B32, { timestampMs: seconds * 1000 });
      expect(code6).toBe(expected8.slice(-6));
    }
  });
});

describe('H5 — verification accepts the right codes and rejects the rest', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;

  it('accepts the current code', () => {
    const code = generateTotp(secret, { timestampMs: now });
    expect(verifyTotp(secret, code, { timestampMs: now })).toBe(0);
  });

  it('tolerates a phone clock one step out (±30s), as authenticators expect', () => {
    const previous = generateTotp(secret, { timestampMs: now - 30_000 });
    const next = generateTotp(secret, { timestampMs: now + 30_000 });
    expect(verifyTotp(secret, previous, { timestampMs: now })).toBe(-1);
    expect(verifyTotp(secret, next, { timestampMs: now })).toBe(1);
  });

  it('REJECTS a code from outside the window (an old screenshot / stale code)', () => {
    const old = generateTotp(secret, { timestampMs: now - 120_000 });
    expect(verifyTotp(secret, old, { timestampMs: now })).toBe(null);
    const future = generateTotp(secret, { timestampMs: now + 300_000 });
    expect(verifyTotp(secret, future, { timestampMs: now })).toBe(null);
  });

  it('rejects a code generated from a DIFFERENT secret', () => {
    const attacker = generateTotp(generateSecret(), { timestampMs: now });
    expect(verifyTotp(secret, attacker, { timestampMs: now })).toBe(null);
  });

  it('rejects malformed input without throwing', () => {
    ['', null, undefined, '12345', '1234567', 'abcdef', '12 34 56', '000000x', {}, []]
      .forEach((bad) => {
        expect(verifyTotp(secret, bad, { timestampMs: now })).toBe(null);
      });
  });

  it('rejects everything when the stored secret is corrupt', () => {
    expect(verifyTotp('not-valid-base32!!', '123456', { timestampMs: now })).toBe(null);
  });

  // ── THIS TEST USED TO FAIL ABOUT ONCE IN EVERY 250 RUNS ─────────────────
  // The secret is random per run, and verifyTotp accepts a ±1 STEP WINDOW —
  // three valid codes, not one. The old version skipped only the current code,
  // so whenever a neighbouring code happened to land inside the 2000 deterministic
  // guesses the assertion failed, and its own premise ("all fail") was simply
  // untrue: two of those codes are SUPPOSED to be accepted.
  //
  // Hit on 2026-08-20 during an unrelated change. A test that fails at random
  // is worse than no test: it blocks a deploy for no reason, and it teaches
  // people to re-run until green — which is how a real failure gets waved
  // through.
  //
  // Now it excludes every code the verifier legitimately accepts, so it is
  // deterministic AND still says the thing worth saying: nothing outside the
  // window gets in.
  it('brute force does not get lucky: 2000 guesses outside the window all fail', () => {
    const valid = new Set([-1, 0, 1].map(
      (offset) => generateTotp(secret, { timestampMs: now + offset * 30_000 })));
    expect(valid.size, 'the window should contain three distinct codes').toBe(3);

    let accepted = 0;
    let tried = 0;
    for (let i = 0; i < 2000; i++) {
      const guess = String(i * 7919 % 1_000_000).padStart(6, '0');
      if (valid.has(guess)) continue;          // legitimately accepted — not a guess
      tried += 1;
      if (verifyTotp(secret, guess, { timestampMs: now }) !== null) accepted++;
    }
    expect(tried, 'the guess list collapsed — this would pass without checking anything')
      .toBeGreaterThan(1990);
    expect(accepted).toBe(0);
  });

  it('currentStep buckets time into absolute 30s windows (replay anchor)', () => {
    // Steps are epoch-aligned, not relative to "now": floor(unixSeconds / 30).
    const stepStart = Math.floor(now / 30_000) * 30_000; // start of a window
    expect(currentStep(stepStart)).toBe(currentStep(stepStart + 29_999));
    expect(currentStep(stepStart + 30_000)).toBe(currentStep(stepStart) + 1);
    expect(currentStep(stepStart - 1)).toBe(currentStep(stepStart) - 1);
  });
});

describe('H5 — secrets and enrolment', () => {
  it('generates a 160-bit base32 secret, unique each time', () => {
    const a = generateSecret(), b = generateSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
    expect(base32Decode(a)).toHaveLength(20);
  });

  it('base32 round-trips arbitrary bytes', () => {
    for (const n of [1, 5, 10, 20, 32]) {
      const buf = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37) % 256));
      expect(base32Decode(base32Encode(buf))).toEqual(buf);
    }
  });

  it('builds an otpauth URI an authenticator app can scan', () => {
    const uri = buildOtpAuthUri('JBSWY3DPEHPK3PXP', { account: 'info@voxel-ai.ai' });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Voxel+AI');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(decodeURIComponent(uri.split('?')[0])).toContain('Voxel AI:info@voxel-ai.ai');
  });
});

describe('H5 — the admin login gate (evaluateSecondFactor)', () => {
  const now = 1_700_000_000_000;
  const secret = generateSecret();
  const codes = generateRecoveryCodes(3);
  const enrolled = {
    totp_enabled: true,
    totp_secret: secret,
    totp_last_step: null,
    totp_recovery_codes: codes.map(hashRecoveryCode),
  };

  it('an account that has NOT set up 2FA is unaffected (no lockout on deploy)', () => {
    const notEnrolled = { totp_enabled: false, totp_secret: null };
    expect(evaluateSecondFactor(notEnrolled, {}, { timestampMs: now }).outcome).toBe('not_required');
    // Even mid-enrolment (secret stored, not confirmed) login still works.
    expect(evaluateSecondFactor({ totp_enabled: false, totp_secret: secret }, {}, { timestampMs: now }).outcome)
      .toBe('not_required');
  });

  it('admin login WITHOUT a code fails and asks for one', () => {
    expect(evaluateSecondFactor(enrolled, {}, { timestampMs: now }).outcome).toBe('required');
    expect(evaluateSecondFactor(enrolled, { totpCode: '' }, { timestampMs: now }).outcome).toBe('required');
  });

  it('admin login with a WRONG code fails', () => {
    expect(evaluateSecondFactor(enrolled, { totpCode: '000000' }, { timestampMs: now }).outcome).toBe('invalid');
    expect(evaluateSecondFactor(enrolled, { totpCode: 'abcdef' }, { timestampMs: now }).outcome).toBe('invalid');
    // A code from someone else's authenticator
    const other = generateTotp(generateSecret(), { timestampMs: now });
    expect(evaluateSecondFactor(enrolled, { totpCode: other }, { timestampMs: now }).outcome).toBe('invalid');
  });

  it('admin login with the CORRECT code succeeds', () => {
    const code = generateTotp(secret, { timestampMs: now });
    const verdict = evaluateSecondFactor(enrolled, { totpCode: code }, { timestampMs: now });
    expect(verdict.outcome).toBe('ok');
    expect(verdict.nextStep).toBe(currentStep(now));
  });

  it('the SAME code cannot be replayed inside its window', () => {
    const code = generateTotp(secret, { timestampMs: now });
    const first = evaluateSecondFactor(enrolled, { totpCode: code }, { timestampMs: now });
    expect(first.outcome).toBe('ok');
    // Server stored nextStep; a stolen code replayed seconds later is refused.
    const after = { ...enrolled, totp_last_step: String(first.nextStep) };
    expect(evaluateSecondFactor(after, { totpCode: code }, { timestampMs: now + 5_000 }).outcome)
      .toBe('replayed');
    // The NEXT window's code works again.
    const nextCode = generateTotp(secret, { timestampMs: now + 30_000 });
    expect(evaluateSecondFactor(after, { totpCode: nextCode }, { timestampMs: now + 30_000 }).outcome)
      .toBe('ok');
  });

  it('a valid recovery code logs in and is consumed', () => {
    const verdict = evaluateSecondFactor(enrolled, { recoveryCode: codes[1] }, { timestampMs: now });
    expect(verdict.outcome).toBe('ok_recovery');
    expect(verdict.remainingHashes).toHaveLength(2);
    expect(verdict.remainingHashes).not.toContain(hashRecoveryCode(codes[1]));
    // Reusing it against the updated set fails.
    const after = { ...enrolled, totp_recovery_codes: verdict.remainingHashes };
    expect(evaluateSecondFactor(after, { recoveryCode: codes[1] }, { timestampMs: now }).outcome)
      .toBe('invalid');
  });

  it('an invalid recovery code fails', () => {
    expect(evaluateSecondFactor(enrolled, { recoveryCode: 'ZZZZ-ZZZZ' }, { timestampMs: now }).outcome)
      .toBe('invalid');
  });
});

describe('H5 — recovery codes (the break-glass path)', () => {
  it('generates 10 unique codes in a readable, unambiguous format', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(c).not.toMatch(/[01OI]/); // no ambiguous characters
    });
  });

  it('only HASHES are stored — the plaintext code is not recoverable', () => {
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(normalizeRecoveryCode(code));
  });

  it('matches a valid code regardless of case, spaces or dashes', () => {
    const codes = generateRecoveryCodes(5);
    const stored = codes.map(hashRecoveryCode);
    const target = codes[2];
    expect(matchRecoveryCode(target, stored)).toBe(hashRecoveryCode(target));
    expect(matchRecoveryCode(target.toLowerCase(), stored)).toBeTruthy();
    expect(matchRecoveryCode(target.replace('-', ''), stored)).toBeTruthy();
    expect(matchRecoveryCode(` ${target} `, stored)).toBeTruthy();
  });

  it('rejects a code that is not in the stored set', () => {
    const stored = generateRecoveryCodes(5).map(hashRecoveryCode);
    expect(matchRecoveryCode('AAAA-BBBB', stored)).toBe(null);
    expect(matchRecoveryCode('', stored)).toBe(null);
    expect(matchRecoveryCode('garbage', stored)).toBe(null);
  });

  it('a consumed code no longer matches (single use)', () => {
    const codes = generateRecoveryCodes(3);
    let stored = codes.map(hashRecoveryCode);
    const used = codes[0];
    const hit = matchRecoveryCode(used, stored);
    stored = stored.filter((h) => h !== hit);      // consume it
    expect(matchRecoveryCode(used, stored)).toBe(null);
    expect(matchRecoveryCode(codes[1], stored)).toBeTruthy();
  });
});
