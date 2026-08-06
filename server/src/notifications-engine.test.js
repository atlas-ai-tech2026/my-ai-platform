// ─── notifications-engine.test.js ────────────────────────────────────────────
// Three themes, in order of how much damage the failure would do:
//
//   1. A variable must never render something FALSE. {renewal_date} has no
//      source in this database, so anything that looks like a date would be a
//      lie told to a paying customer.
//   2. A system notification must never be silenced by the marketing cap.
//      "Your generation failed" has to arrive even on a heavy promo day.
//   3. Automations that cannot fire must be declared as such, so they are not
//      shipped looking armed.

import { describe, it, expect } from 'vitest';
import {
  TYPES, MANUAL_TYPES, AUTOMATIONS, VARIABLES, RESOLVABLE, UNRESOLVED,
  isSystemType, automationByKey, liveAutomations,
  variableValues, renderTemplate, unresolvedVariables,
  canSend, applyFrequencyCap, validateCompose, isSafeCtaUrl,
  DEFAULT_DAILY_MARKETING_CAP,
} from './notifications-engine.js';

const USER = { id: 1, display_name: 'Layla', email: 'layla@example.com', package: 'Basic', credits: 300 };

describe('variables never render something false', () => {
  it('fills name, plan and credits from the real row', () => {
    const out = renderTemplate('Hi {name}, your {plan} plan has {credits} credits.', USER);
    expect(out).toBe('Hi Layla, your Basic plan has 300 credits.');
  });

  // The most important test in this file. Nothing in this database holds a
  // renewal date, because nothing renews. A plausible-looking date here would
  // be a lie shown to a paying customer.
  it('never invents a renewal date', () => {
    const out = renderTemplate('Your plan renews on {renewal_date}.', USER);
    expect(out).toBe(`Your plan renews on ${UNRESOLVED}.`);
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out).not.toMatch(/20\d\d/);
    expect(RESOLVABLE['{renewal_date}']).toBe(false);
  });

  it('warns the admin which variables cannot be resolved', () => {
    expect(unresolvedVariables('renews {renewal_date}')).toEqual(['{renewal_date}']);
    expect(unresolvedVariables('hi {name}, {credits} left')).toEqual([]);
  });

  it('falls back to the email local-part when there is no display name', () => {
    expect(renderTemplate('Hi {name}', { email: 'ahmed@example.com' })).toBe('Hi ahmed');
  });

  it('falls back to a greeting when there is neither', () => {
    expect(renderTemplate('Hi {name}', {})).toBe('Hi there');
  });

  it('says Free rather than blank when no package is set', () => {
    expect(renderTemplate('{plan}', { ...USER, package: null })).toBe('Free');
  });

  // Number(null) is 0. Telling someone they have 0 credits when the value is
  // unknown would push them to top up for no reason.
  it('renders unknown credits as unknown, NOT as 0', () => {
    expect(renderTemplate('{credits}', { ...USER, credits: null })).toBe(UNRESOLVED);
    expect(renderTemplate('{credits}', { ...USER, credits: null })).not.toBe('0');
    // A real zero balance is still reported honestly.
    expect(renderTemplate('{credits}', { ...USER, credits: 0 })).toBe('0');
  });

  it('renders half credits without a trailing .0 on whole numbers', () => {
    expect(renderTemplate('{credits}', { ...USER, credits: 4.5 })).toBe('4.5');
    expect(renderTemplate('{credits}', { ...USER, credits: 4 })).toBe('4');
  });

  // "ends {offer_end}" is an obvious bug; "ends " reads like a finished
  // sentence and would ship unnoticed.
  it('leaves an unknown token visible rather than blanking it', () => {
    expect(renderTemplate('ends {offer_end}', USER)).toBe('ends {offer_end}');
  });

  it('substitutes extras supplied by the caller', () => {
    expect(renderTemplate('You got {offer_name}!', USER, { '{offer_name}': 'Loyal +20%' }))
      .toBe('You got Loyal +20%!');
  });

  it('handles an empty or missing template', () => {
    expect(renderTemplate(null, USER)).toBe('');
    expect(renderTemplate('', USER)).toBe('');
  });

  it('every documented variable is either resolvable or explicitly not', () => {
    for (const v of VARIABLES) expect(typeof RESOLVABLE[v]).toBe('boolean');
  });
});

