// ─── history-feed.js ─────────────────────────────────────────────────────────
// Loading a customer's generations WITHOUT downloading all of them first.
//
// ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
// Image.jsx and Video.jsx each ran a loop that paged through the ENTIRE
// history, 200 rows at a time, sequentially, on every page load — stopping
// only when a page came back short. For 3,000 generations that is fifteen
// round trips before the library is usable. The comment above it said "so
// nothing is capped": the intent was completeness, and the price was the wait,
// paid by the customers who generate MOST.
//
// ── WHY THE LOOP EXISTED, WHICH IS THE PART THAT MATTERS ───────────────────
// Three separate features quietly depended on "everything is in memory":
//
//   1. the history grid          — showed the whole array
//   2. the Saved tab             — images.filter(img => img.saved)
//   3. the pending video pollers — started for pending rows as pages arrived
//
// Deleting the loop without noticing 2 and 3 would look fine on any account
// small enough to fit in one page, and would silently break the ones that do
// not: a saved image from six months ago vanishes from the Saved tab, and a
// video still rendering never updates. Both would read as LOST DATA.
//
// So the loop is not replaced by "load less". Each of the three asks the
// server for exactly what it needs — a page, the saved ones, the pending ones
// — and none of them needs the other two's rows.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Enough to fill a grid several rows deep without making first paint wait on
 *  rows nobody has scrolled to. The old value was 200 PER REQUEST and every
 *  request was made. */
export const PAGE_SIZE = 60;

/**
 * Add a newly-arrived page to what we already have, dropping anything we have
 * seen before.
 *
 * Offset paging is not stable across writes: generate an image while page 2 is
 * in flight and every later row shifts down by one, so a row already rendered
 * comes back again. React then has two children with the same key, which does
 * NOT throw — it silently renders one of them wrong. Dedupe here rather than
 * hoping the timing never lines up.
 */
export function mergePage(existing, incoming) {
  if (!incoming?.length) return existing;
  const seen = new Set(existing.map((it) => it.id));
  const fresh = incoming.filter((it) => it && !seen.has(it.id));
  return fresh.length ? [...existing, ...fresh] : existing;
}

/**
 * Is there another page? A short page means the end.
 *
 * Deliberately NOT "did we get zero rows" — that would cost one extra
 * round trip at the end of every history, which is the whole complaint.
 */
export const hasMorePages = (received, pageSize) => received >= pageSize;

/**
 * One page of history, and a way to ask for the next one.
 *
 * fetchPage(limit, offset) → array of raw server records
 * map(record)              → whatever the page wants to render
 *
 * Returns items plus the state the UI needs to be honest about what it is
 * showing: still loading, loading more, nothing left, or failed.
 */
export function useHistoryFeed({ fetchPage, map, enabled = true, pageSize = PAGE_SIZE, resetKey }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);

  // Bumped whenever the feed restarts (sign-in, sign-out, account switch).
  // An in-flight page from the PREVIOUS account must not land in the new one —
  // that is one customer's work appearing in another's grid.
  const run = useRef(0);
  const offset = useRef(0);
  const busy = useRef(false);

  const reset = useCallback(() => {
    run.current += 1;
    offset.current = 0;
    busy.current = false;
    setItems([]);
    setHasMore(false);
    setError(null);
  }, []);

  const fetchRef = useRef(fetchPage);
  const mapRef = useRef(map);
  fetchRef.current = fetchPage;
  mapRef.current = map;

  const load = useCallback(async (isFirst) => {
    if (busy.current) return;
    busy.current = true;
    const mine = run.current;
    isFirst ? setLoading(true) : setLoadingMore(true);
    try {
      const records = await fetchRef.current(pageSize, offset.current);
      if (mine !== run.current) return;            // a different account now
      const mapped = (records || []).map(mapRef.current);
      // offset advances by what the SERVER returned, not by pageSize — those
      // differ on the last page, and guessing walks off the end.
      offset.current += records?.length || 0;
      setItems((prev) => (isFirst ? mapped : mergePage(prev, mapped)));
      setHasMore(hasMorePages(records?.length || 0, pageSize));
      setError(null);
      return mapped;
    } catch (e) {
      if (mine !== run.current) return;
      // A failure on page 3 must NOT blank the two pages already on screen.
      // Say what happened and leave the work visible.
      setError(e?.message || 'Could not load more of your history.');
      setHasMore(false);
    } finally {
      if (mine === run.current) {
        isFirst ? setLoading(false) : setLoadingMore(false);
        busy.current = false;
      }
    }
  }, [pageSize]);

  // resetKey is the account id. Signing out and back in as a DIFFERENT user
  // can leave `enabled` true the whole way through, and without this the new
  // account would keep looking at the previous one's grid.
  useEffect(() => {
    reset();
    if (!enabled) { setLoading(false); return; }
    load(true);
    return () => { run.current += 1; };
  }, [enabled, resetKey, reset, load]);

  const loadMore = useCallback(() => {
    if (!hasMore || busy.current) return;
    load(false);
  }, [hasMore, load]);

  return { items, setItems, loading, loadingMore, hasMore, loadMore, error };
}

/**
 * Fires the callback when the sentinel scrolls into view.
 *
 * Falls back to doing nothing at all when IntersectionObserver is missing
 * (jsdom, very old browsers) — which is why every caller ALSO renders a real
 * button. An infinite scroll with no visible way to continue is a dead end on
 * whatever browser the observer does not exist in.
 */
export function useOnVisible(ref, onVisible, active) {
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    if (!active || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) cb.current?.(); },
      // Start fetching a little before it is actually on screen so the next
      // rows are usually there by the time the scroll arrives.
      { rootMargin: '400px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref, active]);
}
