// Voxel Node — graph helpers: node-def lookup + full connection validation
// (type-safety + no cycles/self-loops + input capacity). Returns structured
// { ok, reason } so the UI can explain WHY a drop was rejected instead of
// letting the connection line silently vanish.
import { getNodeDef as _getNodeDef } from './nodeRegistry';
import { canConnect } from './dataTypes';

export const getNodeDef = _getNodeDef;

// Build a normalized port descriptor { id, nodeId, direction, dataType,
// label, multiple } for a node's handle, or null if the handle is unknown.
// `direction` is 'output' for source handles, 'input' for target handles.
export function getPort(node, handleId, direction) {
  const def = getNodeDef(node?.data?.nodeType);
  if (!def) return null;
  const list = direction === 'output' ? def.outputs : def.inputs;
  if (!list || list.length === 0) return null;
  const port = (handleId && list.find((p) => p.id === handleId)) || list[0];
  if (!port) return null;
  return {
    id: port.id,
    nodeId: node.id,
    direction,
    dataType: port.type,
    label: port.label || port.id,
    multiple: !!port.multiple,
  };
}

// Depth-first reachability — true if `from` can already reach `to`
// following existing edges (used to reject cycles).
function reaches(edges, from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return edges
    .filter((e) => e.source === from)
    .some((e) => reaches(edges, e.target, to, seen));
}

// Full connection validity check for store.onConnect + ReactFlow's
// isValidConnection. Returns { ok, reason }.
export function validateConnection(nodes, edges, conn) {
  const { source, target, sourceHandle, targetHandle } = conn;
  if (!source || !target) return { ok: false, reason: 'Incomplete connection' };
  if (source === target) return { ok: false, reason: "A node can't connect to itself" };

  const srcNode = nodes.find((n) => n.id === source);
  const dstNode = nodes.find((n) => n.id === target);
  if (!srcNode || !dstNode) return { ok: false, reason: 'Unknown node' };

  const srcPort = getPort(srcNode, sourceHandle, 'output');
  const dstPort = getPort(dstNode, targetHandle, 'input');

  // Port-level rule (direction + type compatibility) — gives the tooltip.
  const portCheck = canConnect(srcPort, dstPort);
  if (!portCheck.ok) return portCheck;

  // No cycles: adding source→target must not create a loop, i.e. target
  // must not already reach source.
  if (reaches(edges, target, source)) {
    return { ok: false, reason: 'That would create a loop' };
  }

  // Capacity: a single-connection input (multiple !== true) can't take a
  // second edge. An identical duplicate edge is always rejected.
  const existing = edges.filter((e) => e.target === target && e.targetHandle === targetHandle);
  if (existing.some((e) => e.source === source && e.sourceHandle === sourceHandle)) {
    return { ok: false, reason: 'Already connected' };
  }
  if (!dstPort.multiple && existing.length > 0) {
    return { ok: false, reason: `“${dstPort.label}” already has a connection` };
  }
  return { ok: true, reason: '' };
}

// Back-compat boolean wrapper (older call sites).
export function canConnectPorts(nodes, edges, conn) {
  return validateConnection(nodes, edges, conn).ok;
}
