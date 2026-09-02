// ─── success-is-not-an-error.test.jsx ────────────────────────────────────────
// ☠ A FORM THAT SUCCEEDS MUST NOT LOOK LIKE A FORM THAT FAILED.
//
// Reported by Amr on 2026-09-03, from his own screenshot: he created a promo
// code successfully, and "Credits per redemption" turned RED with "Enter how
// many credits each redemption grants" underneath. He asked whether it was a
// bug. It was — and not only there.
//
// ── THE SHAPE OF IT ────────────────────────────────────────────────────────
// These forms hold a `tried` flag so they do not shout at someone who has not
// submitted yet: red highlighting is `tried && fieldIsEmpty`. On success the
// form clears its boxes so the next entry starts blank — and `tried` stayed
// true. Empty box + tried = red. The better the outcome, the louder the
// complaint.
//
// It is the mirror of the fault this project keeps finding. Usually a failure
// looks like success (the /edit form that posted nowhere and said thank you).
// Here a success looks like a failure. Both teach the reader to distrust the
// screen, which is the expensive part.
//
// ── WHY A SWEEP AND NOT TWO FIXES ──────────────────────────────────────────
// Six components use this flag. Two had the bug. The other four are safe only
// because they happen not to clear the guarded field on success — which is a
// coincidence, not a decision, and one refactor away from becoming the same
// bug. So the rule is mechanical, and the four exceptions are written down
// with the reason each is exempt.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HERE = join(process.cwd(), 'src/components/admin');
const read = (f) => readFileSync(join(HERE, f), 'utf8');

/**
 * Components that raise `tried` and never lower it, with the reason each is
 * safe. A component may only appear here because it does NOT clear the field
 * its `tried` flag guards — so the box is still full and nothing goes red.
 */
const NEVER_CLEARS_ITS_GUARDED_FIELD = {
  'GiftCardsTab.jsx':
    'Keeps credits and count after generating, on purpose: the usual next action is '
    + 'another batch of the same size, so the numbers stay put and no box is empty.',
  'BulkTab.jsx':
    'Keeps credits after creating a batch, for the same reason — and the screen stays '
    + 'on the credentials CSV, which must be downloaded before anything is touched.',
  'OffersTab.jsx':
    'Calls onSaved(), which closes the editor. The component is gone, so there is no '
    + 'stale flag left to paint anything red.',
};

describe('☠ EVERY FORM THAT RAISES `tried` MUST BE ABLE TO LOWER IT', () => {
  const usesTried = readdirSync(HERE)
    .filter((f) => f.endsWith('.jsx') && !f.endsWith('.test.jsx'))
    .filter((f) => read(f).includes('setTried(true)'));

  it('finds the forms that use the flag at all', () => {
    // If this drops to nothing the sweep has stopped sweeping.
    expect(usesTried.length).toBeGreaterThanOrEqual(5);
  });

  it.each(usesTried)('%s', (file) => {
    const src = read(file);
    if (src.includes('setTried(false)')) return;          // resets — fine
    const why = NEVER_CLEARS_ITS_GUARDED_FIELD[file];
    expect(why,
      `${file} raises \`tried\` and never lowers it. If it clears the field that flag `
      + `guards, a SUCCESSFUL submit will paint that box red. Either call setTried(false) `
      + `on the success path, or add ${file} to NEVER_CLEARS_ITS_GUARDED_FIELD with the `
      + `reason it is safe.`).toBeTruthy();
    expect(why.length, `${file}'s exemption needs a real reason, not a placeholder`)
      .toBeGreaterThan(40);
  });

  it('and the exemption list has no leftovers for files that are gone or now reset', () => {
    for (const file of Object.keys(NEVER_CLEARS_ITS_GUARDED_FIELD)) {
      expect(usesTried, `${file} is exempted but no longer uses the flag`).toContain(file);
      expect(read(file).includes('setTried(false)'),
        `${file} now resets the flag — remove its exemption`).toBe(false);
    }
  });
});

// ── and the two that were actually broken, proven by using them ─────────────

const api = vi.hoisted(() => ({
  listPromos: vi.fn(), createPromo: vi.fn(), togglePromo: vi.fn(),
  updatePromo: vi.fn(), promoRedemptions: vi.fn(), promoInvites: vi.fn(),
  promoInvitesAdd: vi.fn(),
}));
vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('exceljs', () => ({ default: { Workbook: function () {} } }));

describe('☠ THE PROMO FORM, AS AMR SAW IT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listPromos.mockResolvedValue({ promos: [] });
    api.createPromo.mockResolvedValue({ promo: { code: 'VOXEL-NDXB-JX94', credits: '10.00' } });
  });

  it('creating a code successfully leaves NO error on the form', async () => {
    const PromoCodesTab = (await import('./PromoCodesTab')).default;
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => expect(api.listPromos).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText('e.g. 50'), '10');
    await user.click(screen.getByRole('button', { name: /Create promo/ }));
    await waitFor(() => expect(api.createPromo).toHaveBeenCalled());

    // The exact sentence from the screenshot.
    await waitFor(() => {
      expect(screen.queryByText(/Enter how many credits each redemption grants/)).toBeNull();
    });
  });

  it('but an EMPTY submit still does — the flag has to keep working', async () => {
    const PromoCodesTab = (await import('./PromoCodesTab')).default;
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => expect(api.listPromos).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Create promo/ }));
    expect(await screen.findByText(/Enter how many credits each redemption grants/)).toBeInTheDocument();
    expect(api.createPromo).not.toHaveBeenCalled();
  });

  it('☠ and access days does not follow the next code home', async () => {
    // Not cosmetic: access_days sets how long the credits a code grants stay
    // alive. A 90-day workshop code followed by an unrelated code silently
    // gave the second one 90 days too.
    const PromoCodesTab = (await import('./PromoCodesTab')).default;
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => expect(api.listPromos).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText('e.g. 50'), '10');
    await user.type(screen.getByPlaceholderText('Blank = 30 days'), '90');
    await user.click(screen.getByRole('button', { name: /Create promo/ }));
    await waitFor(() => expect(api.createPromo).toHaveBeenCalledWith(
      expect.objectContaining({ access_days: '90' })));

    expect(screen.getByPlaceholderText('Blank = 30 days')).toHaveValue(null);
  });
});
