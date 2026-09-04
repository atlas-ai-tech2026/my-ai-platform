// ─── PromoCodesTab.test.jsx ──────────────────────────────────────────────────
// CRM promo-code enhancements, 2026-08-06.
//
// The owner's stated concern was that existing promo codes must keep working
// untouched, so the first block pins exactly that: a code created before this
// change (no description) still renders, still shows its real counts, and is
// never mutated by simply being displayed.
//
// The rest cover the four requested features: description, editing description
// and expiry, search, and the list of accounts that redeemed a code.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromoCodesTab from './PromoCodesTab';

const api = vi.hoisted(() => ({
  listPromos: vi.fn(),
  createPromo: vi.fn(),
  togglePromo: vi.fn(),
  updatePromo: vi.fn(),
  promoRedemptions: vi.fn(),
  promoInvites: vi.fn(),
  promoInvitesAdd: vi.fn(),
}));

vi.mock('@/lib/adminApi', () => ({ adminApi: api }));

// The export lazy-imports SheetJS; mock it so tests assert the SHAPE of what
// would land in the spreadsheet without writing a real file in jsdom.
const xlsx = vi.hoisted(() => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));
// ── exceljs, not SheetJS ────────────────────────────────────────────────────
// SheetJS carries two unfixable HIGH advisories with no upstream fix. These
// tests used to spy on XLSX.utils.json_to_sheet and XLSX.writeFile; the same
// two facts are captured here — WHAT rows were written, and WHAT the file is
// called — so the assertions below are about the export, not about a library.
vi.mock('exceljs', () => {
  // A REGULAR function, not an arrow: the component calls `new ExcelJS.Workbook()`
  // and arrows cannot be constructed. The first version used an arrow and every
  // export test failed with an empty capture rather than a useful error.
  function Workbook() {
    this.addWorksheet = () => ({
      set columns(v) { sheet.headers = v.map((c) => c.header); },
      get columns() { return []; },
      addRows(rows) { sheet.rows = rows; },
      getRow: () => ({ font: {} }),
    });
    this.xlsx = { writeBuffer: async () => new ArrayBuffer(8) };
  }
  return { default: { Workbook } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

// What the export produced, captured by the mock above and the anchor below.
const sheet = { rows: [], headers: [], filename: null };

beforeEach(() => {
  sheet.rows = []; sheet.headers = []; sheet.filename = null;
  // exceljs cannot save a file from a browser, so the page builds a Blob and
  // clicks a link. That link IS the filename assertion now.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
  globalThis.URL.revokeObjectURL = vi.fn();
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const el = realCreate(tag);
    if (tag === 'a') {
      Object.defineProperty(el, 'download', {
        set(v) { sheet.filename = v; }, get() { return sheet.filename; }, configurable: true,
      });
      el.click = vi.fn();
    }
    return el;
  });
});

const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past = new Date(Date.now() - 5 * 864e5).toISOString();

/** A code created BEFORE this change: no description column value. */
const LEGACY = {
  id: 1, code: 'VOXEL-OLD-0001', credits: '25.00', description: null,
  max_redemptions: 100, redeemed_count: 7, expires_at: future,
  active: true, created_by: 'info@voxel-ai.ai', created_at: '2026-06-01T10:00:00Z',
};
const WITH_DESC = {
  id: 2, code: 'GULF-MEDIA', credits: '50.00', description: 'Ahmed — Gulf Media campaign',
  max_redemptions: null, redeemed_count: 0, expires_at: null,
  active: true, created_by: 'info@voxel-ai.ai', created_at: '2026-08-01T10:00:00Z',
};
const EXPIRED = {
  id: 3, code: 'SHORT-DATE', credits: '10.00', description: 'workshop attendees',
  max_redemptions: null, redeemed_count: 3, expires_at: past,
  active: true, created_by: 'info@voxel-ai.ai', created_at: '2026-07-20T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listPromos.mockResolvedValue({ promos: [LEGACY, WITH_DESC, EXPIRED] });
  api.updatePromo.mockResolvedValue({ promo: {} });
  api.promoRedemptions.mockResolvedValue({
    redemptions: [
      { user_id: 11, email: 'sara@example.com', banned: false, created_at: '2026-07-02T09:00:00Z',
        redeemed_at: '2026-07-02T09:00:00Z', registered_at: '2026-06-01T10:00:00Z',
        display_name: 'Sara', package: 'Basic', current_credits: 9716, last_login_at: '2026-08-01T08:00:00Z',
        promo_credits_all: 268, promo_codes_count: 3 },
      { user_id: 12, email: 'omar@example.com', banned: true, created_at: '2026-07-03T09:00:00Z',
        redeemed_at: '2026-07-03T09:00:00Z', registered_at: '2026-05-15T10:00:00Z',
        display_name: null, package: null, current_credits: 0, last_login_at: null,
        promo_credits_all: 25, promo_codes_count: 1 },
    ],
  });
  // A code ADDRESSED to people: two turned up, one has not. GULF-MEDIA has no
  // list at all, which is how an open code behaves.
  api.promoInvites.mockResolvedValue({
    total: 3, redeemedCount: 2, waitingCount: 1,
    waiting: [{ email: 'left.off@example.com', redeemed_at: null }],
    redeemed: [{ email: 'sara@example.com' }, { email: 'omar@example.com' }],
  });
  api.promoInvitesAdd.mockResolvedValue({ added: 1, duplicate: [], invalid: [], total: 4 });
});

