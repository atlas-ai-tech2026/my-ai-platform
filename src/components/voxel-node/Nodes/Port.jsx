// Voxel Node — a single typed port, rendered as an icon BADGE (image / text /
// video / audio) like Higgsfield/Freepik, not a bare dot. Wraps React Flow's
// <Handle> so connection mechanics stay native, and adds the polish:
//   • icon + color encode the data type; grows on hover
//   • during a drag, valid targets glow and invalid ones dim
//   • an invalid drop flashes the port red and shows a reason tooltip
//   • click-to-connect fallback; empty-input "Connect …" hint; ARIA
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { ImageUp, ImageDown, Type, Video as VideoIcon, Music, Square, Hash } from 'lucide-react';
import { typeColor } from '../dataTypes';
import { portConnectable } from '../graphHelpers';
import { useNodeStore } from '../store';

// Direction-aware icons (image-out vs image-in) so a port reads at a glance,
// matching the Higgsfield/Freepik connector style.
function iconFor(type, direction) {
  if (type === 'image' || type === 'reference') return direction === 'output' ? ImageUp : ImageDown;
  if (type === 'video') return VideoIcon;
  if (type === 'audio') return Music;
  if (type === 'text') return Type;
  if (type === 'number') return Hash;
  return Square;
}

export default function Port({ node, port, direction, offsetTop, filled }) {
  const isInput = direction === 'input';
  const color = typeColor(port.type);
  const Icon = iconFor(port.type, direction);

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

  const showHint = errored || (isInput && connecting && !filled);

  const onActivate = (e) => { e.stopPropagation(); clickPort(node, port.id, direction); };

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
          port.multiple ? ' (accepts multiple)' : ''
        }${isValidTarget ? ', compatible' : isInvalidTarget ? ', incompatible' : ''}`}
        style={{
          top: offsetTop,
          width: 30, height: 30, borderRadius: '50%',
          background: errored ? '#ef4444' : '#2c2d31',
          border: `1.5px solid ${errored ? '#ff8a8a' : 'rgba(255,255,255,0.16)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ['--vx-port-color']: color,
        }}
      >
        <Icon style={{ width: 15, height: 15, color: '#fff', opacity: 0.92, pointerEvents: 'none' }} />
      </Handle>
      {showHint && (
        <div
          className={`vx-port-hint ${errored ? 'vx-port-hint--error' : ''}`}
          style={{
            position: 'absolute',
            top: (offsetTop ?? 0) - 6,
            [isInput ? 'right' : 'left']: 'calc(100% + 18px)',
            ['--vx-port-color']: color,
          }}
        >
          {errored ? connectionError.reason : `Connect ${(port.label || port.type).toLowerCase()}`}
        </div>
      )}
    </>
  );
}
