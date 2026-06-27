// Voxel Node — type-colored, deletable edge. Smooth bezier; a hover ✕
// (revealed on hover via .vx-edge-wrap:hover) removes the connection.
import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { useNodeStore } from '../store';

export default function VoxelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, selected }) {
  const removeEdge = useNodeStore((s) => s.removeEdge);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <g className="vx-edge-wrap">
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, strokeWidth: selected ? 3 : style?.strokeWidth || 2 }}
      />
      {/* Wide invisible hit area so hovering the thin edge is forgiving. */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={18} style={{ pointerEvents: 'stroke' }} />
      <EdgeLabelRenderer>
        <button
          className="vx-edge-delete"
          title="Delete connection"
          aria-label="Delete connection"
          onClick={(e) => { e.stopPropagation(); removeEdge(id); }}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          ✕
        </button>
      </EdgeLabelRenderer>
    </g>
  );
}
