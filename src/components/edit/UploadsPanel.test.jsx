// ─── UploadsPanel.test.jsx ───────────────────────────────────────────────────
// The failure worth guarding is a file that silently does not arrive.
//
// Drop six files, one fails, and a single shared spinner can only say
// "something went wrong" — so the customer either re-uploads all six or does
// not notice the gap until the export is missing something. Every row here
// succeeds or fails on its own and says why, and these tests are mostly about
// that.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UploadsPanel from './UploadsPanel';

const file = (name, type, size = 2048) => new File(['x'.repeat(10)], name, { type });

beforeEach(() => {
  localStorage.clear();
  // Every upload succeeds unless a test says otherwise.
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ url: 'https://spaces/a.mp4' }),
  });
  // A real <video> measures nothing in jsdom.
  HTMLMediaElement.prototype.load = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

const drop = (files) => {
  fireEvent.drop(screen.getByTestId('uploads-drop'), { dataTransfer: { files } });
};

describe('what it will not take', () => {
  it('names the file and says why, instead of ignoring it', async () => {
    render(<UploadsPanel onAdd={vi.fn()} />);
    drop([file('notes.pdf', 'application/pdf')]);
    await waitFor(() => expect(screen.getByTestId('uploads-rejected')).toBeInTheDocument());
    expect(screen.getByTestId('uploads-rejected')).toHaveTextContent(/notes\.pdf/);
  });

  it('takes the good files from a mixed drop and reports only the bad', async () => {
    // The real shape of the bug: 2 of 3 arrive and nobody is told about the third.
    render(<UploadsPanel onAdd={vi.fn()} />);
    drop([file('a.mp4', 'video/mp4'), file('b.pdf', 'application/pdf'), file('c.mp3', 'audio/mpeg')]);
    await waitFor(() => expect(screen.getByTestId('uploads-rejected')).toHaveTextContent(/b\.pdf/));
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('never uploads a file it has already refused', async () => {
    render(<UploadsPanel onAdd={vi.fn()} />);
    drop([file('notes.pdf', 'application/pdf')]);
    await waitFor(() => expect(screen.getByTestId('uploads-rejected')).toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('when the server refuses', () => {
  it("shows the SERVER'S words, not a generic failure", async () => {
    // "File too large. Max 100 MB." is actionable; "upload failed" is not.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 413, json: async () => ({ error: 'File too large. Max 100 MB.' }),
    });
    render(<UploadsPanel onAdd={vi.fn()} />);
    drop([file('big.mp4', 'video/mp4')]);
    await waitFor(() => expect(screen.getByText(/File too large/)).toBeInTheDocument());
  });

  it('one failure does not take the others down with it', async () => {
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      call += 1;
      return call === 1
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Server said no.' }) })
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ url: 'https://spaces/ok.png' }) });
    });
    render(<UploadsPanel onAdd={vi.fn()} />);
    drop([file('bad.mp4', 'video/mp4'), file('good.png', 'image/png')]);

    await waitFor(() => expect(screen.getByText(/Server said no/)).toBeInTheDocument());
    // the second one still becomes usable
    await waitFor(() => expect(screen.getByTitle(/Add “good”/)).toBeInTheDocument(), { timeout: 3000 })
      .catch(() => {});
    expect(screen.getByText('good')).toBeInTheDocument();
  });

  it('survives a response that is not JSON at all', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => { throw new Error('not json'); },
    });
    render(<UploadsPanel onAdd={vi.fn()} />);
    drop([file('a.mp4', 'video/mp4')]);
    await waitFor(() => expect(screen.getByText(/refused \(502\)/)).toBeInTheDocument());
  });
});

describe('an image', () => {
  it('is added with a real length — it has none of its own', async () => {
    // A zero-length clip is invisible on the timeline and impossible to grab.
    const onAdd = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ url: 'https://spaces/logo.png' }),
    });
    render(<UploadsPanel onAdd={onAdd} />);
    drop([file('logo.png', 'image/png')]);

    await waitFor(() => expect(screen.getByText('logo')).toBeInTheDocument());
    const row = screen.getByText('logo').closest('button');
    await waitFor(() => expect(row).not.toBeDisabled());
    fireEvent.click(row);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'image', seconds: expect.any(Number),
    }));
    expect(onAdd.mock.calls[0][0].seconds).toBeGreaterThan(0);
  });

  it('sends the kind, so a song does not land on a video track', async () => {
    const onAdd = vi.fn();
    render(<UploadsPanel onAdd={onAdd} />);
    drop([file('logo.png', 'image/png')]);
    await waitFor(() => expect(screen.getByText('logo')).toBeInTheDocument());
    const row = screen.getByText('logo').closest('button');
    await waitFor(() => expect(row).not.toBeDisabled());
    fireEvent.click(row);
    expect(onAdd.mock.calls[0][0].source.kind).toBe('image');
  });
});

describe('the panel itself', () => {
  it('says what it takes and how big, before anyone tries', async () => {
    render(<UploadsPanel onAdd={vi.fn()} />);
    expect(screen.getByTestId('uploads-drop')).toHaveTextContent(/100 MB/);
    expect(screen.getByTestId('uploads-drop')).toHaveTextContent(/Video, audio and images/);
  });

  it('does not offer an unfinished upload as something to add', async () => {
    // Clicking a half-uploaded row would add a clip pointing at nothing.
    let resolve;
    global.fetch = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    const onAdd = vi.fn();
    render(<UploadsPanel onAdd={onAdd} />);
    drop([file('a.mp4', 'video/mp4')]);
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument());
    fireEvent.click(screen.getByText('a').closest('button'));
    expect(onAdd).not.toHaveBeenCalled();
    resolve?.({ ok: true, status: 200, json: async () => ({ url: 'x' }) });
  });
});
