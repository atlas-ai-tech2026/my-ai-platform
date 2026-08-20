// ─── audience.js ─────────────────────────────────────────────────────────────
// Who reaches the site, where they came from, and how long they stayed.
//
// ── THE TWO HALVES, AND WHY ONE OF THEM CANNOT BE BACKDATED ────────────────
// The owner asked for the history too: "we need the old data also, or we cannot
// see the history of the site." Half of that is possible and half is not, and
// pretending otherwise would be the worst answer available.
//
//   ANONYMOUS VISITS — page views, referrers, countries. NOTHING has ever
//   recorded these. No table, no log, no counter. They begin on the day this
//   ships and there is no honest way to reconstruct a single day before it.
//   Inventing a plausible-looking curve would be worse than an empty chart.
//
//   SIGNED-IN ACTIVITY — full history, going back as far as the ledger does.
//   Every signup is dated in `users`, every spend is dated in `credits_history`.
//   So "how many joined in July", "which days were busy", and "how long people
//   actually worked" are all answerable TODAY, from data already held, with no
//   new tracking whatsoever.
//
// That second half is the more valuable one for a workshop business anyway: it
// is about the people who arrived and did something, not the ones who bounced.
//
// ── AND WHY THE COUNTS EXCLUDE MORE THAN YOU MIGHT EXPECT ──────────────────
// A page-view number that includes crawlers, uptime probes and the owner's own
// browsing is not an answer to "how many people reached my site" — it is a
// bigger number that feels better. Everything filtered here is filtered because
// counting it would make the figure less true.

import { createHash } from 'node:crypto';

/** Only real page loads are counted; assets and API calls are not visits. */
export const IGNORED_PREFIXES = ['/api/', '/assets/', '/media/', '/static/'];

/** The control panel is our own screen, not audience. Also see clarity.js. */
export const ADMIN_ROUTE = 'x7k9-control-panel-mh2024';

/**
 * Anything that is plainly not a person.
 *
 * Deliberately conservative: a missing or odd user-agent is NOT treated as a
 * bot, because a wrong exclusion silently shrinks the number and nobody ever
 * finds out. Only self-declared crawlers are dropped.
 */
export const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl\/|wget|python-requests|axios\/|go-http-client|monitoring/i;

export function isBot(userAgent) {
  return BOT_PATTERN.test(String(userAgent || ''));
}

/** Is this request a page view worth counting? */
export function shouldCount({ path = '', method = 'GET', userAgent = '', accept = '' } = {}) {
  if (method !== 'GET') return { count: false, reason: 'not a page load' };
  const p = String(path).toLowerCase();
  if (IGNORED_PREFIXES.some((pre) => p.startsWith(pre))) {
    return { count: false, reason: 'not a page' };
  }
  // A path with a file extension is an asset the SPA shell never serves.
  if (/\.[a-z0-9]{1,6}$/i.test(p)) return { count: false, reason: 'a file, not a page' };
  const route = p.replace(/^\/+|\/+$/g, '');
  if (route === ADMIN_ROUTE || route.startsWith(`${ADMIN_ROUTE}/`)) {
    return { count: false, reason: 'the control panel is our own screen, not audience' };
  }
  // Only requests that actually wanted HTML. A fetch() for JSON is not a visit.
  if (accept && !String(accept).includes('text/html') && !String(accept).includes('*/*')) {
    return { count: false, reason: 'did not ask for a page' };
  }
  if (isBot(userAgent)) return { count: false, reason: 'bot' };
  return { count: true, path: `/${route}` };
}

/**
 * A per-day identity for a visitor, which is deliberately useless tomorrow.
 *
 * The salt rotates daily, so the same person on two days produces two
 * unrelated hashes. That is the point: it answers "how many different people
 * came today" without building anything that could follow someone over time.
 *
 * It also means no cookie, so no consent banner, and nothing stored that could
 * identify a person if the table leaked.
 */
