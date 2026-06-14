// Voxel Node — zustand graph store. Holds the React Flow nodes/edges,
// node run state, and a debounced autosave to /api/node/spaces/:id.
import { create } from 'zustand';
import { addEdge, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { nodeApi } from './api';
import { getNodeDef, canConnectPorts } from './graphHelpers';

let saveTimer = null;

export const useNodeStore = create((set, get) => ({
  spaceId: null,
  spaceName: 'Untitled Space',
  nodes: [],
  edges: [],
  saving: false,

  // ── undo / redo history ──────────────────────────────────────
  past: [],
  future: [],
  _dragging: false,
  // Snapshot the current graph onto the undo stack (call BEFORE a change).
  pushHistory: () => {
    const { nodes, edges, past } = get();
    set({
      past: [...past.slice(-49), { nodes, edges }],
      future: [],
    });
  },
  undo: () => {
    const { past, future, nodes, edges } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...future].slice(0, 50),
      nodes: prev.nodes, edges: prev.edges,
    });
    get().scheduleSave();
  },
  redo: () => {
    const { past, future, nodes, edges } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      future: future.slice(1),
      past: [...past, { nodes, edges }].slice(-50),
      nodes: next.nodes, edges: next.edges,
    });
    get().scheduleSave();
  },

  // ── load / init ──────────────────────────────────────────────
  setSpace: (space) => {
    const graph = space?.graph || { nodes: [], edges: [] };
    set({
      spaceId: space.id,
      spaceName: space.name || 'Untitled Space',
      nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
      edges: Array.isArray(graph.edges) ? graph.edges : [],
      past: [], future: [],
    });
  },

  // ── React Flow change handlers ───────────────────────────────
  onNodesChange: (changes) => {
    // Snapshot before a removal, or at the start of a drag, so undo can
    // restore the pre-change graph (but not on every pixel of a drag).
    const hasRemove = changes.some((c) => c.type === 'remove');
    const dragStart = changes.some((c) => c.type === 'position' && c.dragging) && !get()._dragging;
    const dragEnd = changes.some((c) => c.type === 'position' && c.dragging === false);
    if (hasRemove || dragStart) get().pushHistory();
    if (dragStart) set({ _dragging: true });
    if (dragEnd) set({ _dragging: false });
    set({ nodes: applyNodeChanges(changes, get().nodes) });
    get().scheduleSave();
  },
  onEdgesChange: (changes) => {
    if (changes.some((c) => c.type === 'remove')) get().pushHistory();
    set({ edges: applyEdgeChanges(changes, get().edges) });
    get().scheduleSave();
  },
  onConnect: (conn) => {
    // Enforce type-safe + acyclic connections before adding the edge.
    if (!canConnectPorts(get().nodes, get().edges, conn)) return;
    get().pushHistory();
    set({ edges: addEdge({ ...conn, type: 'default' }, get().edges) });
    get().scheduleSave();
  },

  // ── node helpers ─────────────────────────────────────────────
  addNode: (type, position) => {
    const def = getNodeDef(type);
    if (!def) return;
    get().pushHistory();
    const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const node = {
      id,
      type: 'voxelNode',
      position: position || { x: 120 + Math.random() * 200, y: 120 + Math.random() * 160 },
      data: {
        nodeType: type,
        settings: { ...def.defaultSettings },
        status: 'idle',
        outputs: {},
      },
    };
    set({ nodes: [...get().nodes, node] });
    get().scheduleSave();
    return id;
  },

  updateNodeData: (id, patch) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    });
    get().scheduleSave();
  },

  // Merge a patch into a node's settings (convenience for the inspector).
  updateNodeSettings: (id, settingsPatch) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, settings: { ...n.data.settings, ...settingsPatch } } }
          : n
      ),
    });
    get().scheduleSave();
  },

  // Clear React Flow selection (used by the inspector's close button).
  clearSelection: () => {
    set({ nodes: get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) });
  },

  // Resolve a node's prompt from any directly-connected text node, falling
  // back to the node's own settings.prompt.
  resolvePrompt: (nodeId) => {
    const { nodes, edges } = get();
    const incoming = edges.filter((e) => e.target === nodeId);
    for (const e of incoming) {
      const src = nodes.find((n) => n.id === e.source);
      if (src?.data?.nodeType === 'text') return src.data.settings?.value || '';
    }
    const self = nodes.find((n) => n.id === nodeId);
    return self?.data?.settings?.prompt || '';
  },

  // Resolve an upstream image output connected to this node (used by the
  // Video Generator as a start frame → triggers image-to-video).
  resolveImageInput: (nodeId) => {
    const { nodes, edges } = get();
    const incoming = edges.filter((e) => e.target === nodeId);
    for (const e of incoming) {
      const src = nodes.find((n) => n.id === e.source);
      const url = src?.data?.outputs?.image;
      if (url) return url;
    }
    return null;
  },

  // ── run a node (sync image, or async video via submit+poll) ──
  runNode: async (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const def = getNodeDef(node.data.nodeType);
    const prompt = get().resolvePrompt(id);
    const imageUrl = get().resolveImageInput(id);

    // Video can run from an image alone (i2v); image needs a prompt.
    if (!prompt.trim() && !imageUrl) {
      get().updateNodeData(id, { status: 'failed', error: 'Connect a Text node (or an Image) first.' });
      return { error: 'no-input' };
    }
    get().updateNodeData(id, { status: 'running', error: null });

    try {
      if (def?.async) {
        // Async: submit to the queue, then poll until terminal.
        const { job_id, model_id } = await nodeApi.runNodeAsync(node.data.nodeType, {
          ...node.data.settings,
          prompt,
          ...(imageUrl ? { image_url: imageUrl } : {}),
        });
        const url = await get().pollVideo(id, job_id, model_id);
        if (!url) {
          get().updateNodeData(id, { status: 'failed', error: 'Video generation failed.' });
          return { error: 'video-failed' };
        }
        get().updateNodeData(id, { status: 'completed', outputs: { video: url }, error: null });
        return { outputs: { video: url } };
      }
      // Sync (image).
      const { outputs } = await nodeApi.runNode(node.data.nodeType, {
        ...node.data.settings,
        prompt,
      });
      get().updateNodeData(id, { status: 'completed', outputs, error: null });
      return { outputs };
    } catch (err) {
      get().updateNodeData(id, { status: 'failed', error: err.message });
      return { error: err.message };
    }
  },

  // Poll the FAL job until COMPLETED/FAILED. Returns the video URL or null.
  // Caps at ~5 min (60 × 5s) so a stuck job doesn't poll forever.
  pollVideo: async (nodeId, jobId, modelId) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      let s;
      try {
        s = await nodeApi.videoStatus(jobId, modelId);
      } catch {
        continue; // transient; keep polling
      }
      if (s.status === 'COMPLETED') return s.video_url || null;
      if (s.status === 'FAILED' || s.status === 'ERROR') return null;
    }
    return null;
  },

  // ── debounced autosave ───────────────────────────────────────
  scheduleSave: () => {
    const { spaceId } = get();
    if (!spaceId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const { spaceId: id, spaceName, nodes, edges } = get();
      if (!id) return;
      set({ saving: true });
      try {
        await nodeApi.saveSpace(id, { graph: { nodes, edges }, name: spaceName });
      } catch {
        // best-effort; next change retries
      } finally {
        set({ saving: false });
      }
    }, 800);
  },

  setSpaceName: (name) => {
    set({ spaceName: name });
    get().scheduleSave();
  },

  // ── run the whole workflow ───────────────────────────────────
  // Topologically order the runnable nodes (so upstream nodes finish
  // before downstream ones) and run them sequentially. Client-orchestrated
  // — reuses runNode + the existing /api/node/run-node route, no queue
  // infra. Returns counts for the caller's toast.
  workflowRunning: false,
  runWorkflow: async () => {
    if (get().workflowRunning) return;
    const { nodes, edges } = get();
    const order = topoSort(nodes, edges);
    const runnable = order.filter((n) => {
      const def = getNodeDef(n.data?.nodeType);
      return def?.runnable;
    });
    if (runnable.length === 0) return { ran: 0, failed: 0 };
    set({ workflowRunning: true });
    let ran = 0, failed = 0;
    try {
      for (const node of runnable) {
        const res = await get().runNode(node.id);
        if (res?.error) failed++; else ran++;
      }
    } finally {
      set({ workflowRunning: false });
    }
    return { ran, failed };
  },
}));

// Kahn's algorithm — returns nodes in dependency order (sources first).
// Falls back to original order for any nodes left by a cycle (which the
// onConnect guard already prevents).
function topoSort(nodes, edges) {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => {
    if (!adj.has(e.source) || !indeg.has(e.target)) return;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  });
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  while (queue.length) {
    const id = queue.shift();
    out.push(byId.get(id));
    (adj.get(id) || []).forEach((t) => {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    });
  }
  // Append any stragglers (shouldn't happen — cycles are blocked).
  if (out.length < nodes.length) {
    nodes.forEach((n) => { if (!out.includes(n)) out.push(n); });
  }
  return out;
}