describe('existing promo codes are unaffected', () => {
  it('renders a pre-existing code that has no description', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(screen.getByText('VOXEL-OLD-0001')).toBeInTheDocument());
    // Missing description shows a placeholder, not a crash or a blank row.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows its real credits and redemption count unchanged', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(screen.getByText('VOXEL-OLD-0001')).toBeInTheDocument());
    expect(screen.getByText('+25')).toBeInTheDocument();
    expect(screen.getByText(/7 \/ 100/)).toBeInTheDocument();
  });

  it('never writes to a code just by listing it', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(api.listPromos).toHaveBeenCalled());
    // Viewing must be read-only: no update, no toggle, no creation.
    expect(api.updatePromo).not.toHaveBeenCalled();
    expect(api.togglePromo).not.toHaveBeenCalled();
    expect(api.createPromo).not.toHaveBeenCalled();
  });
});

describe('1 — description', () => {
  it('shows the description before the code', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => expect(screen.getByText('Ahmed — Gulf Media campaign')).toBeInTheDocument());
  });

  it('sends the description when creating', async () => {
    const user = userEvent.setup();
    api.createPromo.mockResolvedValue({ promo: { code: 'NEW-1', credits: 5 } });
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByPlaceholderText('Who is this for?'));

    await user.type(screen.getAllByPlaceholderText('Who is this for?')[0], 'Fatima, expo booth');
    await user.type(screen.getByPlaceholderText('e.g. 50'), '20');
    await user.click(screen.getByRole('button', { name: /create promo/i }));

    await waitFor(() => expect(api.createPromo).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Fatima, expo booth', credits: 20 })
    ));
  });
});

