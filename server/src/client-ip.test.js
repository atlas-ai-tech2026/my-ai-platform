// ─── client-ip.test.js ───────────────────────────────────────────────────────
// M2 (security audit 2026-07-28): CF-Connecting-IP / True-Client-IP /
// X-Forwarded-For were trusted from ANY caller, so a direct-to-origin
// attacker could mint a new rate-limit bucket per request and defeat every
// throttle. These tests cover BOTH paths the audit asked for:
//   • traffic genuinely through Cloudflare → per-user IPs still distinguished
//     (rate limiting must keep working for legitimate users)
//   • traffic straight to the origin → headers ignored, socket address used

import { describe, it, expect } from 'vitest';
import {
  resolveClientIp, isTrustedProxy, ipInCidr, normalizeIp,
  CLOUDFLARE_IPV4, CLOUDFLARE_IPV6,
} from './client-ip.js';

// A real Cloudflare edge address (inside 172.64.0.0/13).
const CF_EDGE = '172.68.1.1';
const CF_EDGE_2 = '104.16.5.5';       // inside 104.16.0.0/13
const CF_EDGE_V6 = '2606:4700::1111';
const RANDOM_HOST = '203.0.113.50';   // TEST-NET-3, not Cloudflare

// Production is Client → Cloudflare → DO ingress → Node, so `socket` is the
// DO load balancer and `req.ip` (Express, trust proxy 1) is whoever
// connected to it — the CF edge for real traffic, the attacker for direct
// hits. Model both so the trust anchor can't silently regress.
const DO_LB = '10.244.0.1';
const req = (headers, peer) => ({ headers, ip: peer, socket: { remoteAddress: DO_LB } });

describe('M2 — a direct-to-origin attacker cannot forge their IP', () => {
  it('IGNORES CF-Connecting-IP when the peer is not Cloudflare', () => {
    const r = req({ 'cf-connecting-ip': '1.2.3.4' }, RANDOM_HOST);
    expect(resolveClientIp(r)).toBe(RANDOM_HOST);
  });

  it('IGNORES True-Client-IP and X-Forwarded-For from a non-Cloudflare peer', () => {
    expect(resolveClientIp(req({ 'true-client-ip': '1.2.3.4' }, RANDOM_HOST))).toBe(RANDOM_HOST);
    expect(resolveClientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, RANDOM_HOST))).toBe(RANDOM_HOST);
  });

  it('the throttle-defeating attack fails: 1000 forged headers → ONE bucket', () => {
    const buckets = new Set();
    for (let i = 0; i < 1000; i++) {
      buckets.add(resolveClientIp(req({ 'cf-connecting-ip': `10.0.${i >> 8}.${i & 255}` }, RANDOM_HOST)));
    }
    expect(buckets.size).toBe(1);
    expect([...buckets][0]).toBe(RANDOM_HOST);
  });

  it('a spoofed header cannot impersonate someone else (audit-log poisoning)', () => {
    const r = req({ 'cf-connecting-ip': '8.8.8.8' }, '198.51.100.7');
    expect(resolveClientIp(r)).not.toBe('8.8.8.8');
    expect(resolveClientIp(r)).toBe('198.51.100.7');
  });
});

