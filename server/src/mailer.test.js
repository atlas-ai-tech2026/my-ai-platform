// ─── mailer.test.js ──────────────────────────────────────────────────────────
// Sending real email to 580 real customers is the least reversible thing this
// codebase does. There is no undo. So the tests here are weighted toward the
// ways it could go WRONG rather than the happy path:
//
//   · test mode must be ON unless explicitly disabled, or a first run reaches
//     every customer instead of one inbox
//   · marketing mail must always carry an unsubscribe link (legal, and Resend
//     suspends domains that omit it); system mail must NOT
//   · a sender address off our domain must be refused, not sent — Resend would
//     reject it, and a rejection looks just like a delivered campaign
//   · a delivery failure must never throw into the caller, or a bounced
//     "your video is ready" would break the generation that succeeded

import { describe, it, expect, vi } from 'vitest';
import {
  sendEmail, senderFor, missingMailConfig, mailConfigured, isOwnDomainAddress,
  sendingDomain, unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl,
  renderEmail, htmlToText, escapeHtml, MailNotConfiguredError, MAIL_KINDS,
} from './mailer.js';

const ENV = {
  RESEND_API_KEY: 're_test_key',
  MAIL_FROM: 'no-reply@voxel-ai.ai',
  ADMIN_EMAIL: 'info@voxel-ai.ai',
  JWT_SECRET: 'test-secret',
  MAIL_TEST_MODE: 'false',          // most tests want the real path
  PUBLIC_BASE_URL: 'https://voxel-ai.ai',
};
const ok = () => ({ ok: true, status: 200, json: async () => ({ id: 'msg_1' }) });

/** Capture what would have been POSTed to Resend. */
function capture(response = ok) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return response();
  };
  return { calls, fetchImpl };
}

describe('configuration', () => {
  it('names exactly what is missing', () => {
    expect(missingMailConfig({})).toEqual(['RESEND_API_KEY', 'MAIL_FROM']);
    expect(missingMailConfig({ RESEND_API_KEY: 'k' })).toEqual(['MAIL_FROM']);
    expect(missingMailConfig(ENV)).toEqual([]);
    expect(mailConfigured(ENV)).toBe(true);
  });

  // A misconfiguration is the admin's problem to see — not something to
  // swallow into a "sent" that never happened.
  it('throws rather than pretending to send when nothing is configured', async () => {
    await expect(sendEmail({ to: 'a@b.com', subject: 'x', body: 'y' }, { env: {} }))
      .rejects.toBeInstanceOf(MailNotConfiguredError);
  });

  it('derives the verified domain from MAIL_FROM', () => {
    expect(sendingDomain(ENV)).toBe('voxel-ai.ai');
  });
});

describe('sender addresses', () => {
  const settings = {
    from_system: 'no-reply@voxel-ai.ai',
    from_announce: 'hello@voxel-ai.ai',
    from_billing: 'billing@voxel-ai.ai',
    from_support: 'support@voxel-ai.ai',
    from_legal: 'legal@voxel-ai.ai',
  };

  it.each([
    ['system',   'no-reply@voxel-ai.ai'],
    ['announce', 'hello@voxel-ai.ai'],
    ['promo',    'hello@voxel-ai.ai'],
    ['billing',  'billing@voxel-ai.ai'],
    ['support',  'support@voxel-ai.ai'],
    ['legal',    'legal@voxel-ai.ai'],
  ])('%s sends from %s', (kind, expected) => {
    expect(senderFor(kind, settings, ENV)).toBe(expected);
  });

  // Resend can only sign for the verified domain. A gmail sender would be
  // rejected at their end, and a rejection is indistinguishable from a
  // delivered campaign unless we refuse it here.
  it('refuses a sender on someone else’s domain and falls back', () => {
    expect(isOwnDomainAddress('support@gmail.com', ENV)).toBe(false);
    expect(senderFor('support', { from_support: 'support@gmail.com' }, ENV))
      .toBe('support@voxel-ai.ai');
  });

  it('accepts any address on our own domain without extra setup', () => {
    expect(isOwnDomainAddress('anything@voxel-ai.ai', ENV)).toBe(true);
    expect(senderFor('announce', { from_announce: 'news@voxel-ai.ai' }, ENV))
      .toBe('news@voxel-ai.ai');
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'not-an-email', 'a@b', '@voxel-ai.ai', null]) {
      expect(isOwnDomainAddress(bad, ENV)).toBe(false);
    }
  });

  it('every kind maps to a real setting and a same-domain fallback', () => {
    for (const [kind, spec] of Object.entries(MAIL_KINDS)) {
      expect(spec.setting, kind).toMatch(/^from_/);
      expect(isOwnDomainAddress(spec.fallback, ENV), kind).toBe(true);
    }
  });
});

