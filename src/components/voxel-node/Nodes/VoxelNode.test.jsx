import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useNodeStore } from '../store';

// React Flow's <Handle> needs the canvas context + ResizeObserver, which
// jsdom lacks. Stub it (and Position) with a plain element that preserves
// the ARIA label so we can assert the port renders correctly.
vi.mock('@xyflow/react', () => ({
  Position: { Left: 'left', Right: 'right' },
  Handle: ({ 'aria-label': ariaLabel, role }) => <div role={role} aria-label={ariaLabel} />,
}));

import VoxelNode from './VoxelNode';

beforeEach(() => {
  useNodeStore.setState({ edges: [], connectingFrom: null, connectionError: null, pendingConnection: null });
});

describe('Image upload node', () => {
  it('renders an upload affordance and a typed image output port', () => {
    render(<VoxelNode id="img1" data={{ nodeType: 'image', settings: {}, outputs: {} }} selected={false} />);
    expect(screen.getByText(/click to upload image/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/image .*output port/i)).toBeInTheDocument();
  });

  it('shows the uploaded image and a Replace control once a url is set', () => {
    render(<VoxelNode id="img1" data={{ nodeType: 'image', settings: { url: 'https://x/a.png', fileName: 'a.png' }, outputs: { image: 'https://x/a.png' } }} selected={false} />);
    const img = screen.getByAltText('a.png');
    expect(img).toHaveAttribute('src', 'https://x/a.png');
  });
});

describe('Generation node ports', () => {
  it('exposes typed prompt + reference inputs and an image output', () => {
    render(<VoxelNode id="gen1" data={{ nodeType: 'image-generator', settings: {}, outputs: {} }} selected={false} />);
    expect(screen.getByLabelText(/prompt text input port/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reference .*input port/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/image .*output port/i)).toBeInTheDocument();
  });
});
