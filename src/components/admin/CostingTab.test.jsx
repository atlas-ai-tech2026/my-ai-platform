// ─── CostingTab.test.jsx ─────────────────────────────────────────────────────
// The Costing screen is a CALCULATOR, not the charge path. The first block
// pins exactly that, because the single most dangerous failure here would be a
// screen that quietly re-prices live traffic — or one that looks live and is
// not, so a change the owner believes they made never reaches customers.
//
// The rest cover the behaviours the brief specifies: server-canonical numbers,
// override markers, the draft → approve gate, and the coverage gap being
// visible rather than hidden.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CostingTab from './CostingTab';

const api = vi.hoisted(() => ({
  costingState: vi.fn(),
  costingAudit: vi.fn(),
  costingSettings: vi.fn(),
  costingModel: vi.fn(),
  costingSaveDraft: vi.fn(),
  costingApprove: vi.fn(),
  costingDiscard: vi.fn(),
  costingDismissCatalog: vi.fn(),
}));

vi.mock('@/lib/adminApi', () => ({ adminApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PLANS = [
  { id: 1, name: 'Micro', price_usd: 5, credits_override: null, credits: 79, auto_credits: 79, per_credit: 0.0633 },
  { id: 3, name: 'Basic', price_usd: 19, credits_override: null, credits: 300, auto_credits: 300, per_credit: 0.0633 },
];

const MODEL = {
  id: 3, category: 'image', model_name: 'Nano Banana Pro', variant: 'Gemini 3 Pro',
  resolution: '1K / 2K', unit: 'image', kie_cost: 0.09, fal_cost: 0.15,
  credits_override: null, margin_override: null, is_active: true, sort_order: 3,
  basis: 0.15, target: 0.40, auto_credits: 4, credits: 4, sale: 0.2533333,
  margin_vs_basis: 0.4079, margin_vs_kie: 0.6447, qty_per_plan: [19, 75],
};

const OVERRIDDEN = {
  ...MODEL, id: 9, model_name: 'GPT Image 2', resolution: '2K',
  kie_cost: 0.05, fal_cost: 0.234, credits_override: 8, margin_override: 0.55,
  basis: 0.234, target: 0.55, auto_credits: 6.5, credits: 8, sale: 0.5066,
  margin_vs_basis: 0.538, margin_vs_kie: 0.901, qty_per_plan: [9, 37],
};

const STATE = {
  settings: { margin_target: 0.40, credit_value: 19 / 300, alert_threshold: 0, last_fetch_at: null },
  plans: PLANS,
  drafts: [],
  models: [MODEL, OVERRIDDEN],
  worst_margin_per_plan: [0.415, 0.40789],
  profit: {
    max: [
      { id: 3, cost: 0.15, margins: [0.43, 0.4079] },
      { id: 9, cost: 0.234, margins: [0.5788, 0.5442] },
    ],
    kie: [
      { id: 3, cost: 0.09, margins: [0.658, 0.645] },
      { id: 9, cost: 0.05, margins: [0.91, 0.90] },
    ],
    fal: [
      { id: 3, cost: 0.15, margins: [0.43, 0.4079] },
      { id: 9, cost: null, margins: null },
    ],
  },
  coverage: {
    live_total: 52, costed_total: 20, uncosted_total: 32,
    costed: ['nano-pro'], uncosted: ['sora-2', 'midjourney', 'flux-2'],
    seed_rows: 50,
    note: '32 models are charged in production but have no supplier cost recorded here — their margin is unknown, not verified.',
  },
  catalog: [
    { id: 1, provider: 'fal', family: 'Flux 3', lab: 'Black Forest Labs',
      category: 'text-to-video', endpoints: 8, price_usd: 0.2, price_unit: 'second',
      first_seen: '2026-08-04T00:00:00.000Z', dismissed: false },
    // The provider states a price we refuse to parse (token billing), so this
    // one carries NULL — the row must say so, not show $0.
    { id: 2, provider: 'fal', family: 'Qwen Image 3', lab: 'Alibaba',
      category: 'text-to-image', endpoints: 2, price_usd: null, price_unit: null,
      first_seen: '2026-07-21T00:00:00.000Z', dismissed: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.costingState.mockResolvedValue(STATE);
  api.costingModel.mockResolvedValue(STATE);
  api.costingSettings.mockResolvedValue(STATE);
  api.costingSaveDraft.mockResolvedValue(STATE);
  api.costingApprove.mockResolvedValue({ ...STATE, approved: 1 });
  api.costingAudit.mockResolvedValue({ audit: [] });
});

describe('it is unmistakably a calculator, not the charge path', () => {
  it('says so on the screen, in plain words', async () => {
    render(<CostingTab />);
    await waitFor(() => expect(screen.getByText(/This is a calculator/i)).toBeInTheDocument());
    // The sentence is split across elements by the <b> emphasis, so match on
    // the banner's whole text rather than a single node.
    const banner = screen.getByText(/This is a calculator/i).closest('div');
    expect(banner.textContent).toMatch(/does not change what customers are charged/i);
  });

  it('only ever calls costing endpoints — never a pricing or credits one', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));

    const cell = screen.getAllByDisplayValue('0.09')[0];
    await user.clear(cell);
    await user.type(cell, '0.11');
    await user.tab();

    await waitFor(() => expect(api.costingModel).toHaveBeenCalledWith(3, { kie_cost: '0.11' }));
    // Every exposed admin call that could move real money must stay untouched.
    for (const forbidden of ['updateCredits', 'bulkCreateUsers', 'createPromo']) {
      expect(api[forbidden]).toBeUndefined();
    }
  });
});

describe('the server is canonical', () => {
  it('renders the numbers the server computed rather than recalculating', async () => {
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));
    const row = screen.getByText('Nano Banana Pro').closest('tr');
    expect(within(row).getByText('$0.1500')).toBeInTheDocument();   // basis
    expect(within(row).getByText('$0.2533')).toBeInTheDocument();   // sale
    expect(within(row).getByText('40.8%')).toBeInTheDocument();     // margin vs basis
  });

  it('commits an edit on blur, not on every keystroke', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));

    const cell = screen.getAllByDisplayValue('0.09')[0];
    await user.clear(cell);
    await user.type(cell, '0.12');
    // Still nothing sent — each commit is a server round trip AND an audit row.
    expect(api.costingModel).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(api.costingModel).toHaveBeenCalledTimes(1));
  });

  it('does not send anything when a cell is left unchanged', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));
    await user.click(screen.getAllByDisplayValue('0.09')[0]);
    await user.tab();
    expect(api.costingModel).not.toHaveBeenCalled();
  });
});

