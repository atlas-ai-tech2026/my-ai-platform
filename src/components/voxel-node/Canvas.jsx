// Voxel Node — the React Flow canvas. Dotted grid on near-black, red
// minimap viewport, type-colored animated edges. Higgsfield-style docks:
// a Spotlight quick-add palette (+ / Space / "/"), a bottom-center tool
// dock, and a left zoom/undo dock.
import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, MiniMap, ReactFlowProvider, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus, MousePointer2, Hand, Type, StickyNote, MessageCircle,
  Undo2, Redo2, Maximize, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useNodeStore } from './store';
import VoxelNode from './Nodes/VoxelNode';
import { typeColor } from './dataTypes';
import { getNodeDef } from './nodeRegistry';
import Spotlight from './Spotlight';

const nodeTypes = { voxelNode: VoxelNode };

function CanvasInner() {
  const nodes = useNodeStore((s) => s.nodes);
  const edges = useNodeStore((s) => s.edges);
  const onNodesChange = useNodeStore((s) => s.onNodesChange);
  const onEdgesChange = useNodeStore((s) => s.onEdgesChange);
  const onConnect = useNodeStore((s) => s.onConnect);
  const addNode = useNodeStore((s) => s.addNode);
  const undo = useNodeStore((s) => s.undo);
  const redo = useNodeStore((s) => s.redo);
  const canUndo = useNodeStore((s) => s.past.length > 0);
  const canRedo = useNodeStore((s) => s.future.length > 0);

  const { zoomIn, zoomOut, fitView, screenToFlowPosition } = useReactFlow();
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const lastPointer = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  // Track the cursor so a newly-added node lands where the user is looking.
  const onPaneMouseMove = useCallback((e) => {
    lastPointer.current = { x: e.clientX, y: e.clientY };
  }, []);

  const placeNode = useCallback((type) => {
    let position;
    try {
      position = screenToFlowPosition(lastPointer.current);
    } catch {
      position = undefined;
    }
    addNode(type, position);
  }, [addNode, screenToFlowPosition]);

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

  // Keyboard: Space or "/" opens Spotlight; Cmd/Ctrl+Z / Shift+Z undo/redo.
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
      if (typing) return;
      if (e.key === '/' || (e.code === 'Space' && !spotlightOpen)) {
        e.preventDefault();
        setSpotlightOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spotlightOpen, undo, redo]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0F0F0F' }} onMouseMove={onPaneMouseMove}>
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
        <MiniMap
          pannable zoomable
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8 }}
          maskColor="rgba(0,0,0,0.6)"
          nodeColor="#E31C1C"
        />
      </ReactFlow>

      {/* Left dock — undo / redo / fit / zoom */}
      <div style={dockStyle({ left: 16, top: '50%', transform: 'translateY(-50%)', flexDirection: 'column' })}>
        <DockBtn icon={Undo2} title="Undo (⌘Z)" onClick={undo} disabled={!canUndo} />
        <DockBtn icon={Redo2} title="Redo (⌘⇧Z)" onClick={redo} disabled={!canRedo} />
        <Divider horizontal />
        <DockBtn icon={Maximize} title="Fit to screen" onClick={() => fitView({ duration: 300 })} />
        <DockBtn icon={ZoomIn} title="Zoom in" onClick={() => zoomIn({ duration: 200 })} />
        <DockBtn icon={ZoomOut} title="Zoom out" onClick={() => zoomOut({ duration: 200 })} />
      </div>

      {/* Bottom-center tool dock */}
      <div style={dockStyle({ bottom: 20, left: '50%', transform: 'translateX(-50%)', flexDirection: 'row' })}>
        <DockBtn icon={MousePointer2} title="Select (V)" active />
        <DockBtn icon={Hand} title="Pan (H)" />
        <Divider />
        <DockBtn icon={Type} title="Add Text" onClick={() => placeNode('text')} />
        <DockBtn icon={StickyNote} title="Add Sticky Note" onClick={() => placeNode('sticky-note')} />
        <DockBtn icon={MessageCircle} title="Comment (soon)" disabled />
        <Divider />
        <button
          onClick={() => setSpotlightOpen((v) => !v)}
          title="Add node (Space)"
          style={{
            width: 38, height: 38, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #FF2A2A, #B30F0F)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(227,28,28,0.4)',
          }}
        >
          <Plus style={{ width: 20, height: 20 }} />
        </button>
      </div>

      <Spotlight open={spotlightOpen} onClose={() => setSpotlightOpen(false)} onPick={placeNode} />
    </div>
  );
}

function dockStyle(pos) {
  return {
    position: 'absolute', zIndex: 10, display: 'flex', alignItems: 'center', gap: 4,
    background: 'rgba(20,20,20,0.92)', backdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 6,
    ...pos,
  };
}

function DockBtn({ icon: Icon, title, onClick, active, disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 38, height: 38, borderRadius: 10, border: 'none',
        background: active ? 'rgba(227,28,28,0.18)' : 'transparent',
        color: disabled ? 'rgba(255,255,255,0.25)' : active ? '#FF5454' : '#CCCCCC',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon style={{ width: 18, height: 18 }} />
    </button>
  );
}

function Divider({ horizontal }) {
  return horizontal
    ? <div style={{ height: 1, width: '70%', background: 'rgba(255,255,255,0.12)', margin: '2px auto' }} />
    : <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', margin: '0 2px' }} />;
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
