// ─── enhance-button.test.jsx ─────────────────────────────────────────────────
// ☠ THE ⚡ BUTTON WAS A <div> WITH A TITLE AND NO HANDLER.
//
// /api/enhance-prompt sits complete on the server: JWT, not-banned, a
// per-user rate limit, an LLM, careful error handling, and a security fix
// applied to it in the July 2026 audit (H2 — it had been unauthenticated, so
// anyone could spend our provider budget). Its own comment says "Used by the
// red bolt button in the Image and Video prompt areas."
//
// Nothing called it. Not the Image page, not the Video page. A customer saw a
// red lightning button with cursor:pointer, pressed it, and nothing happened —
// on every generation, for months. The structure check reported the endpoint
// as "nothing calls this" and that line had been unreadable for other reasons,
// so nobody looked.
//
// Two properties matter beyond "it calls the endpoint":
//   1. it must never silently eat somebody's prompt
//   2. a failure must name the cause — invariant 1 of this project

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VideoLeftPanel from './VideoLeftPanel';
import { base44 } from '@/api/base44Client';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

beforeEach(() => vi.restoreAllMocks());

/** The panel, with a controlled prompt so we can see what it becomes. */
function Harness({ initial = 'a cat' }) {
  const [prompt, setPrompt] = React.useState(initial);
  return <VideoLeftPanel prompt={prompt} onPromptChange={setPrompt} />;
}

const bolt = () => screen.getByRole('button', { name: /Expand my prompt|Put my prompt back/ });

describe('☠ IT IS A BUTTON, AND IT DOES SOMETHING', () => {
  it('is a real button — not a div with a title', async () => {
    // A <div> is invisible to the keyboard and to a screen reader, as well as
    // being inert. Both were true here.
    render(<Harness />);
    expect(bolt().tagName).toBe('BUTTON');
  });

  it('calls the endpoint that has existed all along', async () => {
    const spy = vi.spyOn(base44.functions, 'invoke')
      .mockResolvedValue({ data: { prompt: 'a cat, cinematic, 35mm, golden hour' } });
    render(<Harness />);
    await userEvent.click(bolt());
    await waitFor(() => expect(spy).toHaveBeenCalledWith('enhance-prompt',
      { prompt: 'a cat', type: 'video' }));
  });

  it('and the expanded prompt reaches the textarea', async () => {
    vi.spyOn(base44.functions, 'invoke')
      .mockResolvedValue({ data: { prompt: 'a cat, cinematic, 35mm, golden hour' } });
    render(<Harness />);
    await userEvent.click(bolt());
    expect(await screen.findByDisplayValue(/cinematic, 35mm/)).toBeInTheDocument();
  });

  it('asks as VIDEO, not image — the two prompts are written differently', async () => {
    const spy = vi.spyOn(base44.functions, 'invoke').mockResolvedValue({ data: { prompt: 'x' } });
    render(<Harness />);
    await userEvent.click(bolt());
    await waitFor(() => expect(spy.mock.calls[0][1].type).toBe('video'));
  });
});

describe('☠ IT NEVER EATS SOMEBODY\'S PROMPT', () => {
  it('a second press puts the original back', async () => {
    // Setting a value programmatically does NOT enter the browser's undo
    // history, so ⌘Z cannot rescue them. Without this the button is a way to
    // lose what you wrote.
    vi.spyOn(base44.functions, 'invoke').mockResolvedValue({ data: { prompt: 'EXPANDED' } });
    render(<Harness initial="my careful wording" />);
    await userEvent.click(bolt());
    await screen.findByDisplayValue('EXPANDED');
    await userEvent.click(bolt());
    expect(await screen.findByDisplayValue('my careful wording')).toBeInTheDocument();
  });

  it('and says so, so the way back is discoverable', async () => {
    vi.spyOn(base44.functions, 'invoke').mockResolvedValue({ data: { prompt: 'EXPANDED' } });
    render(<Harness />);
    await userEvent.click(bolt());
    await waitFor(() => expect(toast.success)
      .toHaveBeenCalledWith(expect.stringMatching(/press ⚡ again to put yours back/)));
  });

  it('an empty prompt is refused before spending money on the provider', async () => {
    const spy = vi.spyOn(base44.functions, 'invoke');
    render(<Harness initial="   " />);
    await userEvent.click(bolt());
    expect(spy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Write something first/));
  });
});

describe('☠ A FAILURE NAMES THE CAUSE', () => {
  it('shows the SERVER\'s sentence, not a generic one', async () => {
    // Invariant 1: no path may fail with a vague toast. The server writes
    // "The prompt enhancer is unavailable — the AI provider refused the
    // request. Your prompt is unchanged." That is the sentence to show.
    const err = new Error('Request failed');
    err.body = { error: 'The prompt enhancer is unavailable — the AI provider refused the request.' };
    vi.spyOn(base44.functions, 'invoke').mockRejectedValue(err);
    render(<Harness />);
    await userEvent.click(bolt());
    await waitFor(() => expect(toast.error)
      .toHaveBeenCalledWith(expect.stringMatching(/the AI provider refused/)));
  });

  it('a reply with no prompt in it is a failure, not a silent no-op', async () => {
    vi.spyOn(base44.functions, 'invoke').mockResolvedValue({ data: {} });
    render(<Harness initial="keep me" />);
    await userEvent.click(bolt());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByDisplayValue('keep me')).toBeInTheDocument();
  });

  it('and the prompt survives a failure untouched', async () => {
    vi.spyOn(base44.functions, 'invoke').mockRejectedValue(new Error('boom'));
    render(<Harness initial="untouched" />);
    await userEvent.click(bolt());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByDisplayValue('untouched')).toBeInTheDocument();
  });
});

describe('☠ THERE IS EXACTLY ONE ⚡, AND IT IS NOT OVER THE TEXT', () => {
  const src = () => {
    const fs = require('node:fs');
    const path = require('node:path');
    return fs.readFileSync(path.join(__dirname, 'VideoLeftPanel.jsx'), 'utf8');
  };

  it('only one enhance control exists', async () => {
    // There were two, both inert: this header button and a red pill anchored
    // inside the textarea. Two controls for one action is a way to press the
    // wrong one, and one of them was always going to be the dead one.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const s = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'VideoLeftPanel.jsx'), 'utf8');
    expect((s.match(/<Zap /g) || []).length, 'a second ⚡ is back').toBe(1);
    expect((s.match(/onClick=\{enhance\}/g) || []).length).toBe(1);
  });

  it('☠ and it is NOT positioned inside the prompt box', async () => {
    // Amr: "the text, it's become on the icons." Padding cannot fix that — a
    // long prompt SCROLLS, so text passes under anything anchored to the box.
    // The control has to be outside the text entirely.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const s = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'VideoLeftPanel.jsx'), 'utf8');
    const at = s.indexOf('onClick={enhance}');
    const block = s.slice(Math.max(0, at - 600), at + 600);
    expect(block, 'the ⚡ is absolutely positioned again — it will sit on the prompt')
      .not.toMatch(/position:\s*'absolute'[^}]*bottom:/s);
  });

  it('still works from its new home', async () => {
    vi.spyOn(base44.functions, 'invoke').mockResolvedValue({ data: { prompt: 'EXPANDED' } });
    render(<Harness initial="a cat" />);
    await userEvent.click(bolt());
    expect(await screen.findByDisplayValue('EXPANDED')).toBeInTheDocument();
  });
});
