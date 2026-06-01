// Voxel Node — data types + wire colors + connection compatibility.
// Wire colors encode the DATA TYPE flowing through a connection (they
// are NOT brand colors). Per the Voxel Node spec §2/§7.

export const TYPE_COLORS = {
  text: '#4F8DFF',   // blue
  image: '#B57BFF',  // purple
  video: '#38C77A',  // green
  audio: '#F39C2A',  // orange
  voxel: '#E31C1C',  // Voxel red (3D/voxel-native)
  svg: '#CCCCCC',
};

export function typeColor(type) {
  return TYPE_COLORS[type] || '#878787';
}

// Output → Input only. A connection is valid when the source output type
// matches the destination input type. (No cycles / self-loops are handled
// by React Flow + the store's onConnect guard.)
export function canConnect(srcType, dstType) {
  if (!srcType || !dstType) return false;
  return srcType === dstType;
}
