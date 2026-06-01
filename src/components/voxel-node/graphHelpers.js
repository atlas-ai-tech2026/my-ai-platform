// Voxel Node — graph helpers: node-def lookup + connection validation
// (type-safety + no cycles / self-loops).
import { getNodeDef as _getNodeDef } from './nodeRegistry';
import { canConnect } from './dataTypes';

export const getNodeDef = _getNodeDef;

// Returns the data type of an output port (by handle id) on a node.
function outputType(node, handleId) {
  const def = getNodeDef(node?.data?.nodeType);
  if (!def) return null;
  const port = def.outputs.find((p) => p.id === handleId) || def.outputs[0];
  return port?.type || null;
}

// Returns the data type of an input port (by handle id) on a node.
function inputType(node, handleId) {
  const def = getNodeDef(node?.data?.nodeType);
  if (!def) return null;
  const port = def.inputs.find((p) => p.id === handleId) || def.inputs[0];
  return port?.type || null;
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

// Full connection validity check for store.onConnect.
export function canConnectPorts(nodes, edges, conn) {
  const { source, target, sourceHandle, targetHandle } = conn;
  if (!source || !target) return false;
  if (source === target) return false; // no self-loops

  const srcNode = nodes.find((n) => n.id === source);
  const dstNode = nodes.find((n) => n.id === target);
  if (!srcNode || !dstNode) return false;

  // Type-safe snap: source output type must equal target input type.
  if (!canConnect(outputType(srcNode, sourceHandle), inputType(dstNode, targetHandle))) {
    return false;
  }

  // No cycles: adding source→target must not create a loop, i.e. target
  // must not already reach source.
  if (reaches(edges, target, source)) return false;

  // Single-connection inputs: replace handled by React Flow; here we just
  // prevent a duplicate identical edge.
  if (edges.some((e) => e.target === target && e.targetHandle === targetHandle)) {
    return false;
  }
  return true;
}
