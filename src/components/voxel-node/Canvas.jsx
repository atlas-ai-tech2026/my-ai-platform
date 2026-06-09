// Voxel Node — the React Flow canvas. Dotted grid on near-black, red
// minimap viewport, type-colored animated edges. Quick-add buttons for
// the two slice node types (full Spotlight palette comes later).
import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Type, Image as ImageIcon, Video as VideoIcon } from 'lucide-react';
import { useNodeStore } from './store';
import VoxelNode from './Nodes/VoxelNode';
import { typeColor } from './dataTypes';
import { getNodeDef } from './nodeRegistry';

const nodeTypes = { voxelNode: VoxelNode };

function CanvasInner() {
  const nodes = useNodeStore((s) => s.nodes);
  const edges = useNodeStore((s) => s.edges);
  const onNodesChange = useNodeStore((s) => s.onNodesChange);
  const onEdgesChange = useNodeStore((s) => s.onEdgesChange);
  const onConnect = useNodeStore((s) => s.onConnect);
  const addNode = useNodeStore((s) => s.addNode);

  // Color each edge by its source node's output type.
  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        const src = nodes.find((n) => n.id === e.source);
        const def = getNodeDef(src?.data?.nodeType);
        const t = def?.outputs?.[0]?.type;
        return { ...e, animated: true, style: { stroke: typeColor(t), strokeWidth: 2 } };
      }),
    [edges, nodes]
  );

  const handleAdd = useCallback((type) => addNode(type), [addNode]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0F0F0F' }}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'default' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(255,255,255,0.12)" />
        <Controls style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8 }} />
        <MiniMap
          pannable zoomable
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8 }}
          maskColor="rgba(0,0,0,0.6)"
          nodeColor="#E31C1C"
        />
      </ReactFlow>

      {/* Quick-add bar (slice version of Spotlight) */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 8, background: '#141414',
        border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12,
        padding: 8, fontFamily: '"DM Sans", sans-serif', zIndex: 5,
      }}>
        <AddButton icon={Type} label="Text" onClick={() => handleAdd('text')} />
        <AddButton icon={ImageIcon} label="Image Generator" onClick={() => handleAdd('image-generator')} />
        <AddButton icon={VideoIcon} label="Video Generator" onClick={() => handleAdd('video-generator')} />
      </div>
    </div>
  );
}

function AddButton({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.10)',
        color: '#fff', borderRadius: 8, padding: '8px 12px',
        fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#E31C1C')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)')}
    >
      <Plus style={{ width: 13, height: 13, color: '#E31C1C' }} />
      <Icon style={{ width: 14, height: 14 }} />
      {label}
    </button>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
