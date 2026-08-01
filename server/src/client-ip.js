// ─── client-ip.js ────────────────────────────────────────────────────────────
// M2 (security audit 2026-07-28): the server trusted `CF-Connecting-IP` /
// `True-Client-IP` / `X-Forwarded-For` from ANY caller. Those are just
// request headers — anyone who can reach the origin directly could send
// `CF-Connecting-IP: 1.2.3.4` and get a fresh rate-limit bucket per request,
// defeating every brute-force and abuse throttle, and poisoning the audit log.
//
// The headers are only meaningful when the request actually came THROUGH
// Cloudflare, so they are now trusted only when the direct peer address is
// inside Cloudflare's published ranges. Otherwise we use the socket address.
//
// ── UPDATING THE RANGES ────────────────────────────────────────────────────
// Source of truth: https://www.cloudflare.com/ips-v4 and .../ips-v6
// (also https://api.cloudflare.com/client/v4/ips). Cloudflare changes these
// rarely — a few times a decade. Refresh with:
//     curl -s https://www.cloudflare.com/ips-v4
//     curl -s https://www.cloudflare.com/ips-v6
// and paste below. Snapshot taken 2026-08-01.
//
// ⚠️ INFRASTRUCTURE TASK (manual, not code): the DigitalOcean origin
// firewall must allow ONLY Cloudflare's ranges. Otherwise an attacker can
// still bypass Cloudflare entirely by hitting the origin IP directly — they
// just can't forge the client IP any more. See README-SECURITY.md.

import net from 'node:net';

export const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

export const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

// Extra trusted proxies (e.g. the DO App Platform ingress in front of us, or
// a test harness). Comma-separated CIDRs via TRUSTED_PROXY_CIDRS.
const EXTRA = (process.env.TRUSTED_PROXY_CIDRS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// ---- CIDR matching --------------------------------------------------------

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n * 256) + b;
  }
  return n;
}

/** Expand an IPv6 address to its 8 16-bit groups as BigInt. */
function ipv6ToBigInt(ip) {
  let addr = ip;
  // Strip a zone index (fe80::1%eth0) and any v4-mapped tail.
  addr = addr.split('%')[0];
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n == null) return null;
    const hi = (n >>> 16) & 0xffff;
    const lo = n & 0xffff;
    addr = addr.slice(0, v4.index) + hi.toString(16) + ':' + lo.toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

/** Is `ip` inside `cidr`? Handles both v4 and v6. */
export function ipInCidr(ip, cidr) {
  const [range, bitsRaw] = String(cidr).split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits)) return false;

  if (net.isIPv4(ip) && net.isIPv4(range)) {
    if (bits < 0 || bits > 32) return false;
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(range);
    if (a == null || b == null) return false;
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }

  if (net.isIPv6(ip) && net.isIPv6(range)) {
    if (bits < 0 || bits > 128) return false;
    const a = ipv6ToBigInt(ip);
    const b = ipv6ToBigInt(range);
    if (a == null || b == null) return false;
    if (bits === 0) return true;
    const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
    return (a & mask) === (b & mask);
  }

  return false; // family mismatch
}

/** Normalise ::ffff:1.2.3.4 (how Node reports v4 on a dual-stack socket). */
export function normalizeIp(ip) {
  const s = String(ip || '').trim();
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : s;
}

/** Is the DIRECT peer a Cloudflare edge (or a configured trusted proxy)? */
export function isTrustedProxy(peerIp) {
  const ip = normalizeIp(peerIp);
  if (!net.isIP(ip)) return false;
  return [...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6, ...EXTRA]
    .some((cidr) => ipInCidr(ip, cidr));
}

/**
 * Resolve the real client IP.
 *
 * When the peer IS Cloudflare, CF-Connecting-IP is authoritative
 * (Cloudflare overwrites it, a client cannot forge it through the edge) —
 * so per-user rate limiting keeps working correctly for real traffic.
 * When the peer is NOT Cloudflare, every forwarding header is ignored and
 * the peer address is used, so a direct-to-origin attacker gets exactly
 * one bucket: their own address.
 *
 * ── WHICH ADDRESS IS "THE PEER" ────────────────────────────────────────
 * Production is Client → Cloudflare → DO App Platform ingress → Node, so
 * `socket.remoteAddress` is the DO LOAD BALANCER, never Cloudflare. Using
 * it as the trust anchor would fail every check and collapse ALL users
 * into a single rate-limit bucket — the exact regression this fix must
 * avoid.
 *
 * `req.ip` is the right anchor: with `trust proxy: 1` Express skips the
 * one trusted hop (the DO ingress) and yields whoever connected to it.
 * Verified against a real Express app:
 *   XFF "81.2.3.4, 172.68.1.1" → req.ip = 172.68.1.1 (the CF edge)   → trust
 *   XFF "1.2.3.4, 203.0.113.50" → req.ip = 203.0.113.50 (attacker)   → ignore
 *
 * @param req  { headers, ip, socket }
 * @param peerIpOverride  for tests
 */
export function resolveClientIp(req, peerIpOverride) {
  const peer = normalizeIp(
    peerIpOverride ?? req?.ip ?? req?.socket?.remoteAddress ?? ''
  );

  if (isTrustedProxy(peer)) {
    const h = req?.headers || {};
    const cf = normalizeIp(h['cf-connecting-ip'] || h['true-client-ip'] || '');
    if (net.isIP(cf)) return cf;
    // XFF from a trusted edge: leftmost entry is the original client.
    const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
    const first = normalizeIp(xff);
    if (net.isIP(first)) return first;
  }
  return peer;
}