describe('TEST MODE — the rail that protects 580 real inboxes', () => {
  it('is ON by default, when the env says nothing', async () => {
    const { calls, fetchImpl } = capture();
    const env = { ...ENV }; delete env.MAIL_TEST_MODE;
    const r = await sendEmail({ to: 'customer@example.com', subject: 'Hi', body: '<p>x</p>' },
      { env, fetchImpl });
    expect(r.testMode).toBe(true);
    expect(calls[0].body.to).toEqual(['info@voxel-ai.ai']);   // NOT the customer
  });

  it('only a literal "false" turns it off', async () => {
    for (const value of ['true', 'TRUE', 'yes', '1', 'off', '']) {
      const { calls, fetchImpl } = capture();
      await sendEmail({ to: 'customer@example.com', subject: 'Hi', body: 'x' },
        { env: { ...ENV, MAIL_TEST_MODE: value }, fetchImpl });
      expect(calls[0].body.to, `MAIL_TEST_MODE=${value}`).toEqual(['info@voxel-ai.ai']);
    }
    const { calls, fetchImpl } = capture();
    await sendEmail({ to: 'customer@example.com', subject: 'Hi', body: 'x' },
      { env: { ...ENV, MAIL_TEST_MODE: 'false' }, fetchImpl });
    expect(calls[0].body.to).toEqual(['customer@example.com']);
  });

  it('marks the subject and says who it WOULD have gone to', async () => {
    const { calls, fetchImpl } = capture();
    await sendEmail({ to: 'layla@example.com', subject: 'Your video is ready', body: '<p>x</p>' },
      { env: { ...ENV, MAIL_TEST_MODE: 'true' }, fetchImpl });
    expect(calls[0].body.subject).toBe('[TEST] Your video is ready');
    expect(calls[0].body.html).toContain('layla@example.com');
    expect(calls[0].body.html).toContain('TEST MODE');
  });
});

