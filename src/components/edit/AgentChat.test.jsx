// ─── AgentChat.test.jsx ──────────────────────────────────────────────────────
// The chat panel, tested for the things that decide whether anybody can trust
// it with their timeline.
//
// The model writes the reply. The model is also the one component here capable
// of being confidently wrong. So the tests are mostly about the gap between
// what it SAYS it did and what actually happened:
//
//   · "Done!" must come with the list of real edits underneath it
//   · a refusal must appear IN the conversation and keep what was typed
//   · one sentence must cost exactly one undo step, not seven

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: vi.fn() } },
}));
import { base44 } from '@/api/base44Client';

import AgentChat from './AgentChat';
import { createProject, createClip, addClip, addSource, __resetIds } from '@/lib/timeline';

function fixture() {
  __resetIds();
  let p = createProject({ name: 'T' });
  p = addSource(p, { id: 's1', url: 'https://x/a.mp4', prompt: 'a dragon', duration: 10 });
  p = addClip(p, p.tracks[0].id, createClip({ kind: 'video', sourceId: 's1', start: 0, in: 0, out: 10 }));
  return { p, clipId: p.tracks[0].clips[0].id, trackId: p.tracks[0].id };
}

/** The server hands back the model's raw text; the browser parses it. */
const answers = (obj) => base44.functions.invoke.mockResolvedValue({ data: { raw: JSON.stringify(obj) } });

const type = (s) => fireEvent.change(screen.getByTestId('agent-input'), { target: { value: s } });
const send = () => fireEvent.click(screen.getByTestId('agent-send'));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('it shows what it DID, not just that it did something', () => {
  it('lists the real edits under the reply', async () => {
    // "Done!" on its own has to be taken on trust. The list is generated from
    // what the executor actually applied, not from what the model claims.
    const { p, clipId } = fixture();
    answers({ reply: 'Cut it.', commands: [{ op: 'setSpeed', clipId, speed: 2 }] });

    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('speed it up'); send();

    expect(await screen.findByTestId('applied')).toBeTruthy();
    expect(screen.getByTestId('applied').textContent).toMatch(/2×/);
  });

  it('applies ONE undo step for one sentence, however many edits it took', async () => {
    // Seven presses of Cmd+Z to reverse one sentence is a puzzle, not an undo.
    const { p, clipId } = fixture();
    answers({
      reply: 'Done.',
      commands: [
        { op: 'setSpeed', clipId, speed: 2 },
        { op: 'rename', clipId, name: 'Fast' },
        { op: 'setVolume', clipId, volume: 0 },
      ],
    });
    const onApply = vi.fn();

    render(<AgentChat project={p} onApply={onApply} />);
    type('speed it up, rename it, mute it'); send();

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('applied').children).toHaveLength(3);
  });

  it('sends only a SUMMARY — never the source urls', async () => {
    // They are long, signed, useless for deciding where to cut, and paid for
    // on every single message.
    const { p } = fixture();
    answers({ reply: 'ok', commands: [] });

    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('what is here?'); send();

    await waitFor(() => expect(base44.functions.invoke).toHaveBeenCalled());
    const [, body] = base44.functions.invoke.mock.calls[0];
    expect(JSON.stringify(body)).not.toMatch(/https?:/);
    expect(JSON.stringify(body)).toMatch(/a dragon/);   // the prompt IS sent
  });
});

describe('a refusal belongs in the conversation', () => {
  it('shows the reason and does NOT touch the project', async () => {
    const { p } = fixture();
    answers({ reply: 'Deleting it.', commands: [{ op: 'delete', clipId: 'c-invented' }] });
    const onApply = vi.fn();

    render(<AgentChat project={p} onApply={onApply} />);
    type('delete the third clip'); send();

    expect((await screen.findByTestId('agent-error')).textContent).toMatch(/no clip called c-invented/i);
    expect(onApply, 'a refused batch must not reach the timeline').not.toHaveBeenCalled();
  });

  it('KEEPS what was typed so it can be reworded', async () => {
    // Clearing the box is right when it worked and infuriating when it did not.
    const { p } = fixture();
    answers({ reply: '', commands: [{ op: 'delete', clipId: 'nope' }] });

    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('delete the last bit'); send();

    await screen.findByTestId('agent-error');
    expect(screen.getByTestId('agent-input').value).toBe('delete the last bit');
  });

  it('clears the box when it DID work', async () => {
    const { p, clipId } = fixture();
    answers({ reply: 'Done.', commands: [{ op: 'setSpeed', clipId, speed: 2 }] });

    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('faster'); send();

    await screen.findByTestId('applied');
    expect(screen.getByTestId('agent-input').value).toBe('');
  });

  it("uses the SERVER's words when the server has something to say", async () => {
    // It knows things this component does not — rate limits, a missing key.
    const { p } = fixture();
    base44.functions.invoke.mockRejectedValue({
      response: { data: { error: 'Too many prompt enhancements — please wait a moment.' } },
    });

    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('cut it'); send();

    expect((await screen.findByTestId('agent-error')).textContent).toMatch(/please wait a moment/);
  });

  it('a network failure says nothing was changed', async () => {
    const { p } = fixture();
    base44.functions.invoke.mockRejectedValue(new Error('Network Error'));

    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('cut it'); send();

    expect((await screen.findByTestId('agent-error')).textContent).toMatch(/Network Error/);
  });
});

describe('answering without editing', () => {
  it('a reply with no commands is shown and changes nothing', async () => {
    // Asking a question, or asking for clarification, is normal — and must not
    // look like a failure.
    const { p } = fixture();
    answers({ reply: 'Which clip did you mean?', commands: [] });
    const onApply = vi.fn();

    render(<AgentChat project={p} onApply={onApply} />);
    type('remove that one'); send();

    expect(await screen.findByText(/Which clip did you mean/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByTestId('agent-error')).toBe(null);
  });

  it('survives prose instead of JSON', async () => {
    const { p } = fixture();
    base44.functions.invoke.mockResolvedValue({ data: { raw: 'I can help with that.' } });

    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('hello'); send();

    expect(await screen.findByText(/I can help with that/)).toBeTruthy();
  });
});

describe('when it cannot be used', () => {
  it('says why instead of showing a box that swallows what you type', async () => {
    const { p } = fixture();
    render(<AgentChat project={p} onApply={vi.fn()} disabled disabledReason="Sign in to use the assistant." />);

    expect(screen.getByText(/Sign in to use the assistant/)).toBeTruthy();
    expect(screen.queryByTestId('agent-input')).toBe(null);
  });

  it('does not send an empty instruction', () => {
    const { p } = fixture();
    render(<AgentChat project={p} onApply={vi.fn()} />);
    type('   ');
    expect(screen.getByTestId('agent-send').disabled).toBe(true);
  });

  it('Enter sends, Shift+Enter does not', async () => {
    const { p } = fixture();
    answers({ reply: 'ok', commands: [] });
    render(<AgentChat project={p} onApply={vi.fn()} />);

    type('cut it');
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: true });
    expect(base44.functions.invoke).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter' });
    await waitFor(() => expect(base44.functions.invoke).toHaveBeenCalledTimes(1));
  });
});
