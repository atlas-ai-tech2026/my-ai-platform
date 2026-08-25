// ─── history-feed.test.js ────────────────────────────────────────────────────
// The tests that matter here are not "does it fetch a page" — they are the
// three ways this change could QUIETLY corrupt somebody's library:
//
//   · a page arriving for the account that just signed out
//   · a duplicate row from paging while a new generation is written
//   · an error on page 3 wiping the two pages already on screen
//
// Each of those looks like lost work to the person it happens to, and none of
// them would show up on a test account small enough to fit in one page.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

import { mergePage, hasMorePages, useHistoryFeed, PAGE_SIZE } from './history-feed';

afterEach(cleanup);

const rows = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${from + i}`, prompt: `p${from + i}` }));

describe('merging a page into what is already there', () => {
  it('drops a row we have already rendered', () => {
    // Offset paging is not stable across writes: generate something while
    // page 2 is in flight and every later row shifts down, so a row already
    // on screen comes back. Two React children with the same key does not
    // throw — it renders one of them wrong.
    const merged = mergePage(rows(3), [{ id: 'r2' }, { id: 'r3' }]);
    expect(merged.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('keeps the SAME array when the page adds nothing', () => {
    // A fresh array on every poll re-renders a grid of hundreds of cards for
    // no reason.
    const before = rows(2);
    expect(mergePage(before, [{ id: 'r0' }])).toBe(before);
    expect(mergePage(before, [])).toBe(before);
  });

  it('survives a null row without throwing', () => {
    expect(mergePage(rows(1), [null, { id: 'r9' }]).map((r) => r.id)).toEqual(['r0', 'r9']);
  });
});

describe('knowing when to stop', () => {
  it('a short page is the end', () => {
    expect(hasMorePages(59, 60)).toBe(false);
  });

  it('a full page means ask again', () => {
    expect(hasMorePages(60, 60)).toBe(true);
  });

  it('an empty page is the end, not a reason to keep asking', () => {
    expect(hasMorePages(0, 60)).toBe(false);
  });
});

describe('loading a library', () => {
  it('asks for ONE page, not the whole history', async () => {
    // The entire point. The old code looped until a page came back short.
    const fetchPage = vi.fn().mockResolvedValue(rows(10));
    const { result } = renderHook(() =>
      useHistoryFeed({ fetchPage, map: (r) => r }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(PAGE_SIZE, 0);
    expect(result.current.items).toHaveLength(10);
    expect(result.current.hasMore, 'a short page means there is no more').toBe(false);
  });

  it('offers more only when a full page came back', async () => {
    const fetchPage = vi.fn().mockResolvedValue(rows(60));
    const { result } = renderHook(() => useHistoryFeed({ fetchPage, map: (r) => r }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
  });

  it('appends the next page and advances by what the SERVER returned', async () => {
    // Advancing by pageSize instead would walk off the end whenever a page
    // comes back short of what was asked for.
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(rows(60))
      .mockResolvedValueOnce(rows(5, 60));
    const { result } = renderHook(() => useHistoryFeed({ fetchPage, map: (r) => r }));

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(65));
    expect(fetchPage).toHaveBeenLastCalledWith(PAGE_SIZE, 60);
    expect(result.current.hasMore).toBe(false);
  });

  it('ignores a second loadMore while one is already in flight', async () => {
    // Two clicks on "Load more" must not fetch the same offset twice.
    let release;
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(rows(60))
      .mockImplementationOnce(() => new Promise((r) => { release = () => r(rows(60, 60)); }));
    const { result } = renderHook(() => useHistoryFeed({ fetchPage, map: (r) => r }));

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => { result.current.loadMore(); result.current.loadMore(); });
    expect(fetchPage).toHaveBeenCalledTimes(2);   // first page + one more
    await act(async () => { release(); });
  });
});

describe('the ways this could lose somebody their work', () => {
  it('an error on page 3 does NOT blank the pages already on screen', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(rows(60))
      .mockRejectedValueOnce(new Error('Network is down'));
    const { result } = renderHook(() => useHistoryFeed({ fetchPage, map: (r) => r }));

    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.error).toMatch(/Network is down/));
    expect(result.current.items, 'it threw away work that was already loaded').toHaveLength(60);
  });

  it('a page in flight for the PREVIOUS account never lands in the new one', async () => {
    // Sign out mid-load and the response is still coming. Rendering it would
    // put one customer's generations in another customer's grid.
    let landLate;
    const fetchPage = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { landLate = () => r(rows(5)); }));

    const { result, rerender } = renderHook(
      ({ enabled }) => useHistoryFeed({ fetchPage, map: (r) => r, enabled }),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });          // signed out
    await act(async () => { landLate(); });

    expect(result.current.items).toEqual([]);
  });

  it('does not fetch at all while signed out', async () => {
    const fetchPage = vi.fn();
    const { result } = renderHook(() =>
      useHistoryFeed({ fetchPage, map: (r) => r, enabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