describe('the frequency cap never silences a system message', () => {
  it('blocks marketing once the cap is reached', () => {
    expect(canSend('promo', 0)).toBe(true);
    expect(canSend('promo', 1)).toBe(true);
    expect(canSend('promo', 2)).toBe(false);
    expect(canSend('announce', 5)).toBe(false);
  });

  // A customer whose generation failed must be told, however many promos they
  // were sent today.
  it.each(['gen', 'credits', 'renewal', 'payment', 'welcome'])(
    'always lets a %s notification through', (type) => {
      expect(isSystemType(type)).toBe(true);
      expect(canSend(type, 999)).toBe(true);
    });

  it.each(MANUAL_TYPES)('treats %s as marketing', (type) => {
    expect(isSystemType(type)).toBe(false);
  });

  // A cap that is null/0/NaN through a config mistake must not mute the whole
  // platform — failing open is right here, failing closed silences everyone.
  it('a misconfigured cap does not block everything', () => {
    for (const bad of [null, undefined, NaN, -1, 'x']) {
      expect(canSend('promo', 0, bad)).toBe(true);
    }
  });

  // The flip side of the guard above: a cap the owner deliberately sets to 0
  // IS a real instruction to pause marketing, and must be obeyed.
  it('honours a deliberate cap of 0 as "pause all marketing"', () => {
    expect(canSend('promo', 0, 0)).toBe(false);
    expect(canSend('gen', 0, 0)).toBe(true);   // system still gets through
  });

  it('splits an audience into sent and capped-out', () => {
    const recipients = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { send, skipped } = applyFrequencyCap('promo', recipients, { 1: 0, 2: 2, 3: 5 });
    expect(send.map((r) => r.id)).toEqual([1]);
    expect(skipped.map((r) => r.id)).toEqual([2, 3]);
  });

  it('caps nobody for a system type', () => {
    const { send, skipped } = applyFrequencyCap('gen', [{ id: 1 }, { id: 2 }], { 1: 9, 2: 9 });
    expect(send).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it('defaults to two marketing messages a day', () => {
    expect(DEFAULT_DAILY_MARKETING_CAP).toBe(2);
  });
});

describe('automations declare whether they can actually fire', () => {
  it('has all ten rules from the brief', () => {
    expect(AUTOMATIONS).toHaveLength(10);
  });

  // These three depend on subscriptions and payments, neither of which exists.
  it.each(['renewal_reminder', 'renewed', 'payment_failed'])(
    '%s is marked as needing a checkout', (key) => {
      expect(automationByKey(key).needs_checkout).toBe(true);
    });

  it.each(['low_credits', 'generation', 'welcome', 'onboarding', 'offer_received', 'offer_expiring', 'winback'])(
    '%s can fire on today\'s platform', (key) => {
      expect(automationByKey(key).needs_checkout).toBe(false);
    });

  it('reports exactly seven live rules', () => {
    expect(liveAutomations()).toHaveLength(7);
  });

  it('every rule has a known type and a template', () => {
    for (const a of AUTOMATIONS) {
      expect(TYPES[a.type], `${a.key} type`).toBeDefined();
      expect(a.template.length).toBeGreaterThan(0);
    }
  });

  it('returns null for an unknown key rather than throwing', () => {
    expect(automationByKey('nope')).toBeNull();
  });
});

describe('validateCompose', () => {
  const base = { type: 'announce', title: 'Hello', body: 'Some news', audience_mode: 'all' };
  const errs = (patch = {}, opts) => validateCompose({ ...base, ...patch }, opts);

  it('passes a complete draft', () => expect(errs()).toEqual([]));

  it.each([
    ['a type',    { type: 'nonsense' }, /message type/i],
    ['a title',   { title: '  ' },      /title/i],
    ['a message', { body: '' },         /message/i],
  ])('requires %s', (_l, patch, re) => expect(errs(patch).join(' · ')).toMatch(re));

  it('requires a client when hand-picking', () => {
    expect(errs({ audience_mode: 'picked', picked_client_ids: [] }).join(' · ')).toMatch(/pick at least one/i);
  });

  it('refuses a segment matching nobody', () => {
    expect(errs({ audience_mode: 'segment' }, { audienceCount: 0 }).join(' · ')).toMatch(/0 clients/i);
  });

  // A button that goes nowhere is a dead end in front of a customer.
  //
  // Both spellings are asserted deliberately. The rule originally read only
  // `cta`/`url` while every caller sent `cta_text`/`cta_url`, so it never
  // fired once in practice — a validation that cannot trigger is worse than
  // none, because it reads as covered.
  it.each([
    ['cta / url',           { cta: 'Claim it' }],
    ['cta_text / cta_url',  { cta_text: 'Claim it' }],
  ])('refuses button text with no link (%s)', (_label, patch) => {
    expect(errs(patch).join(' · ')).toMatch(/give the button a link/i);
  });

  it.each([
    ['cta / url',          { cta: 'Claim it', url: '/pricing' }],
    ['cta_text / cta_url', { cta_text: 'Claim it', cta_url: '/pricing' }],
  ])('accepts a button with a link (%s)', (_label, patch) => {
    expect(errs(patch)).toEqual([]);
  });

  it('refuses a notification that expires before it is sent', () => {
    expect(errs({ scheduled_for: '2026-09-01', expires_at: '2026-08-20' }).join(' · '))
      .toMatch(/expires before/i);
  });
});

describe('CTA links stay on our own site', () => {
  it.each(['/pricing', '/features/node-canvas', ''])('allows %s', (u) => {
    expect(isSafeCtaUrl(u)).toBe(true);
  });

  // "//evil.com" is protocol-relative — an absolute URL that a naive
  // "starts with /" check would wave through to every customer.
  it.each(['https://evil.com', '//evil.com', 'javascript:alert(1)', 'http://x'])(
    'refuses %s', (u) => {
      expect(isSafeCtaUrl(u)).toBe(false);
    });
});
