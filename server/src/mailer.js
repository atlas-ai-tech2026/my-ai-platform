// ─── mailer.js ───────────────────────────────────────────────────────────────
// Sending email through Resend.
//
// NO NEW DEPENDENCY. Resend's API is one HTTPS POST, and Node 20 has fetch
// built in — adding their SDK would pull a package tree onto a 1 GB instance to
// save four lines. CLAUDE.md's rule is to check the stdlib first; this is that.
//
// ── FIVE SENDER ADDRESSES, ONE DOMAIN ────────────────────────────────────────
// Resend is verified for the whole of voxel-ai.ai, so any address on it can
// send with no extra setup. The owner created info@ (a real Microsoft 365
// mailbox) plus billing@, hello@, support@ and legal@ as aliases of it, so
// replies to any of them land in one inbox.
//
//   no-reply@  password resets, security alerts  — nobody should reply
//   hello@     announcements, offers, welcome    — replies welcome
//   billing@   invoices, credit receipts
//   support@   support and failure notices
//   legal@     terms and policy changes
//
// The mapping is configurable from the CRM, so changing which address sends
// what needs no deploy.
//
// ── TWO SAFETY RAILS, BOTH ON BY DEFAULT ─────────────────────────────────────
// 1. TEST MODE redirects every message to the admin address. Production has 580
//    real customers; the first wrong loop must land in one inbox, not 580.
// 2. MARKETING MAIL CARRIES AN UNSUBSCRIBE LINK, always. It is a legal
//    requirement, and Resend will suspend a domain that ignores it. System mail
//    (password reset, generation ready) is exempt — you cannot opt out of being
//    able to get back into your account.

import crypto from 'node:crypto';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Message kinds → which sender address, and whether it is marketing. */
export const MAIL_KINDS = {
  system:   { setting: 'from_system',   fallback: 'no-reply@voxel-ai.ai', marketing: false },
  announce: { setting: 'from_announce', fallback: 'hello@voxel-ai.ai',    marketing: true  },
  promo:    { setting: 'from_announce', fallback: 'hello@voxel-ai.ai',    marketing: true  },
  billing:  { setting: 'from_billing',  fallback: 'billing@voxel-ai.ai',  marketing: false },
  support:  { setting: 'from_support',  fallback: 'support@voxel-ai.ai',  marketing: false },
  legal:    { setting: 'from_legal',    fallback: 'legal@voxel-ai.ai',    marketing: false },
};

export class MailNotConfiguredError extends Error {
  constructor(missing) {
    super(`Email is not configured — missing ${missing.join(' and ')}.`);
    this.name = 'MailNotConfiguredError';
    this.status = 503;
    this.missing = missing;
  }
}

/** What is missing before anything can send. Empty array = ready. */
export function missingMailConfig(env = process.env) {
  const missing = [];
  if (!String(env.RESEND_API_KEY || '').trim()) missing.push('RESEND_API_KEY');
  if (!String(env.MAIL_FROM || '').trim()) missing.push('MAIL_FROM');
  return missing;
}

export function mailConfigured(env = process.env) {
  return missingMailConfig(env).length === 0;
}

/**
 * The domain Resend is verified for, derived from MAIL_FROM. A sender on any
 * other domain is refused rather than sent: Resend would reject it anyway, and
 * a silent rejection looks exactly like a delivered campaign.
 */
export function sendingDomain(env = process.env) {
  const from = String(env.MAIL_FROM || '').trim();
  const at = from.lastIndexOf('@');
  return at === -1 ? '' : from.slice(at + 1).toLowerCase();
}

export function isOwnDomainAddress(address, env = process.env) {
  const domain = sendingDomain(env);
  if (!domain) return false;
  const a = String(address || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a)) return false;
  return a.endsWith('@' + domain);
}

/**
 * Which address a kind sends from. Settings win; the fallback is used only
 * when the CRM has not set one. An address off our domain is ignored rather
 * than used, because Resend cannot sign for it.
 */
export function senderFor(kind, settings = {}, env = process.env) {
  const spec = MAIL_KINDS[kind] || MAIL_KINDS.system;
  const configured = String(settings[spec.setting] || '').trim();
  if (configured && isOwnDomainAddress(configured, env)) return configured;
  if (isOwnDomainAddress(spec.fallback, env)) return spec.fallback;
  return String(env.MAIL_FROM || '').trim();
}

/**
 * A per-recipient unsubscribe token. HMAC of the email with the app's JWT
 * secret: no table to keep, cannot be forged, and revoking is a secret change.
 */
export function unsubscribeToken(email, env = process.env) {
  const secret = String(env.JWT_SECRET || 'unset');
  return crypto.createHmac('sha256', secret)
    .update(String(email).trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email, token, env = process.env) {
  const expected = unsubscribeToken(email, env);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token || ''));
  // Constant-time compare; length check first because timingSafeEqual throws
  // on a length mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubscribeUrl(email, env = process.env) {
  const base = String(env.PUBLIC_BASE_URL || 'https://voxel-ai.ai').replace(/\/+$/, '');
  const q = new URLSearchParams({ email: String(email), t: unsubscribeToken(email, env) });
  return `${base}/api/unsubscribe?${q}`;
}

