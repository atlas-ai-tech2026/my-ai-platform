// ─── history-selection.test.js ───────────────────────────────────────────────
// The number on the delete button is a PROMISE.
//
// The confirmation says "Delete 128 pictures?" and the customer presses yes on
// the strength of that number. If the selection actually holds 60, two thirds
// of their work quietly survives a delete they believed they had made — and
// they find out weeks later, with no way to tell what happened.
//
// So the counting lives in one module with tests, rather than scattered
// through a component where it can drift from what the button says.

import { describe, it, expect } from 'vitest';
import {
  emptySelection, setMode, toggle, selectAll, clear, isSelected, count,
  labels, confirmSentence, afterDelete,
} from './history-selection.js';

const withIds = (...ids) => ({ on: true, ids });

describe('THE NUMBER IS THE PROMISE', () => {
  it('"Select all" uses the SERVER total, not what is loaded', () => {
    // 128 match, 60 are on screen. Offering "Select all 60" answers a question
    // the customer did not ask.
    expect(labels(emptySelection(), { total: 128, loaded: 60 }).selectAll).toBe('Select all 128');
  });

  it('falls back to what is loaded only when there is no total', () => {
    expect(labels(emptySelection(), { total: null, loaded: 60 }).selectAll).toBe('Select all 60');
  });

  it('the delete button says exactly how many are selected', () => {
    expect(labels(withIds('a', 'b', 'c')).remove).toBe('Delete 3');
    expect(labels(emptySelection()).remove).toBe('Delete');
  });

  it('and cannot be pressed with nothing selected', () => {
    expect(labels(emptySelection()).canDelete).toBe(false);
    expect(labels(withIds('a')).canDelete).toBe(true);
  });

  it('the count never double-counts, however select-all is fed', () => {
    const s = selectAll(emptySelection(), ['a', 'b', 'a', null, 'c', undefined]);
    expect(count(s)).toBe(3);
  });
});

describe('the confirmation names the FILTER, not only the count', () => {
  it('"Delete 128 pictures?" alone does not say WHICH 128', () => {
    const s = confirmSentence(128, { text: 'dragon', model: 'Midjourney', preset: '30' });
    expect(s).toMatch(/128 pictures/);
    expect(s).toMatch(/matching “dragon”/);
    expect(s).toMatch(/made with Midjourney/);
    expect(s).toMatch(/period you have selected/);
  });

  it('says nothing about a filter when none is set', () => {
    expect(confirmSentence(3, {})).toBe(
      'Delete 3 pictures? You can bring them back for 30 days from Recently deleted.');
  });

  it('reads correctly for one', () => {
    expect(confirmSentence(1, {})).toMatch(/Delete 1 picture\? You can bring it back/);
  });

  it('carries the recovery window from the caller, so it cannot drift', () => {
    expect(confirmSentence(2, {}, 7)).toMatch(/7 days/);
  });
});

describe('selecting is a mode, and leaving it clears', () => {
  it('starts off and empty', () => {
    expect(emptySelection()).toEqual({ on: false, ids: [] });
  });

  it('turning it off drops the selection', () => {
    // A selection that survives being switched off is one nobody can see and
    // can still delete.
    expect(setMode(withIds('a', 'b'), false)).toEqual({ on: false, ids: [] });
  });

  it('turning it on keeps what was already chosen', () => {
    expect(setMode({ on: false, ids: ['a'] }, true)).toEqual({ on: true, ids: ['a'] });
  });

  it('toggles one at a time', () => {
    let s = emptySelection();
    s = toggle(s, 'a');
    expect(isSelected(s, 'a')).toBe(true);
    s = toggle(s, 'a');
    expect(isSelected(s, 'a')).toBe(false);
  });

  it('ignores a missing id rather than selecting undefined', () => {
    expect(toggle(emptySelection(), undefined).ids).toEqual([]);
    expect(toggle(emptySelection(), null).ids).toEqual([]);
  });

  it('Clear empties without leaving the mode', () => {
    expect(clear(withIds('a', 'b'))).toEqual({ on: true, ids: [] });
  });
});

describe('what it says afterwards', () => {
  it('a partial result is stated, not hidden', () => {
    // Asking for 40 and getting 38 is a fact the customer needs — the other
    // two were already gone.
    expect(afterDelete({ deleted: 38, asked: 40 })).toBe('38 of 40 deleted — the rest were already gone.');
  });

  it('a clean result is plain', () => {
    expect(afterDelete({ deleted: 40, asked: 40 })).toBe('40 pictures deleted');
    expect(afterDelete({ deleted: 1, asked: 1 })).toBe('1 picture deleted');
  });

  it('nothing deleted says so rather than claiming success', () => {
    expect(afterDelete({ deleted: 0, asked: 5 })).toBe('Nothing was deleted.');
    expect(afterDelete({})).toBe('Nothing was deleted.');
  });
});