export function visitorHash({ ip, userAgent = '', day, salt = '' }) {
  if (!ip) return null;
  return createHash('sha256')
    .update(`${day}|${salt}|${ip}|${userAgent}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

/**
 * Where a visit came from, reduced to a host.
 *
 * Self-referrals are dropped: clicking from /image to /video is navigation, not
 * a referral, and counting it would make our own site the top source of our own
 * traffic — which is true, useless, and would crowd out the real answer.
 */
export function referrerHost(referer, ownHosts = []) {
  const raw = String(referer || '').trim();
  if (!raw) return 'direct';
  let host;
  try { host = new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'direct'; }
  if (!host) return 'direct';
  const own = ownHosts.map((h) => String(h).toLowerCase().replace(/^www\./, ''));
  if (own.includes(host)) return 'direct';       // our own pages are not a source
  return host.slice(0, 120);
}

// ── HISTORY, FROM DATA ALREADY HELD ────────────────────────────────────────

/**
 * Active session length per person per day, from timestamps that already exist.
 *
 * First action to last action on a given day. For a workshop this is the number
 * that actually matters — "they were working for 40 minutes" — and it needs no
 * new tracking, so it reaches back as far as the ledger does.
 *
 * A single action is a session of ZERO minutes, not a missing one: someone who
 * generated once did arrive and did do something. Counting it as null would
 * quietly drop the least engaged people from every average, which is precisely
 * the group worth seeing.
 */
export function sessionsFromActions(rows = []) {
  const byUserDay = new Map();
  for (const r of rows) {
    const at = r.at instanceof Date ? r.at : new Date(r.at);
    if (Number.isNaN(at.getTime())) continue;
    const day = at.toISOString().slice(0, 10);
    const key = `${r.user_id}|${day}`;
    const cur = byUserDay.get(key);
    if (!cur) byUserDay.set(key, { userId: r.user_id, day, first: at, last: at, actions: 1 });
    else {
      if (at < cur.first) cur.first = at;
      if (at > cur.last) cur.last = at;
      cur.actions += 1;
    }
  }
  return [...byUserDay.values()]
    .map((s) => ({ ...s, minutes: Math.round((s.last - s.first) / 60000) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.userId - b.userId));
}

/** Roll sessions up per day: how many people, and how long they worked. */
export function dailyEngagement(sessions = []) {
  const byDay = new Map();
  for (const s of sessions) {
    const d = byDay.get(s.day) || { day: s.day, people: 0, actions: 0, minutes: [] };
    d.people += 1;
    d.actions += s.actions;
    d.minutes.push(s.minutes);
    byDay.set(s.day, d);
  }
  return [...byDay.values()]
    .map((d) => ({
      day: d.day,
      people: d.people,
      actions: d.actions,
      // MEDIAN, not mean. One person leaving a tab open for six hours drags an
      // average to somewhere nobody actually sat.
      medianMinutes: median(d.minutes),
      longestMinutes: Math.max(...d.minutes),
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function median(values = []) {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * Fill the gaps in a daily series.
 *
 * A chart that silently skips quiet days makes a flat week look busy, because
 * the days with nothing in them simply are not drawn. Zero is a real reading.
 */
export function fillDays(rows = [], fromDay, toDay, zero = {}) {
  if (!fromDay || !toDay) return rows;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const cur = new Date(`${fromDay}T00:00:00.000Z`);
  const end = new Date(`${toDay}T00:00:00.000Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return rows;
  let guard = 0;
  while (cur <= end && guard < 2000) {
    const day = cur.toISOString().slice(0, 10);
    out.push(byDay.get(day) || { day, ...zero });
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

/**
 * What the screen must SAY about where each number came from.
 *
 * The single most important thing on this tab. Visitor counts start the day it
 * ships; signup and activity history goes back years. Showing both on one
 * screen without saying which is which invites exactly one conclusion — that
 * the site had no visitors before today — and that is not what the data says.
 */
export function provenance({ trackingStartedOn, earliestUser }) {
  return {
    visits: trackingStartedOn
      ? `Counted here from ${trackingStartedOn}. Nothing recorded page views before that date, `
        + 'so earlier days are genuinely unknown rather than zero.'
      : 'Not yet collecting.',
    accounts: earliestUser
      ? `Full history from ${earliestUser} — reconstructed from signup and ledger dates that were `
        + 'always kept, so this needed no new tracking.'
      : 'No accounts yet.',
  };
}