describe('2 — editing description and expiry', () => {
  it('saves a changed description without touching credits or the code', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));

    const row = screen.getByText('GULF-MEDIA').closest('tr');
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    const all = screen.getAllByPlaceholderText('Who is this for?');
    const field = all[all.length - 1];   // the row-edit box, not the create box
    await user.clear(field);
    await user.type(field, 'Ahmed — renewed for Q4');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePromo).toHaveBeenCalledWith(2, expect.objectContaining({
      description: 'Ahmed — renewed for Q4',
    })));
    // The payload must NOT carry credits or code — those are locked server-side,
    // and sending them would signal an intent the UI does not have.
    const payload = api.updatePromo.mock.calls[0][1];
    expect(payload).not.toHaveProperty('credits');
    expect(payload).not.toHaveProperty('code');
  });

  it('extends an expired code, which revives it', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('SHORT-DATE'));

    const row = screen.getByText('SHORT-DATE').closest('tr');
    expect(within(row).getByText('expired')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /^edit$/i }));
    const dateField = row.querySelector('input[type="date"]');
    await user.clear(dateField);
    await user.type(dateField, '2027-01-31');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePromo).toHaveBeenCalledWith(3, expect.objectContaining({
      expires_at: '2027-01-31',
    })));
  });

  it('sends null when the expiry is cleared, meaning never expires', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));
    await user.clear(row.querySelector('input[type="date"]'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // null, not undefined: the server must tell "clear it" from "leave it".
    await waitFor(() => expect(api.updatePromo).toHaveBeenCalledWith(1, expect.objectContaining({
      expires_at: null,
    })));
  });
});

describe('3 — search', () => {
  it('filters by description', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));

    await user.type(screen.getByPlaceholderText(/search description/i), 'gulf');
    expect(screen.getByText('GULF-MEDIA')).toBeInTheDocument();
    expect(screen.queryByText('VOXEL-OLD-0001')).not.toBeInTheDocument();
  });

  it('also finds a code by the code itself', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    await user.type(screen.getByPlaceholderText(/search description/i), 'old-0001');
    expect(screen.getByText('VOXEL-OLD-0001')).toBeInTheDocument();
    expect(screen.queryByText('GULF-MEDIA')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty table', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));

    await user.type(screen.getByPlaceholderText(/search description/i), 'zzzznothing');
    expect(screen.getByText(/no promo codes match/i)).toBeInTheDocument();
  });
});

describe('4 — the accounts that redeemed a code', () => {
  it('lists the accounts when the count is clicked', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    await user.click(within(row).getByRole('button', { name: /7 \/ 100/ }));

    await waitFor(() => expect(api.promoRedemptions).toHaveBeenCalledWith(1));
    expect(await screen.findByText('sara@example.com')).toBeInTheDocument();
    expect(screen.getByText(/omar@example.com \(banned\)/)).toBeInTheDocument();
  });

  it('fetches once and collapses again on a second click', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));

    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    const btn = within(row).getByRole('button', { name: /7 \/ 100/ });
    await user.click(btn);
    await waitFor(() => screen.getByText('sara@example.com'));
    await user.click(btn);
    await waitFor(() => expect(screen.queryByText('sara@example.com')).not.toBeInTheDocument());

    await user.click(btn);
    await waitFor(() => screen.getByText('sara@example.com'));
    expect(api.promoRedemptions).toHaveBeenCalledTimes(1);   // cached
  });
});

describe('status reflects expiry and caps, not just the on/off flag', () => {
  it('shows expired for a lapsed code that is still flagged active', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('SHORT-DATE'));
    const row = screen.getByText('SHORT-DATE').closest('tr');
    expect(within(row).getByText('expired')).toBeInTheDocument();
  });

  it('shows active for a live code', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('GULF-MEDIA'));
    const row = screen.getByText('GULF-MEDIA').closest('tr');
    expect(within(row).getByText('active')).toBeInTheDocument();
  });
});

