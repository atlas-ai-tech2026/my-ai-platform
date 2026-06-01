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

  // ── load / init ──────────────────────────────────────────────
  setSpace: (space) => {
    const graph = space?.graph || { nodes: [], edges: [] };
    set({
      spaceId: space.id,
      spaceName: space.name || 'Untitled Space',
      nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
      edges: Array.isArray(graph.edges) ? graph.edges : [],
    });
  },

  // ── React Flow change handlers ───────────────────────────────
  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
    get().scheduleSave();
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
    get().scheduleSave();
  },
  onConnect: (conn) => {
    // Enforce type-safe + acyclic connections before adding the edge.
    if (!canConnectPorts(get().nodes, get().edges, conn)) return;
    set({ edges: addEdge({ ...conn, type: 'default' }, get().edges) });
    get().scheduleSave();
  },

  // ── node helpers ─────────────────────────────────────────────
  addNode: (type, position) => {
    const def = getNodeDef(type);
    if (!def) return;
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

  // Resolve a node's prompt from a directly-connected text node, falling
  // back to the node's own settings.prompt.
  resolvePrompt: (nodeId) => {
    const { nodes, edges } = get();
    const incoming = edges.find((e) => e.target === nodeId);
    if (incoming) {
      const src = nodes.find((n) => n.id === incoming.source);
      if (src?.data?.nodeType === 'text') return src.data.settings?.value || '';
    }
    const self = nodes.find((n) => n.id === nodeId);
    return self?.data?.settings?.prompt || '';
  },

  // ── run a node ───────────────────────────────────────────────
  runNode: async (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const prompt = get().resolvePrompt(id);
    if (!prompt.trim()) {
      get().updateNodeData(id, { status: 'failed', error: 'Connect a Text node or type a prompt first.' });
      return { error: 'no-prompt' };
    }
    get().updateNodeData(id, { status: 'running', error: null });
    try {
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
