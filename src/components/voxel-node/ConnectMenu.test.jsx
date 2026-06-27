import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectMenu from './ConnectMenu';
import { NODE_DEFS } from './nodeRegistry';

// Options as produced by nodesAcceptingType('image').
const options = [
  { def: NODE_DEFS['image-generator'], handleId: 'image' },
  { def: NODE_DEFS['video-generator'], handleId: 'image' },
];

describe('ConnectMenu (drag-to-empty picker)', () => {
  it('lists the connectable node types with a search box', () => {
    render(<ConnectMenu x={100} y={100} options={options} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
    expect(screen.getByText('Image Generator')).toBeInTheDocument();
    expect(screen.getByText('Video Generator')).toBeInTheDocument();
  });

  it('picking an option returns it (to create + connect)', () => {
    const onPick = vi.fn();
    render(<ConnectMenu x={100} y={100} options={options} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Add Video Generator'));
    expect(onPick).toHaveBeenCalledWith(options[1]);
  });

  it('search narrows the options', () => {
    render(<ConnectMenu x={100} y={100} options={options} onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'video' } });
    expect(screen.getByText('Video Generator')).toBeInTheDocument();
    expect(screen.queryByText('Image Generator')).not.toBeInTheDocument();
  });
});