describe('M2 — legitimate Cloudflare traffic still resolves per-user IPs', () => {
  it('trusts CF-Connecting-IP when the peer IS a Cloudflare edge', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '81.2.3.4' }, CF_EDGE))).toBe('81.2.3.4');
    expect(resolveClientIp(req({ 'cf-connecting-ip': '81.2.3.4' }, CF_EDGE_2))).toBe('81.2.3.4');
  });

  it('works over an IPv6 Cloudflare edge too', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '81.2.3.4' }, CF_EDGE_V6))).toBe('81.2.3.4');
  });

  it('RATE LIMITING IS NOT BROKEN: different users behind CF get different keys', () => {
    // The regression this finding could easily cause — everyone collapsing
    // into one bucket and locking each other out.
    const users = ['81.2.3.4', '81.2.3.5', '90.1.1.1', '2001:db8::42'];
    const keys = users.map((u) => resolveClientIp(req({ 'cf-connecting-ip': u }, CF_EDGE)));
    expect(new Set(keys).size).toBe(users.length);
    expect(keys).toEqual(users);
  });

  it('falls back to the leftmost XFF entry when CF-Connecting-IP is absent', () => {
    expect(resolveClientIp(req({ 'x-forwarded-for': '81.2.3.4, 172.68.0.1' }, CF_EDGE)))
      .toBe('81.2.3.4');
  });

  it('prefers CF-Connecting-IP over XFF when both are present', () => {
    expect(resolveClientIp(req({
      'cf-connecting-ip': '81.2.3.4', 'x-forwarded-for': '9.9.9.9',
    }, CF_EDGE))).toBe('81.2.3.4');
  });

  it('falls back to the edge address if the header is missing or junk', () => {
    expect(resolveClientIp(req({}, CF_EDGE))).toBe(CF_EDGE);
    expect(resolveClientIp(req({ 'cf-connecting-ip': 'not-an-ip' }, CF_EDGE))).toBe(CF_EDGE);
  });
});

describe('M2 — the DO ingress hop must not break the trust anchor', () => {
  // The failure this guards against: anchoring on socket.remoteAddress
  // (always the DO load balancer) would fail every Cloudflare check and
  // collapse EVERY user into one rate-limit bucket.
  it('does not anchor trust on the socket address (the DO load balancer)', () => {
    const users = ['81.2.3.4', '81.2.3.5', '90.1.1.1'];
    const keys = users.map((u) => resolveClientIp({
      headers: { 'cf-connecting-ip': u },
      ip: CF_EDGE,                       // Express resolved past the DO hop
      socket: { remoteAddress: DO_LB },  // internal, never Cloudflare
    }));
    expect(new Set(keys).size).toBe(3);
    expect(keys).not.toContain(DO_LB);
  });

  it('the DO load balancer address alone is never treated as Cloudflare', () => {
    expect(isTrustedProxy(DO_LB)).toBe(false);
  });

  it('a direct hit past Cloudflare still resolves to the attacker, not the LB', () => {
    expect(resolveClientIp({
      headers: { 'cf-connecting-ip': '1.2.3.4' },
      ip: RANDOM_HOST,
      socket: { remoteAddress: DO_LB },
    })).toBe(RANDOM_HOST);
  });
});

describe('M2 — fail-safe when there is an internal proxy hop we did not model', () => {
  // The catastrophic failure this guards against: if the peer turns out NOT
  // to be a Cloudflare address (an extra internal LB hop), a naive
  // implementation ignores the headers and gives EVERY user the same
  // rate-limit key — locking the whole platform out. A private peer means
  // the request came through our own infrastructure, which an internet
  // attacker cannot fake, so the headers are still trustworthy there.
  it('trusts forwarding headers when the peer is a PRIVATE address', () => {
    ['10.244.0.1', '172.17.0.1', '192.168.1.10', '127.0.0.1'].forEach((lb) => {
      expect(resolveClientIp({ headers: { 'cf-connecting-ip': '81.2.3.4' }, ip: lb }), lb)
        .toBe('81.2.3.4');
    });
  });

  it('users stay in SEPARATE buckets behind an unmodelled internal hop', () => {
    const users = ['81.2.3.4', '81.2.3.5', '90.1.1.1'];
    const keys = users.map((u) => resolveClientIp({
      headers: { 'cf-connecting-ip': u }, ip: '10.244.0.1',
    }));
    expect(new Set(keys).size).toBe(3);
  });

  it('but a PUBLIC non-Cloudflare peer is still refused (the actual attack)', () => {
    // Reaching the origin directly from the internet always shows a public
    // peer, so forged headers remain worthless.
    expect(resolveClientIp({ headers: { 'cf-connecting-ip': '1.2.3.4' }, ip: RANDOM_HOST }))
      .toBe(RANDOM_HOST);
    expect(resolveClientIp({ headers: { 'cf-connecting-ip': '1.2.3.4' }, ip: '8.8.8.8' }))
      .toBe('8.8.8.8');
  });

  it('a private peer with NO forwarding header falls back to the peer', () => {
    expect(resolveClientIp({ headers: {}, ip: '10.244.0.1' })).toBe('10.244.0.1');
  });
});