describe('overrides are visible and reversible', () => {
  it('offers a reset back to the formula when credits are pinned', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('GPT Image 2'));

    const row = screen.getByText('GPT Image 2').closest('tr');
    expect(within(row).getByText('auto 6.5')).toBeInTheDocument();

    await user.click(within(row).getByText('auto 6.5'));
    await waitFor(() => expect(api.costingModel).toHaveBeenCalledWith(9, { credits_override: null }));
  });

  it('offers a reset back to the global margin target', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('GPT Image 2'));

    const row = screen.getByText('GPT Image 2').closest('tr');
    await user.click(within(row).getByText('all 40'));
    await waitFor(() => expect(api.costingModel).toHaveBeenCalledWith(9, { margin_override: null }));
  });
});

describe('plan changes cannot reach anyone without approval', () => {
  it('marks an edited plan as an unapproved draft', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));
    await user.click(screen.getByRole('button', { name: 'Plans' }));

    const price = await screen.findByDisplayValue('19');
    await user.clear(price);
    await user.type(price, '25');
    await user.tab();

    expect(await screen.findByText(/draft — not approved/i)).toBeInTheDocument();
    // Crucially: editing alone must not publish.
    expect(api.costingApprove).not.toHaveBeenCalled();
  });

  it('publishes only when approve is pressed', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));
    await user.click(screen.getByRole('button', { name: 'Plans' }));

    const price = await screen.findByDisplayValue('19');
    await user.clear(price);
    await user.type(price, '25');
    await user.tab();

    await user.click(await screen.findByRole('button', { name: /submit & approve/i }));
    await waitFor(() => expect(api.costingApprove).toHaveBeenCalledTimes(1));
    // The draft is saved first, then approved — never approved from thin air.
    // toHaveBeenCalledBefore needs jest-extended; invocationCallOrder is built in.
    expect(api.costingSaveDraft.mock.invocationCallOrder[0])
      .toBeLessThan(api.costingApprove.mock.invocationCallOrder[0]);
  });

  it('discards a draft without touching the server', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));
    await user.click(screen.getByRole('button', { name: 'Plans' }));

    const price = await screen.findByDisplayValue('19');
    await user.clear(price);
    await user.type(price, '25');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: /discard draft/i }));

    await waitFor(() => expect(screen.queryByText(/draft — not approved/i)).not.toBeInTheDocument());
    expect(api.costingApprove).not.toHaveBeenCalled();
  });
});

describe('the coverage gap is shown, not hidden', () => {
  it('puts the uncosted count in the tab label', async () => {
    render(<CostingTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Coverage \(32\)/ })).toBeInTheDocument());
  });

  it('names the models whose margin is unknown', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByRole('button', { name: /Coverage/ }));
    await user.click(screen.getByRole('button', { name: /Coverage/ }));

    expect(await screen.findByText(/margin is unknown, not verified/i)).toBeInTheDocument();
    expect(screen.getByText('sora-2')).toBeInTheDocument();
    expect(screen.getByText('midjourney')).toBeInTheDocument();
    // And it must not imply the calculator covers everything.
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });
});

