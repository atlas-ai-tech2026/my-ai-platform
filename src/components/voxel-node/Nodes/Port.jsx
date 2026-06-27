// Voxel Node — a single typed port. Wraps React Flow's <Handle> so the
// connection mechanics stay native, but adds the polish that fixes the
// "line silently vanishes" bug:
//   • color-coded by data type, grows on hover
//   • during a drag, valid targets glow and invalid ones dim
//   • an invalid drop flashes the port red and shows a reason tooltip
//   • click-to-connect fallback (click output, then click input)
//   • empty inputs show a "Connect …" hint; ARIA labels for keyboard users
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { typeColor } from '../dataTypes';
import { portConnectable } from '../graphHelpers';
import { useNodeStore } from '../store';

export default function Port({ node, port, direction, offsetTop, filled }) {
  const isInput = direction === 'input';
  const color = typeColor(port.type);

  const connectingFrom = useNodeStore((s) => s.connectingFrom);
  const connectionError = useNodeStore((s) => s.connectionError);
  const pending = useNodeStore((s) => s.pendingConnection);
  const clickPort = useNodeStore((s) => s.clickPort);

  const me = { nodeId: node.id, id: port.id, direction, dataType: port.type, multiple: !!port.multiple };

  const origin = connectingFrom || pending;
  const connecting = !!origin;
  const isOrigin = origin && origin.nodeId === node.id && origin.id === port.id;
  const isValidTarget = connecting && !isOrigin && portConnectable(origin, me);
  const isInvalidTarget = connecting && !isOrigin && !isValidTarget;

  const errored =
    connectionError && connectionError.nodeId === node.id && connectionError.handleId === port.id;

  const cls = [
    'vx-port',
    isValidTarget && 'vx-port--glow',
    isInvalidTarget && 'vx-port--dim',
    errored && 'vx-port--error',
    isOrigin && 'vx-port--origin',
  ].filter(Boolean).join(' ');

  // Hint/label shown just outside the card. For inputs we surface the port
  // label as a "Connect …" hint while empty + connecting; the error tooltip
  // always wins.
  const showHint = errored || (isInput && connecting && !filled);

  const onActivate = (e) => {
    e.stopPropagation();
    clickPort(node, port.id, direction);
  };

  return (
    <>
      <Handle
        type={isInput ? 'target' : 'source'}
        position={isInput ? Position.Left : Position.Right}
        id={port.id}
        className={cls}
        onClick={onActivate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onActivate(e); }}
        tabIndex={0}
        role="button"
        aria-label={`${port.label || port.id} ${port.type} ${isInput ? 'input' : 'output'} port${
          isValidTarget ? ', compatible' : isInvalidTarget ? ', incompatible' : ''
        }`}
        style={{
          top: offsetTop,
          width: 13, height: 13,
          background: color,
          border: '2px solid #141414',
          // expose the type color to CSS for the glow ring
          ['--vx-port-color']: color,
        }}
      />
      {showHint && (
        <div
          className={`vx-port-hint ${errored ? 'vx-port-hint--error' : ''}`}
          style={{
            position: 'absolute',
            top: offsetTop - 9,
            [isInput ? 'right' : 'left']: 'calc(100% + 14px)',
            ['--vx-port-color']: color,
          }}
        >
          {errored ? connectionError.reason : `Connect ${(port.label || port.type).toLowerCase()}`}
        </div>
      )}
    </>
  );
}
