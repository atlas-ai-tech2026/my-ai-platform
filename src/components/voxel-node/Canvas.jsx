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
import { toast } from 'sonner';
import { useNodeStore } from './store';
import { nodeApi } from './api';
import VoxelNode from './Nodes/VoxelNode';
import VoxelEdge from './Nodes/VoxelEdge';
import ConnectionLine from './Nodes/ConnectionLine';
import { typeColor } from './dataTypes';
import { getNodeDef, validateConnection, getPort, nodesAcceptingType, nodesProducingType } from './graphHelpers';
import Spotlight from './Spotlight';
import NodePanel from './NodePanel';
import ConnectMenu from './ConnectMenu';
import './canvas.css';

const nodeTypes = { voxelNode: VoxelNode };
const edgeTypes = { voxelEdge: VoxelEdge };

function CanvasInner() {
  const nodes = useNodeStore((s) => s.nodes);
  const edges = useNodeStore((s) => s.edges);
  const onNodesChange = useNodeStore((s) => s.onNodesChange);
  const onEdgesChange = useNodeStore((s) => s.onEdgesChange);
  const onConnect = useNodeStore((s) => s.onConnect);
  const setConnectingFrom = useNodeStore((s) => s.setConnectingFrom);
  const setConnectionError = useNodeStore((s) => s.setConnectionError);
  const clearConnectionError = useNodeStore((s) => s.clearConnectionError);
  const cancelPending = useNodeStore((s) => s.cancelPending);
  const addNode = useNodeStore((s) => s.addNode);
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const undo = useNodeStore((s) => s.undo);
  const redo = useNodeStore((s) => s.redo);
  const canUndo = useNodeStore((s) => s.past.length > 0);
  const canRedo = useNodeStore((s) => s.future.length > 0);

  const { zoomIn, zoomOut, fitView, screenToFlowPosition } = useReactFlow();
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  // "Drag a line to empty canvas → pick a node" menu.
  const [connectMenu, setConnectMenu] = useState(null); // { x, y, flowPos, origin, options }
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

  // Add a node from the left panel — near the middle of the viewport, with a
  // small cascading offset so repeated adds don't stack exactly on top.
  const addCount = useRef(0);
  const addAtCenter = useCallback((type) => {
    let position;
    const k = addCount.current++ % 6;
    try {
      position = screenToFlowPosition({
        x: window.innerWidth / 2 + k * 34,
        y: window.innerHeight / 2 + k * 30,
      });
    } catch {
      position = undefined;
    }
    addNode(type, position);
  }, [addNode, screenToFlowPosition]);

  // Upload an image file → create an Image node holding its URL. Used by the
  // panel's Upload button and by drag-drop / paste onto the canvas.
  const uploadImage = useCallback(async (file, screenPos) => {
    if (!file || !file.type?.startsWith('image/')) {
      toast.error('Please choose an image file (PNG, JPG, or WebP).');
      return;
    }
    let position;
    try { position = screenToFlowPosition(screenPos || lastPointer.current); } catch { position = undefined; }
    const id = addNode('image', position);
    updateNodeData(id, { status: 'uploading' });
    try {
      const { url } = await nodeApi.uploadFile(file);
      updateNodeData(id, { settings: { url, fileName: file.name }, outputs: { image: url }, status: 'idle' });
    } catch (err) {
      updateNodeData(id, { status: 'failed', error: err.message || 'Upload failed' });
      toast.error(`Upload failed: ${err.message || 'unknown error'}`);
    }
  }, [addNode, updateNodeData, screenToFlowPosition]);

  // Drag-and-drop: a file → image node; a panel chip → that node type.
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const pos = { x: e.clientX, y: e.clientY };
    const file = e.dataTransfer?.files?.[0];
    if (file) { uploadImage(file, pos); return; }
    const type = e.dataTransfer?.getData('application/voxel-node');
    if (type) {
      let position; try { position = screenToFlowPosition(pos); } catch { position = undefined; }
      addNode(type, position);
    }
  }, [uploadImage, addNode, screenToFlowPosition]);

  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);

  // Color each edge by its SOURCE PORT's data type (handle-aware, so a node
  // with multiple outputs still colors correctly).
  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        const src = nodes.find((n) => n.id === e.source);
        const def = getNodeDef(src?.data?.nodeType);
        const port = def?.outputs?.find((p) => p.id === e.sourceHandle) || def?.outputs?.[0];
        return {
          ...e,
          type: 'voxelEdge',
          animated: true,
          style: { stroke: typeColor(port?.type), strokeWidth: 2 },
        };
      }),
    [edges, nodes]
  );

  // Validity used by React Flow during a drag (green/red + only connects
  // when true). Same rule the store re-checks on commit.
  const isValidConnection = useCallback(
    (conn) => validateConnection(nodes, edges, conn).ok,
    [nodes, edges]
  );

  // Track the originating port so every other port can show glow/dim.
  const onConnectStart = useCallback((_e, params) => {
    const { nodeId, handleId, handleType } = params;
    const node = nodes.find((n) => n.id === nodeId);
    const port = getPort(node, handleId, handleType === 'source' ? 'output' : 'input');
    setConnectingFrom(port);
    clearConnectionError();
  }, [nodes, setConnectingFrom, clearConnectionError]);

  // On release:
  //  • valid drop on a port → React Flow already connected (nothing to do)
  //  • invalid drop on a real port → red flash + tooltip (never silent)
  //  • drop on EMPTY canvas → open the "pick a node to build" menu, pre-filtered
  //    to node types that can connect to the port you dragged from.
  const onConnectEnd = useCallback((e, state) => {
    setConnectingFrom(null);
    if (!state || state.isValid) return;
    const fromH = state.fromHandle;
    const toH = state.toHandle;
    if (!fromH) return;

    if (toH) {
      const conn = fromH.type === 'source'
        ? { source: fromH.nodeId, sourceHandle: fromH.id, target: toH.nodeId, targetHandle: toH.id }
        : { source: toH.nodeId, sourceHandle: toH.id, target: fromH.nodeId, targetHandle: fromH.id };
      const reason = validateConnection(nodes, edges, conn).reason || "Can't connect these ports";
      setConnectionError({ nodeId: conn.target, handleId: conn.targetHandle, reason });
      return;
    }

    // Dropped on empty canvas → spawn-a-connected-node menu.
    const fromNode = nodes.find((n) => n.id === fromH.nodeId);
    const dir = fromH.type === 'source' ? 'output' : 'input';
    const port = getPort(fromNode, fromH.id, dir);
    if (!port) return;
    const pt = { x: e.clientX ?? e.changedTouches?.[0]?.clientX ?? 0, y: e.clientY ?? e.changedTouches?.[0]?.clientY ?? 0 };
    let flowPos; try { flowPos = screenToFlowPosition(pt); } catch { flowPos = undefined; }
    const options = dir === 'output' ? nodesAcceptingType(port.dataType) : nodesProducingType(port.dataType);
    if (options.length === 0) return;
    setConnectMenu({ x: pt.x, y: pt.y, flowPos, origin: { nodeId: fromH.nodeId, handleId: fromH.id, direction: dir }, options });
  }, [nodes, edges, setConnectingFrom, setConnectionError, screenToFlowPosition]);

  // Pick from the connect menu → create the node and wire it up.
  const onConnectMenuPick = useCallback((opt) => {
    if (!connectMenu) return;
    const { origin, flowPos } = connectMenu;
    const id = addNode(opt.def.type, flowPos);
    if (id) {
      if (origin.direction === 'output') {
        onConnect({ source: origin.nodeId, sourceHandle: origin.handleId, target: id, targetHandle: opt.handleId });
      } else {
        onConnect({ source: id, sourceHandle: opt.handleId, target: origin.nodeId, targetHandle: origin.handleId });
      }
    }
    setConnectMenu(null);
  }, [connectMenu, addNode, onConnect]);

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
      } else if (e.key === 'Escape') {
        cancelPending();
        clearConnectionError();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spotlightOpen, undo, redo, cancelPending, clearConnectionError]);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0F0F0F' }} onMouseMove={onPaneMouseMove} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionLineComponent={ConnectionLine}
        connectionRadius={30}
        onPaneClick={() => { cancelPending(); clearConnectionError(); }}
        onPaneContextMenu={(e) => { e.preventDefault(); setSpotlightOpen(true); }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'voxelEdge' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(255,255,255,0.12)" />
        <MiniMap
          pannable zoomable
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8 }}
          maskColor="rgba(0,0,0,0.6)"
          nodeColor="#E31C1C"
        />
      </ReactFlow>

      {/* Left node library (always visible) */}
      <NodePanel onAdd={addAtCenter} onUpload={uploadImage} />

      {/* Empty-canvas guidance */}
      {nodes.length === 0 && (
        <div style={{
          position: 'absolute', top: '50%', left: 'calc(50% + 124px)', transform: 'translate(-50%, -50%)',
          textAlign: 'center', pointerEvents: 'none', fontFamily: '"DM Sans", sans-serif', maxWidth: 360,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Start your canvas</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
            Pick a node from the left, drag an image anywhere onto the canvas,
            or press <b style={{ color: '#fff' }}>Space</b> / <b style={{ color: '#fff' }}>/</b> for Spotlight.
          </div>
        </div>
      )}

      {/* Single bottom toolbar — view controls + tools + add (nothing floats
          over the canvas/nodes anymore). */}
      <div style={dockStyle({ bottom: 20, left: '50%', transform: 'translateX(-50%)', flexDirection: 'row' })}>
        <DockBtn icon={Undo2} title="Undo (⌘Z)" onClick={undo} disabled={!canUndo} />
        <DockBtn icon={Redo2} title="Redo (⌘⇧Z)" onClick={redo} disabled={!canRedo} />
        <Divider />
        <DockBtn icon={ZoomOut} title="Zoom out" onClick={() => zoomOut({ duration: 200 })} />
        <DockBtn icon={ZoomIn} title="Zoom in" onClick={() => zoomIn({ duration: 200 })} />
        <DockBtn icon={Maximize} title="Fit to screen" onClick={() => fitView({ duration: 300 })} />
        <Divider />
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

      {connectMenu && (
        <ConnectMenu
          x={connectMenu.x}
          y={connectMenu.y}
          options={connectMenu.options}
          onPick={onConnectMenuPick}
          onClose={() => setConnectMenu(null)}
        />
      )}
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