describe('unsubscribe', () => {
  it('marketing mail always carries a link and the one-click headers', async () => {
    const { calls, fetchImpl } = capture();
    await sendEmail({ to: 'c@example.com', subject: 'Offer', body: 'x', kind: 'announce' },
      { env: ENV, fetchImpl });
    expect(calls[0].body.html).toContain('Unsubscribe');
    expect(calls[0].body.headers['List-Unsubscribe']).toMatch(/^<https:\/\/voxel-ai\.ai\/api\/unsubscribe/);
    expect(calls[0].body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  // You cannot opt out of being able to get back into your own account.
  it.each(['system', 'billing', 'support', 'legal'])('%s mail carries NO unsubscribe', async (kind) => {
    const { calls, fetchImpl } = capture();
    await sendEmail({ to: 'c@example.com', subject: 'Reset', body: 'x', kind },
      { env: ENV, fetchImpl });
    expect(calls[0].body.html).not.toContain('Unsubscribe');
    expect(calls[0].body.headers).toBeUndefined();
  });

  it('tokens are per-address and verify', () => {
    const a = unsubscribeToken('one@example.com', ENV);
    const b = unsubscribeToken('two@example.com', ENV);
    expect(a).not.toBe(b);
    expect(verifyUnsubscribeToken('one@example.com', a, ENV)).toBe(true);
    expect(verifyUnsubscribeToken('one@example.com', b, ENV)).toBe(false);
    expect(verifyUnsubscribeToken('one@example.com', 'garbage', ENV)).toBe(false);
  });

  it('is case- and space-insensitive, so a link still works from any client', () => {
    expect(unsubscribeToken('  User@Example.COM ', ENV))
      .toBe(unsubscribeToken('user@example.com', ENV));
  });

  it('cannot be forged without the secret', () => {
    const token = unsubscribeToken('c@example.com', ENV);
    expect(verifyUnsubscribeToken('c@example.com', token, { ...ENV, JWT_SECRET: 'other' })).toBe(false);
  });

  it('builds a URL carrying both the address and the token', () => {
    const url = unsubscribeUrl('c@example.com', ENV);
    expect(url).toContain('email=c%40example.com');
    expect(url).toContain(`t=${unsubscribeToken('c@example.com', ENV)}`);
  });
});

describe('rendering', () => {
  it('escapes everything that could inject markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
    const html = renderEmail({ title: '<img onerror=x>', body: 'safe', ctaText: '"><b>', ctaUrl: '/x' });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  it('produces a plain-text part, because some clients show only that', () => {
    const text = htmlToText(renderEmail({ title: 'Hello', body: '<p>First</p><p>Second</p>' }));
    expect(text).toContain('Hello');
    expect(text).toContain('First');
    expect(text).not.toContain('<p>');
  });

  it('uses inline styles only — mail clients strip <style> blocks', () => {
    const html = renderEmail({ title: 'T', body: 'B' });
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).toContain('style="');
  });

  it('omits the button entirely when there is no link to give it', () => {
    expect(renderEmail({ title: 'T', body: 'B', ctaText: 'Click' })).not.toContain('Click');
  });
});

describe('failures never break the caller', () => {
  it('returns sent:false when Resend rejects, and does not throw', async () => {
    const fetchImpl = async () => ({ ok: false, status: 422, json: async () => ({ message: 'bad from' }) });
    const r = await sendEmail({ to: 'c@example.com', subject: 's', body: 'b' }, { env: ENV, fetchImpl });
    expect(r.sent).toBe(false);
    expect(r.status).toBe(422);
  });

  it('returns sent:false when the network throws', async () => {
    const fetchImpl = async () => { throw new Error('ECONNRESET'); };
    const r = await sendEmail({ to: 'c@example.com', subject: 's', body: 'b' }, { env: ENV, fetchImpl });
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/ECONNRESET/);
  });

  it('refuses an empty recipient instead of calling Resend', async () => {
    const { calls, fetchImpl } = capture();
    const r = await sendEmail({ to: '   ', subject: 's', body: 'b' }, { env: ENV, fetchImpl });
    expect(r.sent).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('the request Resend actually receives', () => {
  it('authenticates with the key and posts JSON', async () => {
    const { calls, fetchImpl } = capture();
    await sendEmail({ to: 'c@example.com', subject: 's', body: 'b' }, { env: ENV, fetchImpl });
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].init.headers.Authorization).toBe('Bearer re_test_key');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
  });

  // A password reset from no-reply@ that a confused customer replies to must
  // still reach a human.
  it('points replies to no-reply mail at support', async () => {
    const { calls, fetchImpl } = capture();
    await sendEmail({ to: 'c@example.com', subject: 's', body: 'b', kind: 'system' },
      { env: ENV, settings: { from_support: 'support@voxel-ai.ai' }, fetchImpl });
    expect(calls[0].body.reply_to).toBe('support@voxel-ai.ai');
  });

  it('sends a friendly From name alongside the address', async () => {
    const { calls, fetchImpl } = capture();
    await sendEmail({ to: 'c@example.com', subject: 's', body: 'b' }, { env: ENV, fetchImpl });
    expect(calls[0].body.from).toBe('Voxel <no-reply@voxel-ai.ai>');
  });
});