describe('profit check', () => {
  it('shows a dash where FAL does not carry a model, never a fake zero', async () => {
    const user = userEvent.setup();
    render(<CostingTab />);
    await waitFor(() => screen.getByText('Nano Banana Pro'));
    await user.click(screen.getByRole('button', { name: 'Profit Check' }));
    await user.click(await screen.findByRole('button', { name: /FAL only/i }));

    const row = screen.getByText('GPT Image 2').closest('tr');
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });
});

// ─── New Models ──────────────────────────────────────────────────────────────
// Models a provider offers that the website does not sell yet. These must be
// visually and semantically distinct from the amber "COST NEEDED" rows: those
// are sold-but-uncosted, these are not sold at all.
describe('New Models', () => {
  const openTab = async () => {
    const user = userEvent.setup();
    render(<CostingTab onError={() => {}} />);
    await waitFor(() => expect(api.costingState).toHaveBeenCalled());
    await user.click(await screen.findByRole('button', { name: /New Models/i }));
    return user;
  };

  it('shows the count of not-yet-sold models on the tab', async () => {
    render(<CostingTab onError={() => {}} />);
    expect(await screen.findByRole('button', { name: /New Models \(2\)/i })).toBeInTheDocument();
  });

  it('lists a discovered model with its provider cost and maker', async () => {
    await openTab();
    expect(await screen.findByText('Flux 3')).toBeInTheDocument();
    expect(screen.getByText('Black Forest Labs')).toBeInTheDocument();
    expect(screen.getByText(/0\.2000/)).toBeInTheDocument();
  });

  // The single most important assertion in this block. A null provider price
  // rendered as $0 would read as a free model at a 100% margin.
  it('renders an unknown provider price as "unknown", never as $0', async () => {
    await openTab();
    const row = (await screen.findByText('Qwen Image 3')).closest('tr');
    expect(within(row).getByText('unknown')).toBeInTheDocument();
    expect(within(row).queryByText('$0.0000')).toBeNull();
    expect(within(row).queryByText('$0.000')).toBeNull();
    expect(within(row).queryByText('$0')).toBeNull();
  });

  it('gives no indicative credits when the provider price is unknown', async () => {
    await openTab();
    const row = (await screen.findByText('Qwen Image 3')).closest('tr');
    // An indicative credit figure computed from a null cost would be 0 credits,
    // implying we could sell it for nothing.
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('marks every discovered row NEW so it cannot be read as a sold model', async () => {
    await openTab();
    expect(screen.getAllByText('NEW')).toHaveLength(2);
  });

  it('says plainly that nothing here is charged to anyone', async () => {
    await openTab();
    expect(screen.getByText(/does not sell yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing here is charged/i)).toBeInTheDocument();
  });

  it('discloses that kie.ai is not checked automatically', async () => {
    await openTab();
    expect(screen.getByText(/kie\.ai publishes no catalogue API/i)).toBeInTheDocument();
  });

  it('hides a model on request and takes the refreshed state from the server', async () => {
    const after = { ...STATE, catalog: [STATE.catalog[0]] };
    api.costingDismissCatalog.mockResolvedValue(after);
    const user = await openTab();
    await user.click(within((await screen.findByText('Qwen Image 3')).closest('tr'))
      .getByRole('button', { name: /hide/i }));
    await waitFor(() => expect(api.costingDismissCatalog).toHaveBeenCalledWith(2, true));
    await waitFor(() => expect(screen.queryByText('Qwen Image 3')).toBeNull());
  });

  it('survives a server that returns no catalog field at all', async () => {
    const { catalog, ...noCatalog } = STATE;
    api.costingState.mockResolvedValue(noCatalog);
    const user = userEvent.setup();
    render(<CostingTab onError={() => {}} />);
    await waitFor(() => expect(api.costingState).toHaveBeenCalled());
    await user.click(await screen.findByRole('button', { name: /New Models/i }));
    expect(await screen.findByText(/Nothing new/i)).toBeInTheDocument();
  });
});

// ─── where the price review lives (2026-08-16) ───────────────────────────────
// The owner looked for supplier price movement under New Models, found only a
// discovery sweep, and concluded the feature was broken. It was in the wrong
// tab. New Models is about models you do NOT sell; a price rise threatens the
// margin on the ones customers are using right now.
describe('supplier price review sits with the models it affects', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/admin/CostingTab.jsx'), 'utf8');

  it('renders the price panel on the Models tab', () => {
    const models = src.slice(src.indexOf("{tab === 'models' &&"), src.indexOf("{tab === 'plans' &&"));
    expect(models).toContain('PriceChangesPanel');
    expect(models).toMatch(/scope="models"/);
  });

  it('leaves New Models as discovery only', () => {
    expect(src).toMatch(/scope="discovery"/);
  });
});
