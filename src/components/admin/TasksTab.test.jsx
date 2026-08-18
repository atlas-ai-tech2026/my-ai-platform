// ─── TasksTab.test.jsx ───────────────────────────────────────────────────────
// This board exists so the owner stops having to ask me what is pending. So the
// tests are about whether it actually answers that — and about the failure a
// task board has: going stale, or hiding the thing you needed to see.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TasksTab from './TasksTab';

const tasks = vi.fn();
const taskStatus = vi.fn();
const taskMove = vi.fn();
vi.mock('@/lib/adminApi', () => ({
  adminApi: { tasks: (...a) => tasks(...a), taskStatus: (...a) => taskStatus(...a),
             taskMove: (...a) => taskMove(...a) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const t = (over = {}) => ({
  id: 1, ref: '54', title: 'Move DNS to Cloudflare', owner: 'owner', status: 'pending',
  priority: 20, why: 'There is no WAF you control.', detail: 'Registrar is GoDaddy.',
  blocked_by: null, done_at: null, ...over,
});

const payload = (list) => ({
  tasks: list,
  summary: {
    owner:  { pending: list.filter((x) => x.owner === 'owner'  && x.status === 'pending').length, blocked: 0, done: list.filter((x) => x.owner === 'owner'  && x.status === 'done').length },
    claude: { pending: list.filter((x) => x.owner === 'claude' && x.status === 'pending').length, blocked: 0, done: list.filter((x) => x.owner === 'claude' && x.status === 'done').length },
    open: list.filter((x) => x.status !== 'done').length, total: list.length,
  },
});

beforeEach(() => { tasks.mockReset(); taskStatus.mockReset(); taskMove.mockReset(); });

describe('it answers "what is pending?"', () => {
  it('shows tasks with their reference number', async () => {
    tasks.mockResolvedValue(payload([t()]));
    render(<TasksTab onError={vi.fn()} />);
    expect(await screen.findByText('Move DNS to Cloudflare')).toBeInTheDocument();
    expect(screen.getByText('#54')).toBeInTheDocument();
  });

  it('splits yours from mine — that is the question being asked', async () => {
    tasks.mockResolvedValue(payload([t(), t({ id: 2, ref: '29', owner: 'claude', title: 'model_label' })]));
    render(<TasksTab onError={vi.fn()} />);
    // "Yours" is both a filter BUTTON and a group HEADING. Matching loosely
    // would pass while proving nothing about the grouping, so assert both
    // appear twice — once as a control, once as a section.
    await screen.findByText('Move DNS to Cloudflare');
    expect(screen.getAllByText('Yours').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Mine').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('model_label')).toBeInTheDocument();
  });

  it('opens a task to show WHY it matters', async () => {
    tasks.mockResolvedValue(payload([t()]));
    render(<TasksTab onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Move DNS to Cloudflare/i }));
    expect(await screen.findByText(/There is no WAF you control/)).toBeInTheDocument();
  });

  // "Blocked" with no reason is just a task nobody wants to look at.
  it('says what is blocking a blocked task', async () => {
    tasks.mockResolvedValue(payload([t({ status: 'blocked', blocked_by: 'The legal entity name' })]));
    render(<TasksTab onError={vi.fn()} />);
    expect(await screen.findByText(/The legal entity name/)).toBeInTheDocument();
    // The status pill, not the "Blocked by:" label beneath it.
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });
});

describe('done work stays visible, but out of the way', () => {
  it('hides finished tasks by default', async () => {
    tasks.mockResolvedValue(payload([t({ id: 2, ref: '34', title: 'Prove a backup restores', status: 'done' })]));
    render(<TasksTab onError={vi.fn()} />);
    await waitFor(() => expect(tasks).toHaveBeenCalled());
    expect(screen.queryByText('Prove a backup restores')).not.toBeInTheDocument();
  });

  // A board showing only the backlog makes steady progress look like standing still.
  it('shows them on request', async () => {
    tasks.mockResolvedValue(payload([t({ id: 2, ref: '34', title: 'Prove a backup restores', status: 'done' })]));
    render(<TasksTab onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /show done/i }));
    expect(await screen.findByText('Prove a backup restores')).toBeInTheDocument();
  });
});

describe('the owner can move their own work', () => {
  it('marks a task done', async () => {
    tasks.mockResolvedValue(payload([t()]));
    taskStatus.mockResolvedValue(payload([t({ status: 'done' })]));
    render(<TasksTab onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(taskStatus).toHaveBeenCalledWith(1, 'done'));
  });

  it('can reopen something closed too early', async () => {
    tasks.mockResolvedValue(payload([t({ status: 'done' })]));
    render(<TasksTab onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /show done/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(taskStatus).toHaveBeenCalledWith(1, 'pending'));
  });
});

describe('it never pretends', () => {
  // Same rule as every other screen: a failed load is not an empty board.
  it('shows an error state rather than an empty list', async () => {
    tasks.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    render(<TasksTab onError={vi.fn()} />);
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/it is unknown/i)).toBeInTheDocument();
  });

  it('names an expired session as an expired session', async () => {
    tasks.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
    render(<TasksTab onError={vi.fn()} />);
    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });
});

// The owner asked to be able to change the priority. It drove the order all
// along but was invisible and fixed.
describe('reordering', () => {
  it('offers up and down on anything not finished', async () => {
    tasks.mockResolvedValue(payload([t()]));
    render(<TasksTab onError={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /Higher priority/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lower priority/i })).toBeInTheDocument();
  });

  it('does not offer to reorder finished work', async () => {
    tasks.mockResolvedValue(payload([t({ status: 'done' })]));
    render(<TasksTab onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /show done/i }));
    expect(screen.queryByRole('button', { name: /Higher priority/i })).not.toBeInTheDocument();
  });

  it('sends the direction, not a priority number', async () => {
    tasks.mockResolvedValue(payload([t()]));
    taskMove.mockResolvedValue({ ...payload([t()]), moved: true });
    render(<TasksTab onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Higher priority/i }));
    await waitFor(() => expect(taskMove).toHaveBeenCalledWith(1, 'up'));
  });
});
