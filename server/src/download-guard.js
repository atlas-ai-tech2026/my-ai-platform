// ─── download-guard.js ───────────────────────────────────────────────────────
// H1 (security audit 2026-07-28): /api/download was an unauthenticated open
// proxy — any URL, including cloud metadata (169.254.169.254) and internal
// services, could be fetched through the server. This module is the guard:
//
//   1. Host allow-list — only OUR storage/CDN hosts and the AI-provider CDNs
//      the app actually serves outputs from (derived from the codebase):
//        • fal.media            — FAL output CDN (v3.fal.media, …)
//        • redpandaai.co        — kie.ai file hosts (tempfile./kieai.…)
//        • DO Spaces hosts      — derived from SPACES_* env (storage.js)
//   2. DNS check — after resolution, every address must be public: loopback,
//      private (RFC1918), link-local (incl. 169.254.169.254), CGNAT and
//      unique-local/v4-mapped IPv6 are rejected. Re-run on every redirect.
//
// Pure functions with injectable DNS lookup so tests need no network.

import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

// ---- host allow-list -------------------------------------------------------

function envHost(value) {
  if (!value) return null;
  try { return new URL(String(value).trim()).hostname.toLowerCase(); }
  catch { return String(value).trim().toLowerCase() || null; }
}

/**
 * Build the allowed host-suffix list. Static provider CDNs + our Spaces
 * hosts from env. A hostname is allowed when it equals an entry or ends
 * with '.' + entry (proper label boundary — no 'evilfal.media' bypass).
 */
export function buildAllowedHostSuffixes(env = process.env) {
  const list = [
    'fal.media',       // FAL output CDN
    'redpandaai.co',   // kie.ai file/temp hosts
  ];
  const endpoint = envHost(env.SPACES_ENDPOINT);       // fra1.digitaloceanspaces.com
  const cdnBase = envHost(env.SPACES_CDN_BASE);        // voxel-media.fra1.cdn.digitaloceanspaces.com
  const bucket = (env.SPACES_BUCKET || '').trim().toLowerCase();
  if (endpoint) {
    list.push(endpoint);
    if (bucket) list.push(`${bucket}.${endpoint}`);
    // Spaces also serves via the CDN edge host (region.cdn.digitaloceanspaces.com)
    const cdnVariant = endpoint.replace(/^([a-z0-9-]+)\./, '$1.cdn.');
    if (cdnVariant !== endpoint) {
      list.push(cdnVariant);
      if (bucket) list.push(`${bucket}.${cdnVariant}`);
    }
  }
  if (cdnBase) list.push(cdnBase);
  return [...new Set(list)];
}

export function isAllowedDownloadHost(hostname, suffixes = buildAllowedHostSuffixes()) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  return suffixes.some((s) => h === s || h.endsWith('.' + s));
}

// ---- private / internal address rejection ----------------------------------

/** True when the IP must never be fetched: loopback, private, link-local
 * (cloud metadata), CGNAT, unspecified, or their IPv6 equivalents. */
export function isPrivateAddress(ip) {
  const s = String(ip || '').trim();
  if (net.isIPv4(s)) {
    const [a, b] = s.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;          // this-net, private, loopback
    if (a === 169 && b === 254) return true;                    // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;           // private
    if (a === 192 && b === 168) return true;                    // private
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
    if (a >= 224) return true;                                  // multicast/reserved
    return false;
  }
  if (net.isIPv6(s)) {
    const v6 = s.toLowerCase();
    // v4-mapped/translated (::ffff:10.0.0.1 …) — check the embedded v4
    const m = v6.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateAddress(m[1]);
    if (v6 === '::' || v6 === '::1') return true;               // unspecified, loopback
    if (v6.startsWith('fe8') || v6.startsWith('fe9') ||
        v6.startsWith('fea') || v6.startsWith('feb')) return true; // link-local fe80::/10
    if (v6.startsWith('fc') || v6.startsWith('fd')) return true;   // unique-local fc00::/7
    if (v6.startsWith('ff')) return true;                       // multicast
    return false;
  }
  return true; // not an IP at all → treat as unsafe
}

// ---- URL validation --------------------------------------------------------

export class DownloadRejectedError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'DownloadRejectedError';
    this.status = status;
  }
}

/**
 * Validate one download target (also called for every redirect hop):
 * https only → host on the allow-list → all resolved addresses public.
 * Returns the parsed URL. `lookup` is injectable for tests.
 */
export async function assertSafeDownloadUrl(urlString, {
  lookup = dnsLookup,
  suffixes = buildAllowedHostSuffixes(),
} = {}) {
  let u;
  try {
    u = new URL(String(urlString));
  } catch {
    throw new DownloadRejectedError('Invalid url', 400);
  }
  if (u.protocol !== 'https:') {
    throw new DownloadRejectedError('Only https downloads are allowed', 400);
  }
  if (u.username || u.password) {
    throw new DownloadRejectedError('Credentials in url are not allowed', 400);
  }
  if (!isAllowedDownloadHost(u.hostname, suffixes)) {
    throw new DownloadRejectedError('This host is not an allowed download source', 403);
  }
  // A literal IP can never be on the (name-based) allow-list, but be explicit.
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) {
    throw new DownloadRejectedError('IP-literal urls are not allowed', 403);
  }
  let addrs;
  try {
    addrs = await lookup(u.hostname, { all: true, verbatim: true });
  } catch {
    throw new DownloadRejectedError('Could not resolve download host', 400);
  }
  if (!addrs?.length) {
    throw new DownloadRejectedError('Could not resolve download host', 400);
  }
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new DownloadRejectedError('Download host resolves to a private address', 403);
    }
  }
  return u;
}

/** Strip anything header-unsafe from a client-supplied filename: keep only
 * the basename (no path traversal), drop CR/LF and quotes (header
 * injection), and reject names that are only dots/separators. */
export function sanitizeFilename(name, fallback = `voxel-${Date.now()}`) {
  const basename = String(name || '').split(/[/\\]/).pop() || '';
  const cleaned = basename
    .replace(/[^\w.\- ]+/g, '')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