describe('dashboard totals', () => {
  it('counts codes, active and deactivated', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('Promo codes created'));

    const created = screen.getByText('Promo codes created').closest('div').parentElement;
    expect(within(created).getByText('3')).toBeInTheDocument();       // 3 fixtures
    expect(within(created).getByText(/10 redemptions so far/)).toBeInTheDocument(); // 7+0+3

    const active = screen.getByText('Active').closest('div').parentElement;
    expect(within(active).getByText('3')).toBeInTheDocument();        // all flagged active
    expect(within(active).getByText(/0 deactivated/)).toBeInTheDocument();
  });

  it('separates "usable right now" from merely active', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('Usable right now'));
    // LEGACY (7/100, future expiry) and WITH_DESC (uncapped) are usable;
    // EXPIRED is flagged active but its date has passed, so it is not.
    const usable = screen.getByText('Usable right now').closest('div').parentElement;
    expect(within(usable).getByText('2')).toBeInTheDocument();
    expect(within(usable).getByText(/1 expired/)).toBeInTheDocument();
  });

  it('sums credits still claimable, and counts uncapped codes separately', async () => {
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('Credits outstanding'));
    // LEGACY: (100 - 7) x 25 = 2,325. WITH_DESC has no cap so it is unbounded
    // and must NOT be counted as zero — it is reported alongside instead.
    const out = screen.getByText('Credits outstanding').closest('div').parentElement;
    expect(within(out).getByText('2,325')).toBeInTheDocument();
    expect(within(out).getByText(/1 code with no limit/)).toBeInTheDocument();
  });

  it('does not change when the list is filtered by search', async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('Promo codes created'));

    await user.type(screen.getByPlaceholderText(/search description/i), 'gulf');
    // A dashboard that moved as you typed would be misleading — totals are
    // always over every code, never the filtered view.
    const created = screen.getByText('Promo codes created').closest('div').parentElement;
    expect(within(created).getByText('3')).toBeInTheDocument();
  });
});


