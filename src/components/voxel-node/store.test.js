import { describe, it, expect, beforeEach } from 'vitest';
import { useNodeStore } from './store';

// Interaction-level tests against the real zustand store: connecting an
// uploaded image node to a generation node, rejecting an incompatible drop
// with feedback, single-input replacement, and downstream staleness.
const seed = () => {
  useNodeStore.setState({
    spaceId: null, // disables network autosave
    nodes: [
      { id: 'img1', type: 'voxelNode', data: { nodeType: 'image', settings: { url: 'https://x/a.png' }, outputs: { image: 'https://x/a.png' } } },
      { id: 'img2', type: 'voxelNode', data: { nodeType: 'image', settings: { url: 'https://x/b.png' }, outputs: { image: 'https://x/b.png' } } },
      { id: 'vid1', type: 'voxelNode', data: { nodeType: 'video-generator', settings: {}, status: 'idle', outputs: {} } },
    ],
    edges: [],
    past: [], future: [],
    connectionError: null, pendingConnection: null, connectingFrom: null,
  });
};

beforeEach(seed);

describe('click-to-connect', () => {
  it('connects an image output to a video start-frame input', () => {
    const s = useNodeStore.getState();
    s.clickPort({ id: 'img1' }, 'image', 'output');
    expect(useNodeStore.getState().pendingConnection).toMatchObject({ nodeId: 'img1', id: 'image' });
    s.clickPort({ id: 'vid1' }, 'image', 'input');

    const { edges, pendingConnection } = useNodeStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'img1', target: 'vid1', targetHandle: 'image' });
    expect(pendingConnection).toBeNull();
  });

  it('arming from an input port does nothing (must start from an output)', () => {
    useNodeStore.getState().clickPort({ id: 'vid1' }, 'image', 'input');
    expect(useNodeStore.getState().pendingConnection).toBeNull();
  });
});

describe('onConnect feedback', () => {
  it('rejects image → text(prompt) and records a reason (no silent drop)', () => {
    useNodeStore.getState().onConnect({ source: 'img1', sourceHandle: 'image', target: 'vid1', targetHandle: 'prompt' });
    const { edges, connectionError } = useNodeStore.getState();
    expect(edges).toHaveLength(0);
    expect(connectionError).toMatchObject({ nodeId: 'vid1', handleId: 'prompt' });
    expect(connectionError.reason).toMatch(/image output → text input/i);
  });

  it('keeps multiple references on a multi-connection image input', () => {
    const s = useNodeStore.getState();
    s.onConnect({ source: 'img1', sourceHandle: 'image', target: 'vid1', targetHandle: 'image' });
    s.onConnect({ source: 'img2', sourceHandle: 'image', target: 'vid1', targetHandle: 'image' });
    const { edges } = useNodeStore.getState();
    expect(edges).toHaveLength(2); // both references kept
    expect(edges.map((e) => e.source).sort()).toEqual(['img1', 'img2']);
  });

  it('auto-replaces an existing edge on a single-connection input (prompt)', () => {
    useNodeStore.setState((st) => ({
      nodes: [
        ...st.nodes,
        { id: 'txtA', type: 'voxelNode', data: { nodeType: 'text', settings: { value: 'a' } } },
        { id: 'txtB', type: 'voxelNode', data: { nodeType: 'text', settings: { value: 'b' } } },
      ],
    }));
    const s = useNodeStore.getState();
    s.onConnect({ source: 'txtA', sourceHandle: 'text', target: 'vid1', targetHandle: 'prompt' });
    s.onConnect({ source: 'txtB', sourceHandle: 'text', target: 'vid1', targetHandle: 'prompt' });
    const promptEdges = useNodeStore.getState().edges.filter((e) => e.targetHandle === 'prompt');
    expect(promptEdges).toHaveLength(1);
    expect(promptEdges[0].source).toBe('txtB'); // replaced, not duplicated
  });
});

describe('staleness (live pipeline)', () => {
  it('marks a completed downstream node stale when an upstream edge is added', () => {
    useNodeStore.setState((st) => ({
      nodes: st.nodes.map((n) => (n.id === 'vid1' ? { ...n, data: { ...n.data, status: 'completed', outputs: { video: 'https://x/v.mp4' } } } : n)),
    }));
    useNodeStore.getState().onConnect({ source: 'img1', sourceHandle: 'image', target: 'vid1', targetHandle: 'image' });
    const vid = useNodeStore.getState().nodes.find((n) => n.id === 'vid1');
    expect(vid.data.stale).toBe(true);
  });

  it('editing an upstream node\'s settings invalidates a completed consumer', () => {
    // text → vid1(completed). Editing the text marks vid1 stale.
    useNodeStore.setState((st) => ({
      nodes: [
        ...st.nodes.map((n) => (n.id === 'vid1' ? { ...n, data: { ...n.data, status: 'completed' } } : n)),
        { id: 'txt1', type: 'voxelNode', data: { nodeType: 'text', settings: { value: 'hi' } } },
      ],
      edges: [{ id: 'e1', source: 'txt1', sourceHandle: 'text', target: 'vid1', targetHandle: 'prompt' }],
    }));
    useNodeStore.getState().updateNodeSettings('txt1', { value: 'changed' });
    const vid = useNodeStore.getState().nodes.find((n) => n.id === 'vid1');
    expect(vid.data.stale).toBe(true);
  });
});
