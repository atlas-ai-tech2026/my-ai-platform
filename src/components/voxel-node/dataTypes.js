// Voxel Node — data types + wire colors + connection compatibility.
// Wire/port colors encode the DATA TYPE flowing through a connection (they
// are NOT brand colors). Per the Voxel Node spec §2/§7.
//
// This module is the SINGLE SOURCE OF TRUTH for:
//   • PORT_COLORS  — type → color (used by ports AND edges)
//   • TYPE_COMPAT  — which output types may feed which input types
//   • canConnect() — the port-level rule (direction + type compatibility)
//
// Graph-level rules that need the whole graph (no cycles, input capacity)
// live in graphHelpers.canConnectPorts(), which calls canConnect() first.

export const PORT_COLORS = {
  text: '#4F8DFF',      // blue
  image: '#B57BFF',     // purple
  reference: '#B57BFF', // purple (an image used as a reference/start frame)
  video: '#38C77A',     // green
  audio: '#F39C2A',     // orange
  mask: '#E879F9',      // pink
  number: '#22D3EE',    // cyan
  voxel: '#E31C1C',     // Voxel red (3D/voxel-native)
  svg: '#CCCCCC',
};

// Back-compat alias — older imports referenced TYPE_COLORS.
export const TYPE_COLORS = PORT_COLORS;

export function typeColor(type) {
  return PORT_COLORS[type] || '#878787';
}

// Compatibility table: keyed by the INPUT (target) data type, listing the
// OUTPUT (source) data types it will accept. This is intentionally broader
// than strict equality — e.g. an `image` output may feed a `reference`
// input (start frame / style reference), and a `mask` input also accepts a
// plain `image`. Extend here, not at the call sites.
export const TYPE_COMPAT = {
  text: ['text'],
  image: ['image'],
  reference: ['image', 'reference'],
  video: ['video'],
  audio: ['audio'],
  mask: ['mask', 'image'],
  number: ['number'],
  voxel: ['voxel'],
  svg: ['svg'],
};

// Are two data types compatible for an output → input connection?
export function typesCompatible(srcType, dstType) {
  if (!srcType || !dstType) return false;
  const accepted = TYPE_COMPAT[dstType] || [dstType];
  return accepted.includes(srcType);
}

const TYPE_LABEL = {
  text: 'text', image: 'image', reference: 'reference', video: 'video',
  audio: 'audio', mask: 'mask', number: 'number', voxel: 'voxel', svg: 'SVG',
};
function label(t) { return TYPE_LABEL[t] || t || 'unknown'; }

/**
 * Port-level connection rule. A port is { direction:'input'|'output',
 * dataType, multiple? }. Returns { ok, reason } so the UI can show a
 * human-readable tooltip on an invalid drop (instead of the line silently
 * vanishing — the core bug this rework fixes).
 *
 * Graph-level checks (cycles, input already full) are layered on top in
 * graphHelpers.canConnectPorts().
 */
export function canConnect(sourcePort, targetPort) {
  if (!sourcePort || !targetPort) {
    return { ok: false, reason: 'Missing port' };
  }
  if (sourcePort.direction !== 'output') {
    return { ok: false, reason: 'Start a connection from an output port (right side)' };
  }
  if (targetPort.direction !== 'input') {
    return { ok: false, reason: 'Connections must end on an input port (left side)' };
  }
  if (!typesCompatible(sourcePort.dataType, targetPort.dataType)) {
    return {
      ok: false,
      reason: `Can't connect: ${label(sourcePort.dataType)} output → ${label(targetPort.dataType)} input`,
    };
  }
  return { ok: true, reason: '' };
}
