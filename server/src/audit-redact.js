// ─── audit-redact.js ─────────────────────────────────────────────────────────
// M1 (security audit 2026-07-28): the admin audit log serialized the WHOLE
// request body, so `POST /api/admin/users/:id/reset-password` wrote the
// customer's new plaintext password straight into admin_audit_log — readable
// by anyone with database access and copied into every backup.
//
// Two layers, deliberately belt-and-braces:
//   1. an explicit PER-ROUTE ALLOW-LIST of fields worth recording. Anything
//      not named is dropped, so a new route can't leak a new secret by
//      default — the failure mode is "we logged too little", not "we logged
//      a password".
//   2. a redaction sweep that blanks any key matching /password/i (plus
//      token/secret/key shapes) regardless of the allow-list, so a mistake
//      in (1) still can't write a credential.

// Route path → fields safe to record. Keys are the Express route paths
// (req.route.path), which stay stable even as :id values change.
export const AUDIT_FIELD_ALLOWLIST = {
  '/api/admin/users/:id/credits':       ['amount', 'action', 'reason'],
  '/api/admin/users/:id/ban':           ['banned', 'reason'],
  // NOTE: new_password is deliberately absent — we record THAT a reset
  // happened, never the value.
  '/api/admin/users/:id/reset-password': [],
  '/api/admin/users/bulk':              ['count', 'package', 'credits', 'expires_at', 'allowed_models', 'prefix'],
  '/api/admin/promocodes':              ['code', 'credits', 'max_redemptions', 'expires_at'],
  '/api/admin/promocodes/:id/toggle':   ['active'],
  '/api/admin/giftcards':               ['count', 'credits', 'expires_at'],
  // 2FA routes: never record the submitted code or the secret.
  '/api/admin/2fa/setup':               [],
  '/api/admin/2fa/confirm':             [],
  '/api/admin/2fa/disable':             [],
};

// Any key matching these is blanked no matter what. Covers password,
// new_password, current_password, totp_code, api_key, token, secret…
const SENSITIVE_KEY = /(password|passwd|secret|token|api[-_]?key|totp|recovery|authorization|cookie)/i;

export const REDACTED = '[REDACTED]';

/** Recursively blank sensitive values anywhere in a structure. */
export function redactSensitive(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactSensitive(v, depth + 1);
  }
  return out;
}

/**
 * Build the payload_summary for one admin request.
 *
 * @param routePath  req.route?.path (e.g. '/api/admin/users/:id/credits')
 * @param method     HTTP method
 * @param body       req.body
 * @returns a JSON string capped at 2000 chars, or null when there's
 *          nothing safe to record.
 */
export function buildAuditSummary(routePath, method, body) {
  if (String(method || '').toUpperCase() !== 'POST') return null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const allowed = AUDIT_FIELD_ALLOWLIST[routePath];

  // Unknown route → record only that a body was present, plus its field
  // NAMES (useful for debugging, and a name is not a secret). Values are
  // withheld until the route is added to the allow-list above.
  if (!allowed) {
    const keys = Object.keys(body).slice(0, 20);
    if (!keys.length) return null;
    return truncate(JSON.stringify({ _unlisted_route: true, fields: keys }));
  }

  const picked = {};
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      picked[field] = body[field];
    }
  }
  if (!Object.keys(picked).length) return null;

  return truncate(JSON.stringify(redactSensitive(picked)));
}

// JSON.stringify then slice can cut mid-token and produce invalid JSON in a
// JSONB column (the old code did exactly that). Fall back to a valid marker
// object instead of writing something Postgres will reject.
function truncate(json, max = 2000) {
  if (json.length <= max) return json;
  return JSON.stringify({ _truncated: true, bytes: json.length });
}
