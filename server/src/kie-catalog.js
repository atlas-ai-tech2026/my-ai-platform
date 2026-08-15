// ─── kie-catalog.js ──────────────────────────────────────────────────────────
// Reading kie.ai's model catalogue.
//
// I recorded twice in this project that kie had "no catalogue API — the page is
// JavaScript-rendered, it would need a headless browser." That was wrong, and
// it was wrong because it came from a note rather than a fresh check. The owner
// pushed back — Seedance 2.5 was plainly on kie and missing from the CRM — and
// the endpoint took ten minutes to find once someone actually looked:
//
//     POST https://api.kie.ai/api/v1/playground/pagePlaygroundGroup
//          {"pageNum": 1, "pageSize": 100}
//
// Public, unauthenticated, 98 model groups. No browser, no scraping, no
// dependency. The lesson is cheap to write down and expensive to relearn: a
// remembered limitation is not evidence.
//
// ── WHAT IT GIVES US, AND WHAT IT DOES NOT ──────────────────────────────────
// Every group carries name, path, provider, task types and createTime — enough
// to detect a new model the day it lands. PRICES are another matter: only 9 of
// 98 groups populate priceInfoJson; the rest return empty strings. So kie price
// watching is real but partial, and a missing price must read as "kie does not
// publish it" rather than as free.

const KIE_MARKET_URL = 'https://api.kie.ai/api/v1/playground/pagePlaygroundGroup';

/** kie rejects pageSize over 100 with a 422 — not a suggestion. */
export const KIE_MAX_PAGE = 100;

/**
 * priceInfoJson is a JSON STRING inside the JSON, and mostly empty:
 *   {"price":"0.032","discount":"19%","credits":"6.5","marketPrice":"image"}
 *   {"price":"","discount":"","credits":"","marketPrice":""}
 *
 * `marketPrice` is not a price — it is the UNIT ("image", "5s"). Reading it as
 * money would be the same class of error that made our fal costs 16% high.
 */
export function parseKiePrice(raw) {
  if (!raw) return null;
  let p;
  try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const usd = Number(String(p.price ?? '').trim());
  if (!Number.isFinite(usd) || usd <= 0) return null;
  const credits = Number(String(p.credits ?? '').trim());
  return {
    usd,
    unit: String(p.marketPrice ?? '').trim() || null,
    credits: Number.isFinite(credits) && credits > 0 ? credits : null,
    discount: String(p.discount ?? '').trim() || null,
  };
}

/** kie's millisecond epoch → the ISO date the rest of the sync speaks. */
export function toIsoDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
}

/**
 * One catalogue page, normalised into the same shape fal-catalog returns so the
 * sweep can treat both providers identically.
 */
export function normaliseKieGroups(records = []) {
  return records
    .filter((r) => r && r.groupName)
    .map((r) => {
      const price = parseKiePrice(r.priceInfoJson);
      return {
        family: String(r.groupName).trim(),
        // kie's provider field is the LAB (ByteDance, Google), which is what
        // fal-catalog calls `lab` — not the supplier. Naming it `lab` keeps
        // "provider" meaning kie-or-fal everywhere else.
        lab: r.provider ? String(r.provider).trim() : null,
        category: Array.isArray(r.taskType) && r.taskType.length
          ? String(r.taskType[0]).toLowerCase().replace(/\s+/g, '-') : null,
        first_seen: toIsoDate(r.createTime),
        // `count` is how many endpoints the group holds — the same thing
        // fal-catalog counts, so the CRM column means one thing.
        endpoints: Array.from({ length: Math.max(1, Number(r.count) || 1) }, (_, i) => ({
          id: `${r.path}#${i}`, title: r.groupName, category: null,
        })),
        price: price ? { usd: price.usd, unit: price.unit } : null,
        path: r.path || null,
      };
    });
}

/**
 * Fetch the whole catalogue, paging until exhausted.
 *
 * `fetchImpl` is injectable so tests never touch the network — same pattern as
 * fal-catalog. A page that fails stops paging and returns what we have, because
 * a partial catalogue is a smaller problem than a sweep that throws and leaves
 * the queue untouched.
 */
export async function fetchKieCatalog({
  fetchImpl = fetch, pageSize = KIE_MAX_PAGE, maxPages = 20, url = KIE_MARKET_URL,
} = {}) {
  const out = [];
  let total = null;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: page, pageSize: Math.min(pageSize, KIE_MAX_PAGE) }),
    });
    if (!res.ok) throw new Error(`kie catalogue HTTP ${res.status}`);
    const body = await res.json();
    if (body.code !== 200 || !body.data) {
      throw new Error(`kie catalogue: ${body.msg || 'unexpected response'}`);
    }
    const records = body.data.records || [];
    out.push(...records);
    total = body.data.total ?? total;
    if (!records.length || (total != null && out.length >= total)) break;
  }
  return normaliseKieGroups(out);
}