/** Minimal HTML escaping — every value below comes from admin input or the DB. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Wrap a message body in the Voxel shell. Inline styles only — every mail
 * client strips <style> blocks, and half of them ignore <head> entirely.
 */
export function renderEmail({ title, body, ctaText, ctaUrl, footerNote, unsubUrl }) {
  const cta = ctaText && ctaUrl
    ? `<tr><td style="padding:26px 0 6px">
         <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#e0442c;color:#ffffff;
            text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:10px">
           ${escapeHtml(ctaText)}</a></td></tr>`
    : '';
  const unsub = unsubUrl
    ? `<p style="margin:18px 0 0;font-size:11.5px;color:#8b8b93">
         Don't want these emails?
         <a href="${escapeHtml(unsubUrl)}" style="color:#8b8b93">Unsubscribe</a>.
       </p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0f0f12">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:32px 16px">
 <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:560px;background:#17171c;border-radius:16px;padding:34px 32px;
                font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
   <tr><td style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:.02em;padding-bottom:22px">
     VOXEL<span style="color:#e0442c">.AI</span></td></tr>
   <tr><td style="font-size:21px;font-weight:700;color:#ffffff;line-height:1.3;padding-bottom:14px">
     ${escapeHtml(title)}</td></tr>
   <tr><td style="font-size:15px;line-height:1.65;color:#c9c9d2">${body}</td></tr>
   ${cta}
   <tr><td style="padding-top:30px;border-top:1px solid rgba(255,255,255,.09);margin-top:20px">
     <p style="margin:16px 0 0;font-size:12px;color:#8b8b93">
       ${escapeHtml(footerNote || 'You are receiving this because you have a Voxel account.')}
     </p>${unsub}
   </td></tr>
  </table>
 </td></tr>
</table></body></html>`;
}

/** Strip tags for the plain-text part. Some clients show only this. */
export function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Send one email.
 *
 * NEVER THROWS on a delivery failure — a bounced notification must not break
 * the action that triggered it. It returns {sent:false, reason} instead, and
 * the caller decides. It DOES throw MailNotConfiguredError when nothing is set
 * up, because that is a configuration mistake the admin has to see, not a
 * transient failure to swallow.
 */
export async function sendEmail({
  to, subject, title, body, ctaText, ctaUrl, kind = 'system', footerNote,
}, {
  env = process.env, settings = {}, fetchImpl = fetch,
} = {}) {
  const missing = missingMailConfig(env);
  if (missing.length) throw new MailNotConfiguredError(missing);

  const spec = MAIL_KINDS[kind] || MAIL_KINDS.system;
  const from = senderFor(kind, settings, env);

  // TEST MODE — on unless explicitly disabled. Everything goes to the admin.
  const testMode = String(env.MAIL_TEST_MODE ?? 'true').toLowerCase() !== 'false';
  const realTo = String(to || '').trim();
  if (!realTo) return { sent: false, reason: 'no recipient' };
  const adminAddress = String(env.ADMIN_EMAIL || 'info@voxel-ai.ai').trim();
  const recipient = testMode ? adminAddress : realTo;

  const unsubUrl = spec.marketing ? unsubscribeUrl(realTo, env) : null;
  const html = renderEmail({
    title: title || subject,
    // Test mode says WHO it would have gone to, so a test tells you something.
    body: testMode
      ? `<p style="margin:0 0 14px;padding:10px 14px;background:rgba(224,68,44,.14);
           border:1px solid rgba(224,68,44,.4);border-radius:8px;color:#ffb4a6;font-size:13px">
           <b>TEST MODE</b> — this would have been sent to ${escapeHtml(realTo)}.
         </p>${body}`
      : body,
    ctaText, ctaUrl, footerNote, unsubUrl,
  });

  const payload = {
    from: `Voxel <${from}>`,
    to: [recipient],
    subject: testMode ? `[TEST] ${subject}` : subject,
    html,
    text: htmlToText(html),
  };
  // One-click unsubscribe headers: Gmail and Outlook surface these in their own
  // UI, and their absence on bulk mail hurts deliverability.
  if (unsubUrl) {
    payload.headers = {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  // Replies to no-reply@ would vanish; point them somewhere a human reads.
  if (kind === 'system') {
    const support = senderFor('support', settings, env);
    if (support && support !== from) payload.reply_to = support;
  }

  try {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify(await res.json()); } catch { /* non-JSON */ }
      console.error(`[mail] send failed ${res.status}: ${detail}`);
      return { sent: false, reason: `Resend returned ${res.status}`, status: res.status, detail };
    }
    const data = await res.json().catch(() => ({}));
    return { sent: true, id: data?.id || null, to: recipient, from, testMode };
  } catch (e) {
    console.error('[mail] send threw:', e.message);
    return { sent: false, reason: e.message };
  }
}