describe('per-code Excel export of redeeming users', () => {
  const openRedemptions = async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));
    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    await user.click(within(row).getByRole('button', { name: /7 \/ 100/ }));
    await screen.findByText('sara@example.com');
    return user;
  };

  it('shows a download button named after THIS code, inside its own panel', async () => {
    await openRedemptions();
    expect(screen.getByRole('button', { name: /Excel — VOXEL-OLD-0001/ })).toBeInTheDocument();
    // Per code, not global: no other promo's code appears on an export button.
    expect(screen.queryByRole('button', { name: /Excel — VOXEL-RAMADAN-24/ })).toBeNull();
  });

  it('exports one row per redeeming user with registration and redemption dates', async () => {
    const user = await openRedemptions();
    await user.click(screen.getByRole('button', { name: /Excel — VOXEL-OLD-0001/ }));

    await waitFor(() => expect(sheet.rows.length).toBeGreaterThan(0));
    const rows = sheet.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      'Email': 'sara@example.com',
      'Name': 'Sara',
      'Plan': 'Basic',
      'Registered': '2026-06-01',
      'Redeemed': '2026-07-02',
      'Credits from this code': 25,
      'Credits from all promo codes': 268,
      'Promo codes redeemed': 3,
      'Wallet balance (all sources)': 9716,
      'Account status': 'active',
    });
    // Missing optional fields render as honest blanks, never "null" or 0-dates.
    expect(rows[1]).toMatchObject({
      'Name': '', 'Plan': 'Free', 'Last login': '', 'Account status': 'banned',
    });
  });

  it('names the file after the code and the day', async () => {
    const user = await openRedemptions();
    await user.click(screen.getByRole('button', { name: /Excel — VOXEL-OLD-0001/ }));
    await waitFor(() => expect(sheet.filename).toBeTruthy());
    expect(sheet.filename).toMatch(/^voxel-promo-VOXEL-OLD-0001-users-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});


describe('the credit columns say what they mean', () => {
  // The owner downloaded a sheet for a 158-credit code and saw 9,716 against a
  // user. That number was the whole WALLET — an 11,000-credit admin grant plus
  // refunds, minus spending — and nothing to do with the code. These pin the
  // three quantities apart so they can never be confused again.
  const exportSheet = async () => {
    const user = userEvent.setup();
    render(<PromoCodesTab />);
    await waitFor(() => screen.getByText('VOXEL-OLD-0001'));
    const row = screen.getByText('VOXEL-OLD-0001').closest('tr');
    await user.click(within(row).getByRole('button', { name: /7 \/ 100/ }));
    await screen.findByText('sara@example.com');
    await user.click(screen.getByRole('button', { name: /Excel — VOXEL-OLD-0001/ }));
    await waitFor(() => expect(sheet.rows.length).toBeGreaterThan(0));
    return sheet.rows;
  };

  it('separates THIS code, ALL promo codes, and the whole wallet', async () => {
    const rows = await exportSheet();
    expect(rows[0]['Credits from this code']).toBe(25);          // the code's own value
    expect(rows[0]['Credits from all promo codes']).toBe(268);   // every code this user used
    expect(rows[0]['Wallet balance (all sources)']).toBe(9716);  // grants + gifts + refunds − spend
  });

  it('no longer has a bare "Current balance" column to misread', async () => {
    const rows = await exportSheet();
    expect(Object.keys(rows[0])).not.toContain('Current balance');
    expect(Object.keys(rows[0])).toContain('Wallet balance (all sources)');
  });

  it('shows how many of your codes each person redeemed', async () => {
    const rows = await exportSheet();
    expect(rows[0]['Promo codes redeemed']).toBe(3);
    expect(rows[1]['Promo codes redeemed']).toBe(1);
  });

  // A user who redeemed only this code must show the same number twice — that
  // equality is the proof the two columns are measuring what they claim.
  it('matches per-code and all-codes when the user redeemed only one', async () => {
    const rows = await exportSheet();
    expect(rows[1]['Credits from this code']).toBe(25);
    expect(rows[1]['Credits from all promo codes']).toBe(25);
  });
});

// ─── the two expiry settings must be readable side by side ───────────────────
// Added 2026-08-15 at the owner's request: they need to compare, per code and
// per person, "created / redeem-by / access period / when access actually ends".
// Getting these two confused is what left 584 of 587 accounts open-ended — the
// code's expires_at was read as if it limited the credits, which it never did.
describe('Expires and Access days are shown as a pair', () => {
  it('the table has both columns, plus Created to compare against', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/admin/PromoCodesTab.jsx'), 'utf8');
    const header = src.match(/\{\[('.*?')\]\.map\(\(h, i\)/s)?.[0] || src;
    for (const col of ['Expires', 'Access days', 'Created']) {
      expect(header).toContain(col);
    }
  });

  it('the column count matches the number of headers', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/admin/PromoCodesTab.jsx'), 'utf8');
    const header = src.match(/\{\[(.*?)\]\.map\(\(h, i\)/s)[1];
    const count = header.split(',').length;
    const cols = Number(src.match(/const COLS = (\d+)/)[1]);
    // A mismatch silently shifts every cell one column left — the kind of bug
    // that looks like bad data rather than bad markup.
    expect(cols).toBe(count);
  });

  // 2026-08-25, the owner's rule: accounts never expire, so "open-ended
  // access" is a phrase with no referent any more. Blank access_days now means
  // the standard 30-day CREDIT life, and the cell must say so — a label that
  // still read "open-ended" would promise credits that never die.
  it('a code with no access period reads as the 30-day standard, not blank, zero, or open-ended', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/admin/PromoCodesTab.jsx'), 'utf8');
    // the ternary on access_days must fall through to a readable label
    expect(src).toMatch(/p\.access_days/);
    expect(src).toMatch(/30 \(standard\)/);
    expect(src).not.toMatch(/open-ended access/);
    expect(src).not.toMatch(/\{p\.access_days \|\| 0\}/);
  });

  it('the export carries redemption AND credit-expiry so they can be compared', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/admin/PromoCodesTab.jsx'), 'utf8');
    expect(src).toMatch(/'Redeemed':/);
    expect(src).toMatch(/'Credits end':/);
    expect(src).toMatch(/'Days left':/);
    // The dead account date must not sneak back into the sheet.
    expect(src).not.toMatch(/access_ends_at/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #97 — adding somebody to a list that already exists
//
// On 2026-09-02 one attendee of 84 could not redeem. The only answers available
// were "issue a whole second code" or "grant the credits by hand"; Amr issued a
// second code and wrote himself a note not to forget it. Neither answer leaves
// a mark on the code's own screen, which is where anyone would look a week
// later. This is the control that closes that loop.

const openInvites = async (user, code = 'VOXEL-OLD-0001') => {
  render(<PromoCodesTab />);
  await waitFor(() => screen.getByText(code));
  const row = screen.getByText(code).closest('tr');
  await user.click(within(row).getByRole('button', { name: /\d+ \/ / }));
  await waitFor(() => expect(api.promoInvites).toHaveBeenCalled());
};

describe('#97 — adding somebody who was left off the sheet', () => {
  it('offers the control on a code that HAS a list', async () => {
    const user = userEvent.setup();
    await openInvites(user);
    expect(await screen.findByRole('button', { name: /Add email to this list/ })).toBeInTheDocument();
  });

  it('sends what was typed, and reloads the list from the server', async () => {
    const user = userEvent.setup();
    await openInvites(user);
    await user.click(screen.getByRole('button', { name: /Add email to this list/ }));

    await user.type(screen.getByLabelText(/Add an email address to VOXEL-OLD-0001/), 'late@example.com');
    await user.click(screen.getByRole('button', { name: /^Add to list$/ }));

    await waitFor(() => expect(api.promoInvitesAdd).toHaveBeenCalledWith(1, 'late@example.com'));
    // Re-read rather than patched in place: what appears must be what was
    // actually stored, including the form the server normalised it to.
    await waitFor(() => expect(api.promoInvites).toHaveBeenCalledTimes(2));
  });

  it('Enter submits, because one address is the whole point', async () => {
    const user = userEvent.setup();
    await openInvites(user);
    await user.click(screen.getByRole('button', { name: /Add email to this list/ }));
    await user.type(screen.getByLabelText(/Add an email address/), 'late@example.com{Enter}');
    await waitFor(() => expect(api.promoInvitesAdd).toHaveBeenCalled());
  });

  it('☠ says so when a hand-set cap will refuse the person just added', async () => {
    // The failure this feature could quietly reintroduce: added to the list,
    // still refused at the door, and nothing anywhere explaining why.
    const { toast } = await import('sonner');
    api.promoInvitesAdd.mockResolvedValue({
      added: 1, duplicate: [], invalid: [], total: 85, max_redemptions: 50,
      capWarning: 'VOXEL-OLD-0001 allows 50 redemptions and the list now holds 85.',
    });
    const user = userEvent.setup();
    await openInvites(user);
    await user.click(screen.getByRole('button', { name: /Add email to this list/ }));
    await user.type(screen.getByLabelText(/Add an email address/), 'late@example.com{Enter}');

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('allows 50 redemptions'), expect.objectContaining({ duration: 15000 })));
  });

  it('an address already on the list is reported, not counted as added', async () => {
    const { toast } = await import('sonner');
    api.promoInvitesAdd.mockResolvedValue({ added: 0, duplicate: ['sara@example.com'], invalid: [] });
    const user = userEvent.setup();
    await openInvites(user);
    await user.click(screen.getByRole('button', { name: /Add email to this list/ }));
    await user.type(screen.getByLabelText(/Add an email address/), 'sara@example.com{Enter}');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('already on the list')));
  });

  it('refuses to call the server with an empty box', async () => {
    const user = userEvent.setup();
    await openInvites(user);
    await user.click(screen.getByRole('button', { name: /Add email to this list/ }));
    await user.click(screen.getByRole('button', { name: /^Add to list$/ }));
    expect(api.promoInvitesAdd).not.toHaveBeenCalled();
  });

  it('☠ and does NOT offer it on an OPEN code', async () => {
    // GULF-MEDIA has no list. Adding one address would LOCK it to that person
    // and shut everybody else out — so the control is not there to click.
    api.promoInvites.mockResolvedValue({ total: 0, redeemedCount: 0, waitingCount: 0, waiting: [], redeemed: [] });
    const user = userEvent.setup();
    await openInvites(user, 'GULF-MEDIA');
    expect(screen.queryByRole('button', { name: /Add email to this list/ })).toBeNull();
  });
});

describe('☠ AN OPEN CODE AND A BROKEN REQUEST MUST NOT LOOK THE SAME', () => {
  // Found by Amr on 2026-09-02, opening VOXEL-KY7X-YDQF on dev to try the new
  // add-email button and finding nothing there. The code is open — every code
  // issued before 20 August is — so the screen was RIGHT. But it said nothing
  // at all, and a failed request would have said nothing at all too.
  //
  // The catch was literally `catch {}` with the note "not a failure worth a
  // toast". It was worth a sentence.

  it('says OPEN CODE out loud, instead of rendering nothing', async () => {
    api.promoInvites.mockResolvedValue({ total: 0, redeemedCount: 0, waitingCount: 0, waiting: [], redeemed: [] });
    const user = userEvent.setup();
    await openInvites(user, 'GULF-MEDIA');
    expect(await screen.findByText(/Open code/)).toBeInTheDocument();
    expect(screen.getByText(/anyone signed in who has the string can redeem/)).toBeInTheDocument();
    // and it explains why there is no button, rather than leaving a hole
    expect(screen.getByText(/shut everybody else out/)).toBeInTheDocument();
  });

  it('☠ and says the opposite thing when the list could not be READ', async () => {
    api.promoInvites.mockRejectedValue(new Error('503 database not available'));
    const user = userEvent.setup();
    await openInvites(user, 'GULF-MEDIA');
    const msg = await screen.findByText(/could not be read/);
    expect(msg).toBeInTheDocument();
    // The distinction that matters: it is not a claim about the code.
    // (Matched on a contiguous run — the sentence is broken by an <em>.)
    expect(screen.getByText(/has no list — it means we do not know/)).toBeInTheDocument();
    expect(screen.queryByText(/Open code/)).toBeNull();
  });

  it('and neither message appears on a code that HAS a list', async () => {
    const user = userEvent.setup();
    await openInvites(user);                       // the default mock: 3 invited
    await screen.findByRole('button', { name: /Add email to this list/ });
    expect(screen.queryByText(/Open code/)).toBeNull();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});

describe('☠ THE TOP-UP MUST BE REACHABLE ON AN OPEN CODE', () => {
  // It was first placed inside `invites[p.id]?.total > 0`, so it appeared only
  // on codes WITH an email list — invisible on every open code. Every code
  // issued before 20 August is open, including all the SPA ones: the control
  // would have been missing from exactly the codes it was built for.
  //
  // Caught by reading the JSX before telling the owner where to find it —
  // after doing the opposite with the sidebar an hour earlier and sending him
  // hunting for a screen that was somewhere else.

  it('appears on a code with NO invitation list', async () => {
    api.promoInvites.mockResolvedValue({ total: 0, redeemedCount: 0, waitingCount: 0, waiting: [], redeemed: [] });
    const user = userEvent.setup();
    await openInvites(user, 'GULF-MEDIA');
    expect(await screen.findByRole('button', { name: /Raise the value/ })).toBeInTheDocument();
  });

  it('and on a code that HAS one', async () => {
    const user = userEvent.setup();
    await openInvites(user);                       // default mock: 3 invited
    expect(await screen.findByRole('button', { name: /Raise the value/ })).toBeInTheDocument();
  });

  it('☠ and it is not nested inside any invites condition', () => {
    // The source check, because the two above would both pass if the panel
    // were duplicated into each branch — and then they would drift.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/admin/PromoCodesTab.jsx'), 'utf8');
    expect((src.match(/<PromoTopUpPanel/g) || []).length,
      'the top-up panel is rendered more than once — two copies will drift').toBe(1);
    const at = src.indexOf('<PromoTopUpPanel');
    const before = src.slice(src.indexOf("{isExpanded && ("), at);
    expect(before,
      'the top-up sits inside an invites condition, so it is invisible on open codes')
      .not.toMatch(/\{invites\[p\.id\]/);
  });
});