describe('M2 — Cloudflare range membership', () => {
  it('recognises addresses in every published IPv4 range', () => {
    expect(isTrustedProxy('173.245.48.1')).toBe(true);
    expect(isTrustedProxy('103.21.244.1')).toBe(true);
    expect(isTrustedProxy('141.101.64.1')).toBe(true);
    expect(isTrustedProxy('162.158.0.1')).toBe(true);
    expect(isTrustedProxy('104.16.0.1')).toBe(true);
    expect(isTrustedProxy('131.0.72.1')).toBe(true);
  });

  it('recognises the published IPv6 ranges', () => {
    expect(isTrustedProxy('2400:cb00::1')).toBe(true);
    expect(isTrustedProxy('2606:4700::1')).toBe(true);
    expect(isTrustedProxy('2a06:98c0::1')).toBe(true);
  });

  it('rejects addresses just OUTSIDE a range (off-by-one boundaries)', () => {
    expect(isTrustedProxy('173.245.64.0')).toBe(false);  // 173.245.48.0/20 ends at .63.255
    expect(isTrustedProxy('131.0.76.0')).toBe(false);    // 131.0.72.0/22 ends at .75.255
    expect(isTrustedProxy('8.8.8.8')).toBe(false);
    expect(isTrustedProxy('203.0.113.1')).toBe(false);
  });

  it('rejects garbage and private addresses', () => {
    ['', null, undefined, 'not-an-ip', '10.0.0.1', '127.0.0.1', '192.168.1.1']
      .forEach((ip) => expect(isTrustedProxy(ip), String(ip)).toBe(false));
  });

  it('handles ::ffff: v4-mapped peers (dual-stack sockets)', () => {
    expect(normalizeIp('::ffff:172.68.1.1')).toBe('172.68.1.1');
    expect(isTrustedProxy('::ffff:172.68.1.1')).toBe(true);
    expect(isTrustedProxy('::ffff:8.8.8.8')).toBe(false);
  });

  it('the bundled lists match what Cloudflare publishes (count sanity)', () => {
    expect(CLOUDFLARE_IPV4).toHaveLength(15);
    expect(CLOUDFLARE_IPV6).toHaveLength(7);
  });
});

describe('CIDR matching', () => {
  it('matches IPv4 prefixes correctly', () => {
    expect(ipInCidr('192.168.1.5', '192.168.1.0/24')).toBe(true);
    expect(ipInCidr('192.168.2.5', '192.168.1.0/24')).toBe(false);
    expect(ipInCidr('10.0.0.1', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('255.255.255.255', '255.255.255.255/32')).toBe(true);
  });

  it('matches IPv6 prefixes correctly', () => {
    expect(ipInCidr('2606:4700::1', '2606:4700::/32')).toBe(true);
    expect(ipInCidr('2606:4701::1', '2606:4700::/32')).toBe(false);
    expect(ipInCidr('2a06:98c0::1', '2a06:98c0::/29')).toBe(true);
  });

  it('never matches across address families', () => {
    expect(ipInCidr('1.2.3.4', '2606:4700::/32')).toBe(false);
    expect(ipInCidr('2606:4700::1', '1.2.3.0/24')).toBe(false);
  });

  it('rejects malformed input instead of throwing', () => {
    expect(ipInCidr('1.2.3.4', 'garbage')).toBe(false);
    expect(ipInCidr('1.2.3.999', '1.2.3.0/24')).toBe(false);
    expect(ipInCidr('1.2.3.4', '1.2.3.0/99')).toBe(false);
  });
});
