// Voxel Node — live connection preview that follows the cursor while
// dragging from a port. Colored by the source port's data type; turns red
// + dashed when hovering an incompatible target (connectionStatus).
import React from 'react';
import { getBezierPath } from '@xyflow/react';
import { typeColor } from '../dataTypes';
import { useNodeStore } from '../store';

export default function ConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, connectionStatus }) {
  const connectingFrom = useNodeStore((s) => s.connectingFrom);
  const baseColor = typeColor(connectingFrom?.dataType);
  const invalid = connectionStatus === 'invalid';
  const stroke = invalid ? '#FF4444' : baseColor;

  const [path] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: toX, targetY: toY, targetPosition: toPosition });

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeDasharray={invalid ? '6 4' : undefined}
        style={{ filter: `drop-shadow(0 0 4px ${stroke}aa)` }}
      />
      <circle cx={toX} cy={toY} r={4} fill={stroke} stroke="#141414" strokeWidth={1.5} />
    </g>
  );
}
