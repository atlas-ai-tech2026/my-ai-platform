// ─── audience.test.js ────────────────────────────────────────────────────────
// The owner, 2026-08-20: "we need the old data also, or we cannot see the
// history of the site."
//
// Half of that is possible and half is not, and the tests below are mostly
// about keeping those two halves clearly apart:
//
//   ANONYMOUS VISITS — nothing ever recorded them. They begin the day this
//   ships. A plausible-looking backfilled curve would be worse than an empty
//   chart, because it would be believed.
//
//   SIGNED-IN ACTIVITY — full history, from signup and ledger dates that were
//   always kept. Answerable today, with no new tracking.
//
// The other theme: a page-view count that includes crawlers, uptime probes and
// the owner's own browsing is not an answer to "how many people reached my
// site". It is a bigger number that feels better.

import { describe, it, expect } from 'vitest';
import {
  shouldCount, isBot, visitorHash, referrerHost, sessionsFromActions,
  dailyEngagement, median, fillDays, provenance, ADMIN_ROUTE,
} from './audience.js';

const page = (over = {}) => ({ path: '/image', method: 'GET', accept: 'text/html', userAgent: 'Mozilla/5.0', ...over });

describe('what counts as a visit', () => {
  it('a real page load does', () => {
    expect(shouldCount(page()).count).toBe(true);
  });

  it.each([
    ['/api/generate', 'an API call'],
    ['/assets/index-abc.js', 'a script'],
    ['/media/hero.mp4', 'a video'],
    ['/favicon.ico', 'a file'],
    ['/sitemap.xml', 'a file'],
  ])('%s does not (%s)', (path) => {
    expect(shouldCount(page({ path })).count).toBe(false);
  });

  it('a POST is not a page view', () => {
    expect(shouldCount(page({ method: 'POST' })).count).toBe(false);
  });

  it('a fetch for JSON is not a visit', () => {
    expect(shouldCount(page({ accept: 'application/json' })).count).toBe(false);
  });

  // Otherwise "how many people reached my site" is mostly crawlers, and the
  // number goes up whenever Google feels energetic.
  it.each([
    ['Googlebot/2.1 (+http://www.google.com/bot.html)'],
    ['Mozilla/5.0 (compatible; bingbot/2.0)'],
    ['facebookexternalhit/1.1'],
    ['curl/8.4.0'],
    ['python-requests/2.31.0'],
    ['Better Uptime Bot'],
    ['HeadlessChrome/120'],
  ])('a bot does not: %s', (ua) => {
    expect(isBot(ua)).toBe(true);
    expect(shouldCount(page({ userAgent: ua })).count).toBe(false);
  });

  // Conservative on purpose: a wrong exclusion shrinks the number silently and
  // nobody ever finds out.
  it.each([[''], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'], ['Safari/605.1.15']])(
    'an odd or missing user-agent is NOT assumed to be a bot: %s', (ua) => {
      expect(isBot(ua)).toBe(false);
    });

  // Same reasoning as the Clarity exclusion: this is our own screen, and
  // counting it would put the owner's own browsing into their traffic figures.
  it.each([[ADMIN_ROUTE], [`/${ADMIN_ROUTE}`], [`/${ADMIN_ROUTE}/users`]])(
    'the control panel is not audience: %s', (path) => {
      expect(shouldCount(page({ path })).count).toBe(false);
    });
});

describe('counting people without being able to follow them', () => {
  const base = { ip: '1.2.3.4', userAgent: 'Mozilla/5.0', salt: 's3cr3t' };

  it('the same person on the same day is one visitor', () => {
    expect(visitorHash({ ...base, day: '2026-08-20' }))
      .toBe(visitorHash({ ...base, day: '2026-08-20' }));
  });

  it('two different people on the same day are two', () => {
    expect(visitorHash({ ...base, day: '2026-08-20' }))
      .not.toBe(visitorHash({ ...base, ip: '5.6.7.8', day: '2026-08-20' }));
  });

  // THE PRIVACY PROPERTY. The salt rotates daily, so yesterday's hash cannot be
  // matched to today's — it answers "how many came today" and builds nothing
  // that could follow a person over time.
  it('the same person tomorrow is unrecognisable', () => {
    expect(visitorHash({ ...base, day: '2026-08-20', salt: 'mon' }))
      .not.toBe(visitorHash({ ...base, day: '2026-08-21', salt: 'tue' }));
  });

  it('stores nothing that looks like an address', () => {
    const h = visitorHash({ ...base, day: '2026-08-20' });
    expect(h).toMatch(/^[a-f0-9]{32}$/);
    expect(h).not.toContain('1.2.3.4');
  });

  it('declines to invent an identity with no address to work from', () => {
    expect(visitorHash({ ip: '', day: '2026-08-20' })).toBeNull();
  });
});

describe('where they came from', () => {
  const OWN = ['voxel-ai.ai', 'www.voxel-ai.ai'];

  it('no referrer is "direct"', () => {
    expect(referrerHost('', OWN)).toBe('direct');
    expect(referrerHost(null, OWN)).toBe('direct');
  });

  it('an outside site is named, without www', () => {
    expect(referrerHost('https://www.linkedin.com/feed/x', OWN)).toBe('linkedin.com');
    expect(referrerHost('https://t.co/abc', OWN)).toBe('t.co');
  });

  // Clicking /image → /video is navigation, not a referral. Counting it would
  // make our own site the top source of our own traffic: true, useless, and it
  // would crowd out the real answer.
  it('our own pages are never a source of traffic', () => {
    expect(referrerHost('https://voxel-ai.ai/image', OWN)).toBe('direct');
    expect(referrerHost('https://www.voxel-ai.ai/pricing', OWN)).toBe('direct');
  });

  it('survives a malformed referrer instead of throwing', () => {
    expect(referrerHost('not a url', OWN)).toBe('direct');
    expect(referrerHost('javascript:alert(1)', OWN)).toBe('direct');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the history that DOES exist — activity from dates already kept', () => {
  const T = (day, h, m = 0) => new Date(`2026-08-${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const rows = [
    { user_id: 1, at: T('10', 9, 0) },
    { user_id: 1, at: T('10', 9, 40) },
    { user_id: 1, at: T('10', 9, 15) },
    { user_id: 2, at: T('10', 14, 0) },          // one action only
    { user_id: 1, at: T('11', 8, 0) },
    { user_id: 1, at: T('11', 8, 10) },
  ];

  it('turns timestamps into "they worked for 40 minutes"', () => {
    const s = sessionsFromActions(rows);
    const day10user1 = s.find((x) => x.day === '2026-08-10' && x.userId === 1);
    expect(day10user1.minutes).toBe(40);
    expect(day10user1.actions).toBe(3);
  });

  // Someone who generated once DID arrive and DID do something. Recording them
  // as null would quietly drop the least engaged people from every average —
  // exactly the group worth being able to see.
  it('a single action is a zero-minute session, not a missing one', () => {
    const s = sessionsFromActions(rows);
    const only = s.find((x) => x.userId === 2);
    expect(only.minutes).toBe(0);
    expect(only.actions).toBe(1);
  });

  it('splits the same person across days', () => {
    const forUser1 = sessionsFromActions(rows).filter((x) => x.userId === 1);
    expect(forUser1.map((x) => x.day)).toEqual(['2026-08-10', '2026-08-11']);
  });

  it('ignores a broken timestamp rather than crashing on it', () => {
    const s = sessionsFromActions([...rows, { user_id: 3, at: 'nonsense' }]);
    expect(s.some((x) => x.userId === 3)).toBe(false);
    expect(s.length).toBeGreaterThan(0);
  });

  it('rolls up per day: how many people, and how long', () => {
    const d = dailyEngagement(sessionsFromActions(rows));
    const tenth = d.find((x) => x.day === '2026-08-10');
    expect(tenth.people).toBe(2);
    expect(tenth.actions).toBe(4);
    expect(tenth.longestMinutes).toBe(40);
  });

  // One person leaving a tab open for six hours drags a mean to somewhere
  // nobody actually sat.
  it('reports the MEDIAN session, not the mean', () => {
    expect(median([5, 10, 15])).toBe(10);
    expect(median([5, 10, 15, 360])).toBe(13);      // a mean would be 97
    expect(median([])).toBe(0);
  });
});

describe('quiet days are drawn, not skipped', () => {
  // A chart that omits empty days makes a flat week look busy, because the days
  // with nothing in them are simply not there.
  it('fills the gaps with zero', () => {
    const filled = fillDays(
      [{ day: '2026-08-10', views: 5 }, { day: '2026-08-13', views: 9 }],
      '2026-08-10', '2026-08-13', { views: 0 });
    expect(filled.map((r) => r.day)).toEqual(
      ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']);
    expect(filled[1].views).toBe(0);
  });

  it('refuses to loop forever on a nonsense range', () => {
    expect(fillDays([], 'not-a-date', '2026-08-13')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the screen says where each number came from', () => {
  // The most important thing on this tab. Visits start the day it ships;
  // account history goes back years. Putting both on one screen without saying
  // which is which invites exactly one reading — that nobody visited before
  // today — and that is not what the data says.
  const p = provenance({ trackingStartedOn: '2026-08-20', earliestUser: '2026-05-02' });

  it('says plainly that earlier visit days are unknown, not zero', () => {
    expect(p.visits).toMatch(/from 2026-08-20/);
    expect(p.visits).toMatch(/unknown rather than zero/);
  });

  it('says the account history is real and needed no new tracking', () => {
    expect(p.accounts).toMatch(/Full history from 2026-05-02/);
    expect(p.accounts).toMatch(/no new tracking/);
  });

  it('does not claim history it has not got', () => {
    expect(provenance({ trackingStartedOn: null, earliestUser: null }).visits)
      .toBe('Not yet collecting.');
  });
});
