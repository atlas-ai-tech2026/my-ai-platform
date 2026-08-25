// ─── RegeneratePanel.test.jsx ────────────────────────────────────────────────
// This is the first thing in Edit Cut that spends the customer's money — every
// other operation runs locally with no model behind it. So most of what is
// pinned here is about the money being visible BEFORE the click, and about the
// panel never quietly applying one shot's prompt to a different shot.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import RegeneratePanel from './RegeneratePanel';

vi.mock('@/lib/creditPricing', () => ({ getVideoCredits: vi.fn(() => 32) }));
import { getVideoCredits } from '@/lib/creditPricing';

const clip = (over = {}) => ({ id: 'c1', name: 'race car', in: 0, out: 5, ...over });
const source = (over = {}) => ({
  id: 'gen:1', prompt: 'a race car at golden hour', model: 'Seedance 2.5',
  model_id: 'kie:sd', camera: 'ARRI Alexa 35', lens: 'Zeiss Supreme Prime',
  focal_length: '35mm', fstop: 'f/1.8', ...over,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); getVideoCredits.mockReturnValue(32); });

describe('the money is visible before the click', () => {
  it('puts the price ON the button', () => {
    // A cost discovered after the fact is a cost that feels taken.
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={vi.fn()} />);
    expect(screen.getByTestId('regenerate-button').textContent).toMatch(/32 credits/);
  });

  it('prices the CLIP length, not the original generation length', () => {
    render(<RegeneratePanel clip={clip({ in: 2, out: 11 })} source={source()} onRegenerate={vi.fn()} />);
    expect(getVideoCredits).toHaveBeenCalledWith('kie:sd', { duration: 9 }, null);
  });

  it('still offers the button when the price is unknown, and admits it', () => {
    // Refusing because OUR price table is incomplete would be worse than
    // saying we do not know.
    getVideoCredits.mockReturnValue(null);
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={vi.fn()} />);
    expect(screen.getByTestId('regenerate-button').disabled).toBe(false);
    expect(screen.getByText(/not listed/i)).toBeTruthy();
  });
});

describe('it cannot apply the wrong prompt to the wrong clip', () => {
  it('follows the selection when a different clip is chosen', () => {
    // Left stale, the box would still hold the previous shot's words and
    // regenerating would silently remake this clip with them.
    const { rerender } = render(
      <RegeneratePanel clip={clip()} source={source()} onRegenerate={vi.fn()} />);
    expect(screen.getByLabelText('Prompt for this shot').value).toMatch(/golden hour/);

    rerender(<RegeneratePanel
      clip={clip({ id: 'c2', name: 'castle' })}
      source={source({ id: 'gen:2', prompt: 'a dragon over a castle' })}
      onRegenerate={vi.fn()} />);
    expect(screen.getByLabelText('Prompt for this shot').value).toBe('a dragon over a castle');
  });

  it('sends the EDITED prompt and the clip length', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({});
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={onRegenerate} />);
    fireEvent.change(screen.getByLabelText('Prompt for this shot'), {
      target: { value: 'the same car at night' },
    });
    fireEvent.click(screen.getByTestId('regenerate-button'));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith({
      prompt: 'the same car at night', seconds: 5,
    }));
  });

  it('will not send an empty prompt', () => {
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Prompt for this shot'), { target: { value: '   ' } });
    expect(screen.getByTestId('regenerate-button').disabled).toBe(true);
  });
});

describe('what it says when it cannot help', () => {
  it('names WHY a clip cannot be remade instead of a dead button', () => {
    render(<RegeneratePanel clip={clip()} source={{ id: 's', prompt: '' }} onRegenerate={vi.fn()} />);
    expect(screen.getByText(/no prompt recorded/i)).toBeTruthy();
    expect(screen.queryByTestId('regenerate-button')).toBe(null);
  });

  it('distinguishes a missing MODEL from a missing prompt', () => {
    // Telling someone "no prompt recorded" about a clip whose prompt is
    // visible in the viewer above is the kind of small lie that makes people
    // stop trusting the rest of the screen.
    render(<RegeneratePanel
      clip={clip()}
      source={{ id: 's', prompt: 'a race car at golden hour', model_id: null }}
      onRegenerate={vi.fn()} />);
    expect(screen.getByText(/does not record which model/i)).toBeTruthy();
    expect(screen.queryByText(/no prompt recorded/i)).toBe(null);
  });

  it('asks for a selection when there is none', () => {
    render(<RegeneratePanel clip={null} source={null} onRegenerate={vi.fn()} />);
    expect(screen.getByText(/Select a clip/i)).toBeTruthy();
  });

  it('surfaces a failure rather than looking like nothing happened', async () => {
    const onRegenerate = vi.fn().mockRejectedValue(new Error('Not enough credits.'));
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByTestId('regenerate-button'));
    expect((await screen.findByTestId('regenerate-error')).textContent).toMatch(/Not enough credits/);
  });
});

describe('after it works', () => {
  it('passes on a length change, and points at undo', async () => {
    // The customer changed one shot and the edit around it moved. Being told
    // is the difference between a tool and a surprise.
    const onRegenerate = vi.fn().mockResolvedValue({ note: 'The new shot is 4.0s, so this clip is now 4.0s instead of 5.0s.' });
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByTestId('regenerate-button'));
    const note = await screen.findByTestId('regenerate-note');
    expect(note.textContent).toMatch(/now 4\.0s instead of 5\.0s/);
    expect(note.textContent, 'the way back was not offered').toMatch(/undo/i);
  });

  it('shows the camera settings that travel with the remake', () => {
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={vi.fn()} />);
    expect(screen.getByText(/ARRI Alexa 35/)).toBeTruthy();
    expect(screen.getByText(/35mm/)).toBeTruthy();
  });

  it('warns that an unchanged prompt is a different take, not a no-op', () => {
    render(<RegeneratePanel clip={clip()} source={source()} onRegenerate={vi.fn()} />);
    expect(screen.getByText(/different take/i)).toBeTruthy();
  });
});
