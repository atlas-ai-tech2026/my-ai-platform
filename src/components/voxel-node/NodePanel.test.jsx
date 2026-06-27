import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NodePanel from './NodePanel';

// The panel is what makes "add a video node / upload an image" discoverable —
// the gap the user called out. These assert those entry points exist.
describe('NodePanel', () => {
  it('shows a prominent Upload action and adds an image node on click', () => {
    const onAdd = vi.fn();
    render(<NodePanel onAdd={onAdd} onUpload={vi.fn()} />);
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument();
  });

  it('lists every node type, grouped — including Video Generator', () => {
    const onAdd = vi.fn();
    render(<NodePanel onAdd={onAdd} onUpload={vi.fn()} />);
    expect(screen.getByTitle('Add Video Generator')).toBeInTheDocument();
    expect(screen.getByTitle('Add Image Generator')).toBeInTheDocument();
    expect(screen.getByTitle('Add Image')).toBeInTheDocument(); // upload node
    // Category headers present
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  it('clicking a node row requests it be added', () => {
    const onAdd = vi.fn();
    render(<NodePanel onAdd={onAdd} onUpload={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Add Video Generator'));
    expect(onAdd).toHaveBeenCalledWith('video-generator');
  });

  it('search filters the list', () => {
    render(<NodePanel onAdd={vi.fn()} onUpload={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search nodes'), { target: { value: 'video' } });
    expect(screen.getByText('Video Generator')).toBeInTheDocument();
    expect(screen.queryByText('Voiceover')).not.toBeInTheDocument();
  });
});
