// ─── media-health.js ─────────────────────────────────────────────────────────
// How many customer records point at a file that is no longer there?
//
// ── WHY THIS OUTRANKS EVERYTHING ELSE ──────────────────────────────────────
// The thumbnail survey found 16 of one account's 349 images unreadable, and
// then the owner hovered a video tile on dev: the play button appeared — so
// the record was complete and HAD a link — and the file never loaded.
//
// A slow picture is annoying. A missing one is work a customer paid for and
// cannot get back. Optimising how fast things load while they are quietly
// disappearing would be the wrong order.
//
// ── THE INSIGHT THAT MAKES THIS CHEAP ──────────────────────────────────────
// Most of the answer needs NO network. storage.js exists because providers
// expire their links: FAL and kie hand back a url on their own CDN, and those
// die. Every generation is therefore meant to be copied into our bucket, and
// `persistOrFallback` KEEPS THE PROVIDER URL when that copy fails — silently,
// by design, so a generation still succeeds.
//
// So "which host does this row point at" is the risk, and the database can
// count that in one query with no requests at all:
//
//   · our own bucket  → durable
//   · a provider host → a link that expires; a future 404 waiting to happen
//   · no url at all   → already broken
//
// The network is then only needed to measure how many have ALREADY died, and
// a sample answers that. Checking twenty thousand files to learn a percentage
// would be a strange way to investigate a problem about bandwidth.

/** Rows whose url is on a host we do not control are the population at risk. */
export function classifyUrl(url, { ourHosts = [] } = {}) {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return 'missing';
  if (!/^https?:\/\//i.test(s)) return 'other';
  let host = '';
  try { host = new URL(s).host.toLowerCase(); } catch { return 'other'; }
  // Exact host match, never a substring — `voxel-ai-store.evil.com` contains
  // our bucket name and is not ours. The same trap the CDN rewrite has a test
  // for.
  if (ourHosts.some((h) => host === h)) return 'ours';
  return 'provider';
}

/**
 * The hosts that count as ours: the bucket origin, and its CDN edge if one is
 * configured. Derived from env rather than hardcoded, so dev and production
 * each judge themselves correctly.
 */
export function ourMediaHosts({ endpoint, bucket, cdnBase } = {}) {
  const hosts = [];
  try { if (endpoint && bucket) hosts.push(`${bucket}.${new URL(endpoint).host}`.toLowerCase()); } catch { /* malformed */ }
  try { if (cdnBase) hosts.push(new URL(cdnBase).host.toLowerCase()); } catch { /* malformed */ }
  return hosts;
}

/**
 * One query, no network. Exact counts of where every generation points.
 *
 * `$1` is an array of our hostnames; a row is "ours" when its url host matches
 * one of them. Written as SQL rather than in JS because pulling every row back
 * to count them is how the history page got slow in the first place.
 */
export const HOST_BREAKDOWN_SQL = `
  WITH u AS (
    SELECT
      CASE
        WHEN COALESCE(data->>'result_url', '') = '' THEN 'missing'
        WHEN data->>'result_url' !~* '^https?://' THEN 'other'
        WHEN split_part(split_part(data->>'result_url', '://', 2), '/', 1) = ANY($1::text[]) THEN 'ours'
        ELSE 'provider'
      END AS bucket_class,
      user_id
    FROM entities
    WHERE name = 'GenerationHistory'
  )
  SELECT bucket_class, count(*)::int AS rows, count(DISTINCT user_id)::int AS accounts
    FROM u GROUP BY bucket_class
`;

/** A sample of at-risk rows to actually test. Newest last, so the sample
 *  spans the whole history rather than only the oldest corner of it. */
export const AT_RISK_SAMPLE_SQL = `
  SELECT id, user_id, data->>'result_url' AS url, created_date
    FROM entities
   WHERE name = 'GenerationHistory'
     AND COALESCE(data->>'result_url', '') <> ''
     AND split_part(split_part(data->>'result_url', '://', 2), '/', 1) <> ALL($1::text[])
   ORDER BY random()
   LIMIT $2
`;

/** Ask whether a file is still there, without downloading it. null means the
 *  question could not be answered — never counted as "gone", because a network
 *  hiccup is not a lost file and reporting it as one would cry wolf. */
export async function stillThere(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'HEAD', signal: ac.signal });
    if (r.status === 404 || r.status === 403 || r.status === 410) return false;
    return r.ok ? true : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Check a sample, a few at a time. */
export async function checkSample(rows, { fetchImpl = fetch, concurrency = 6 } = {}) {
  const items = Array.isArray(rows) ? rows : [];
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= items.length) return;
      out[i] = await stillThere(items[i].url, { fetchImpl });
    }
  }));

  let gone = 0; let alive = 0; let unknown = 0;
  const examples = [];
  out.forEach((v, i) => {
    if (v === false) { gone += 1; if (examples.length < 10) examples.push({ id: items[i].id, url: items[i].url }); }
    else if (v === true) alive += 1;
    else unknown += 1;
  });
  return { sampled: items.length, gone, alive, unknown, examples };
}

/**
 * Turn the two halves into something a person can act on.
 *
 * The estimate is labelled and derived only from rows we actually tested. If
 * nothing could be tested it says so rather than reporting zero — a zero here
 * would read as "all healthy", which is the most dangerous wrong answer this
 * check could give.
 */
export function summarise(breakdown, sample) {
  const by = Object.fromEntries((breakdown || []).map((r) => [r.bucket_class, r]));
  const rows = (k) => by[k]?.rows || 0;
  const total = ['ours', 'provider', 'missing', 'other'].reduce((n, k) => n + rows(k), 0);

  const tested = (sample?.gone || 0) + (sample?.alive || 0);
  const rate = tested ? sample.gone / tested : null;
  const atRisk = rows('provider');

  return {
    totalGenerations: total,
    durable: rows('ours'),
    atRiskOnProviderHost: atRisk,
    accountsAffected: by.provider?.accounts || 0,
    noUrlAtAll: rows('missing'),
    unrecognised: rows('other'),
    sample: sample ? {
      tested,
      confirmedGone: sample.gone,
      stillThere: sample.alive,
      couldNotTell: sample.unknown,
      examples: sample.examples,
    } : null,
    estimatedLost: rate === null ? null : Math.round(atRisk * rate),
    note: rate === null
      ? 'No at-risk file could be tested, so there is NO estimate — this is not a clean bill of health.'
      : `Estimate = ${atRisk} at-risk rows × ${(rate * 100).toFixed(1)}% measured failure in a sample of ${tested}.`,
  };
}
