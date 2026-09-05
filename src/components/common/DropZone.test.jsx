// ─── DropZone.test.jsx ───────────────────────────────────────────────────────
// The two things that make a drop zone annoying rather than useful:
// a highlight that sticks on after the pointer has left, and a refused file
// that disappears without a word. Both are tested here.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import DropZone, { fileMatches, sortFiles } from './DropZone';

const file = (name, type, size = 1000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const drop = (el, files) =>
  fireEvent.drop(el, { dataTransfer: { files, types: ['Files'] } });

describe('fileMatches', () => {
  it('matches an exact mime type', () => {
    expect(fileMatches(file('a.png', 'image/png'), 'image/png,image/jpeg')).toBe(true);
    expect(fileMatches(file('a.gif', 'image/gif'), 'image/png,image/jpeg')).toBe(false);
  });
  it('matches a wildcard', () => {
    expect(fileMatches(file('a.gif', 'image/gif'), 'image/*')).toBe(true);
    expect(fileMatches(file('a.mp4', 'video/mp4'), 'image/*')).toBe(false);
  });
  it('accepts anything when no accept is given', () => {
    expect(fileMatches(file('a.zip', 'application/zip'))).toBe(true);
  });
});

describe('sortFiles', () => {
  it('separates what we can take from what we cannot, with reasons', () => {
    const { accepted, rejected } = sortFiles(
      [file('ok.png', 'image/png'), file('doc.pdf', 'application/pdf')],
      { accept: 'image/*' },
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('doc.pdf');
    expect(rejected[0].reason).toContain('not a supported file type');
  });

  it('refuses a file that is too large, and says how large is allowed', () => {
    const { accepted, rejected } = sortFiles(
      [file('huge.png', 'image/png', 40 * 1024 * 1024)],
      { accept: 'image/*', maxBytes: 20 * 1024 * 1024 },
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/larger than 20 MB/);
  });

  it('survives an empty or missing list', () => {
    expect(sortFiles(null).accepted).toEqual([]);
    expect(sortFiles([]).rejected).toEqual([]);
  });
});

describe('<DropZone>', () => {
  it('hands over the files that pass', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} accept="image/*"><p>bar</p></DropZone>);
    drop(screen.getByTestId('dropzone'), [file('a.png', 'image/png'), file('b.png', 'image/png')]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
  });

  it('☠ NEVER SWALLOWS A REFUSED FILE', () => {
    // Drop five pictures and a PDF and something must say which one was
    // refused. Silence is how the reference-image bug reached Amr.
    const onFiles = vi.fn();
    const onRejected = vi.fn();
    render(<DropZone onFiles={onFiles} onRejected={onRejected} accept="image/*"><p>bar</p></DropZone>);
    drop(screen.getByTestId('dropzone'), [file('a.png', 'image/png'), file('notes.pdf', 'application/pdf')]);
    expect(onFiles.mock.calls[0][0]).toHaveLength(1);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected.mock.calls[0][0][0]).toContain('notes.pdf');
  });

  it('keeps only the first file when multiple is off', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} multiple={false} accept="image/*"><p>bar</p></DropZone>);
    drop(screen.getByTestId('dropzone'), [file('a.png', 'image/png'), file('b.png', 'image/png')]);
    expect(onFiles.mock.calls[0][0]).toHaveLength(1);
  });

  it('ignores drops when disabled', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} disabled accept="image/*"><p>bar</p></DropZone>);
    drop(screen.getByTestId('dropzone'), [file('a.png', 'image/png')]);
    expect(onFiles).not.toHaveBeenCalled();
  });

  describe('the highlight', () => {
    it('appears on drag enter and clears on drop', () => {
      render(<DropZone onFiles={() => {}}><p>bar</p></DropZone>);
      const z = screen.getByTestId('dropzone');
      fireEvent.dragEnter(z, { dataTransfer: { types: ['Files'] } });
      expect(z.getAttribute('data-dragging')).toBe('true');
      drop(z, [file('a.png', 'image/png')]);
      expect(z.getAttribute('data-dragging')).toBe('false');
    });

    it('☠ DOES NOT STICK ON when the pointer crosses a child element', () => {
      // A drag entering a CHILD fires dragleave on the parent. A naive boolean
      // flickers, or worse stays highlighted after the pointer has gone —
      // every drop zone hits this eventually. Enter/leave are counted.
      render(<DropZone onFiles={() => {}}><p>inner</p></DropZone>);
      const z = screen.getByTestId('dropzone');
      const inner = screen.getByText('inner');
      fireEvent.dragEnter(z, { dataTransfer: { types: ['Files'] } });
      fireEvent.dragEnter(inner, { dataTransfer: { types: ['Files'] } });  // into the child
      fireEvent.dragLeave(z, { dataTransfer: { types: ['Files'] } });      // out of the parent
      expect(z.getAttribute('data-dragging'), 'still inside the child — must stay highlighted')
        .toBe('true');
      fireEvent.dragLeave(inner, { dataTransfer: { types: ['Files'] } });  // and out of the child
      expect(z.getAttribute('data-dragging'), 'pointer has left — highlight must clear')
        .toBe('false');
    });
  });
});

// ─── THE SURFACES MUST ACTUALLY USE IT ──────────────────────────────────────
// A component nobody mounts is this project's most-repeated bug. Amr asked for
// drag and drop on the prompt boxes; a perfect DropZone imported nowhere would
// pass every test above and change nothing on screen.
describe('the generation surfaces are wired to it', () => {
  const read = (f) => readFileSync(path.resolve(process.cwd(), f), 'utf8');

  for (const f of [
    'src/components/image/ImagePromptBar.jsx',
    'src/components/voxel-node/NodePanel.jsx',
    'src/components/video/SeedanceRightPanel.jsx',
  ]) {
    it(`${f.split('/').pop()} mounts a DropZone`, () => {
      const src = read(f);
      expect(src, 'must import it').toMatch(/import DropZone from/);
      expect(src, 'must actually render it').toMatch(/<DropZone/);
    });
  }

  it('the Image bar routes the drop through the SAME path as the button', () => {
    // Two paths is how a picture ends up handled differently depending on how
    // it arrived — the bug this file exists to avoid repeating six times.
    const src = read('src/components/image/ImagePromptBar.jsx');
    expect(src).toMatch(/const acceptImageFiles/);
    expect(src, 'the drop must call it').toMatch(/onFiles=\{acceptImageFiles\}/);
    expect(src, 'the file input must call it too').toMatch(/await acceptImageFiles\(files\)/);
  });

  it('Seedance routes the drop through the same path as its picker', () => {
    const src = read('src/components/video/SeedanceRightPanel.jsx');
    expect(src).toMatch(/const acceptMediaFiles/);
    expect(src).toMatch(/onFiles=\{acceptMediaFiles\}/);
    expect(src).toMatch(/acceptMediaFiles\(files\)/);
  });
});
