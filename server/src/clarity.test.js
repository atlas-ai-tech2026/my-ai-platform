// ─── clarity.test.js ─────────────────────────────────────────────────────────
// One of these tests is worth more than all the others put together:
//
//   the control panel is NEVER recorded.
//
// Session replay plays back what was on screen. The control panel shows 601
// customers' email addresses, their credit balances, promo codes, revenue and
// margins. Recording it would ship all of that to a third party, as video,
// because somebody wanted a heatmap of the marketing pages.
//
// So the tag is injected server-side and skipped for the admin route entirely —
// not hidden with CSS, not stopped after loading. Never sent.

import { describe, it, expect } from 'vitest';
import {
  shouldInject, injectClarity, clarityTag, ADMIN_ROUTE,
  CLARITY_SCRIPT_HOSTS, CLARITY_CONNECT_HOSTS,
} from './clarity.js';

const ON = { CLARITY_PROJECT_ID: 'y5h0454pmv' };
const PAGE = '<html><head><title>VOXEL.AI</title></head><body>x</body></html>';

describe('the control panel is never recorded', () => {
  it.each([
    [ADMIN_ROUTE],
    [`/${ADMIN_ROUTE}`],
    [`/${ADMIN_ROUTE}/`],
    [ADMIN_ROUTE.toUpperCase()],
    [`${ADMIN_ROUTE}/users`],
    [`/${ADMIN_ROUTE}/costing`],
  ])('refuses to inject on %s', (route) => {
    const v = shouldInject(route, ON);
    expect(v.inject,
      'the admin panel would have been session-recorded, sending customer emails, '
      + 'balances and revenue to a third party as video').toBe(false);
    expect(v.reason).toMatch(/never recorded/);
  });

  it('leaves the admin page byte-for-byte unchanged', () => {
    expect(injectClarity(PAGE, ADMIN_ROUTE, ON)).toBe(PAGE);
  });

  // Sub-paths matter: a future /x7k9-.../users must not become recordable just
  // because it is not an exact string match.
  it('covers everything beneath the admin route, not only the exact path', () => {
    expect(shouldInject(`${ADMIN_ROUTE}/anything/deeper`, ON).inject).toBe(false);
  });

  // …and must not swallow an unrelated route that merely starts similarly.
  it('does not over-reach onto a different route with the same prefix', () => {
    expect(shouldInject(`${ADMIN_ROUTE}-public`, ON).inject).toBe(true);
  });
});

describe('the customer pages do get it', () => {
  it.each([[''], ['image'], ['video'], ['explore'], ['pricing']])(
    'injects on /%s', (route) => {
      expect(shouldInject(route, ON).inject).toBe(true);
    });

  it('lands inside <head>, before the closing tag', () => {
    const out = injectClarity(PAGE, 'image', ON);
    expect(out).toMatch(/clarity\.ms\/tag\//);
    expect(out.indexOf('clarity')).toBeLessThan(out.indexOf('</head>'));
  });

  it('carries the project id', () => {
    expect(injectClarity(PAGE, 'image', ON)).toContain('y5h0454pmv');
  });
});

describe('off unless deliberately switched on', () => {
  // Keeps development and preview traffic out of the real project without
  // anyone having to remember, and lets the tag be removed everywhere by
  // clearing one variable instead of by shipping a deploy.
  it.each([[{}], [{ CLARITY_PROJECT_ID: '' }], [{ CLARITY_PROJECT_ID: '   ' }]])(
    'stays off with %s', (env) => {
      expect(shouldInject('image', env).inject).toBe(false);
      expect(injectClarity(PAGE, 'image', env)).toBe(PAGE);
    });

  // The id is interpolated into executable HTML. It is not secret, but
  // configuration should never be able to write script into the page.
  it.each([
    ['"></script><script>alert(1)</script>'],
    ['abc</script>'],
    ['id with spaces'],
    ['ab'],
  ])('refuses a project id that is not a plain token: %s', (id) => {
    const v = shouldInject('image', { CLARITY_PROJECT_ID: id });
    expect(v.inject).toBe(false);
    expect(v.reason).toMatch(/not a valid project id/);
  });

  it('a valid id produces a tag with no stray quotes or tags in it', () => {
    const tag = clarityTag('y5h0454pmv');
    expect(tag.match(/<script>/g)).toHaveLength(1);
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('a failed injection still leaves a working page', () => {
  // The analytics are worth considerably less than the site.
  it('returns the html untouched when there is no head to inject into', () => {
    const headless = '<html><body>hello</body></html>';
    expect(injectClarity(headless, 'image', ON)).toBe(headless);
  });

  it('never removes anything that was already on the page', () => {
    const out = injectClarity(PAGE, 'image', ON);
    expect(out).toContain('<title>VOXEL.AI</title>');
    expect(out).toContain('<body>x</body>');
  });
});

describe('the CSP hosts it needs', () => {
  // Without these the browser refuses the script outright: nothing is recorded,
  // the dashboard stays empty, and it looks like Clarity is broken.
  it('names the script host', () => {
    expect(CLARITY_SCRIPT_HOSTS).toContain('https://www.clarity.ms');
  });

  it('names the hosts it beacons back to', () => {
    expect(CLARITY_CONNECT_HOSTS).toContain('https://*.clarity.ms');
  });

  it('allows no scheme-wide wildcard — these are exact hosts', () => {
    for (const h of [...CLARITY_SCRIPT_HOSTS, ...CLARITY_CONNECT_HOSTS]) {
      expect(h).toMatch(/^https:\/\/[\w*.-]+$/);
      expect(h, 'a bare https: wildcard would undo the CSP work from the July audit')
        .not.toBe('https:');
    }
  });
});
