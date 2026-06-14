// Voxel Node — single React Flow node renderer. One component handles
// every node type, branching on data.nodeType. Matches the Voxel dark
// theme: surface #141414, border rgba(255,255,255,0.14), red selected
// ring, DM Sans. Status pills per spec §11.
import React, { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Type, Image as ImageIcon, Video as VideoIcon, StickyNote, Loader2, Sparkles, ChevronDown } from 'lucide-react';
import { getNodeDef } from '../nodeRegistry';
import { typeColor } from '../dataTypes';
import { useNodeStore } from '../store';
import ModelPicker from '../ModelPicker';

const STICKY_COLORS = ['#F5C84B', '#F39C2A', '#38C77A', '#4F8DFF', '#B57BFF', '#FF5454'];

const STATUS = {
  idle:      { label: 'Idle',      bg: 'rgba(135,135,135,0.18)', fg: '#9a9a9a' },
  running:   { label: 'Running',   bg: 'rgba(79,141,255,0.18)',  fg: '#4F8DFF' },
  completed: { label: 'Completed', bg: 'rgba(56,199,122,0.18)',  fg: '#38C77A' },
  failed:    { label: 'Failed',    bg: 'rgba(255,84,84,0.18)',   fg: '#FF5454' },
};

const ICONS = { Type, Image: ImageIcon, Video: VideoIcon, StickyNote };

export default function VoxelNode({ id, data, selected }) {
  const def = getNodeDef(data.nodeType);
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const runNode = useNodeStore((s) => s.runNode);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [hovered, setHovered] = useState(false);
  if (!def) return null;

  // ── Sticky Note: pure annotation node (no ports, no run) ──────
  if (def.type === 'sticky-note') {
    const color = data.settings?.color || '#F5C84B';
    return (
      <div style={{
        width: 220, minHeight: 160, background: color, borderRadius: 6,
        border: selected ? '2px solid #fff' : '2px solid rgba(0,0,0,0.1)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)', padding: 12,
        fontFamily: '"DM Sans", sans-serif', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div className="nodrag" style={{ display: 'flex', gap: 5 }}>
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => updateNodeData(id, { settings: { ...data.settings, color: c } })}
              style={{
                width: 14, height: 14, borderRadius: '50%', background: c, cursor: 'pointer',
                border: c === color ? '2px solid rgba(0,0,0,0.5)' : '1px solid rgba(0,0,0,0.2)',
              }}
            />
          ))}
        </div>
        <textarea
          className="nodrag"
          value={data.settings?.value || ''}
          onChange={(e) => updateNodeData(id, { settings: { ...data.settings, value: e.target.value } })}
          placeholder="Note…"
          style={{
            flex: 1, minHeight: 110, resize: 'none', border: 'none', outline: 'none',
            background: 'transparent', color: '#1a1a1a', fontSize: 14, lineHeight: 1.4,
            fontFamily: 'inherit', fontWeight: 500,
          }}
        />
      </div>
    );
  }

  const Icon = ICONS[def.icon] || Type;
  const status = STATUS[data.status] || STATUS.idle;
  const isText = def.type === 'text';
  const isRunning = data.status === 'running';

  // ── Text node: simple card with a textarea ────────────────────
  if (isText) {
    return (
      <div style={{
        width: 268, background: '#141414',
        border: `1px solid ${selected ? '#E31C1C' : 'rgba(255,255,255,0.14)'}`,
        borderRadius: 12, fontFamily: '"DM Sans", sans-serif',
        boxShadow: selected ? '0 0 0 1px #E31C1C, 0 12px 40px rgba(0,0,0,0.5)' : '0 12px 40px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Icon style={{ width: 15, height: 15, color: '#fff' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', flex: 1 }}>{def.label}</span>
        </div>
        <div style={{ padding: 12 }}>
          <textarea
            value={data.settings?.value || ''}
            onChange={(e) => updateNodeData(id, { settings: { ...data.settings, value: e.target.value } })}
            placeholder="Type your prompt…"
            className="nodrag"
            style={{
              width: '100%', minHeight: 72, resize: 'vertical',
              background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '8px 10px', color: '#fff',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>
        {def.outputs.map((port) => (
          <Handle key={`out-${port.id}`} type="source" position={Position.Right} id={port.id}
            style={{ background: typeColor(port.type), width: 10, height: 10, border: '2px solid #141414' }} />
        ))}
      </div>
    );
  }

  // ── Generator node: image-first card; controls reveal on hover ─
  const hasOutput = !!(data.outputs?.image || data.outputs?.video);
  // Show the prompt + bottom bar when hovering, while running, or when
  // there's no output yet (so an empty node is always set-up-able).
  const showControls = hovered || isRunning || !hasOutput;
  const gradient = 'linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0) 22%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.7))';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPickerOpen(false); }}
      style={{
        width: 280, position: 'relative',
        background: '#141414',
        border: `1px solid ${selected ? '#E31C1C' : 'rgba(255,255,255,0.14)'}`,
        borderRadius: 14,
        fontFamily: '"DM Sans", sans-serif',
        boxShadow: selected ? '0 0 0 1px #E31C1C, 0 12px 40px rgba(0,0,0,0.5)' : '0 12px 40px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}
    >
      {/* Floating label above the card */}
      <div style={{
        position: 'absolute', top: -24, left: 2, display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, color: '#878787', fontWeight: 500,
      }}>
        <Icon style={{ width: 13, height: 13 }} /> {def.label}
      </div>

      {/* Input handles */}
      {def.inputs.map((port, i) => (
        <Handle
          key={`in-${port.id}`}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{ top: 40 + i * 26, background: typeColor(port.type), width: 11, height: 11, border: '2px solid #141414' }}
        />
      ))}

      {/* Media fills the card */}
      <div style={{ position: 'relative', minHeight: 150 }}>
        {data.outputs?.video ? (
          <video src={data.outputs.video} controls autoPlay muted loop playsInline
            style={{ width: '100%', display: 'block', background: '#1A1A1A' }} />
        ) : data.outputs?.image ? (
          <img src={data.outputs.image} alt="output"
            style={{ width: '100%', display: 'block', background: '#1A1A1A' }} />
        ) : (
          <div style={{
            width: '100%', aspectRatio: '1/1', background: '#1A1A1A',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#878787', fontSize: 12,
          }}>
            {isRunning ? 'Generating…' : 'No output yet'}
          </div>
        )}

        {/* Hover/empty overlay: gradient + prompt + bottom bar */}
        {showControls && (
          <>
            {hasOutput && (
              <div style={{ position: 'absolute', inset: 0, background: gradient, pointerEvents: 'none' }} />
            )}

            {/* Prompt (top) */}
            <textarea
              value={data.settings?.prompt || ''}
              onChange={(e) => updateNodeData(id, { settings: { ...data.settings, prompt: e.target.value } })}
              placeholder="Describe what you want to create…"
              className="nodrag"
              style={{
                position: 'absolute', top: 10, left: 10, right: 10, zIndex: 2,
                minHeight: 34, maxHeight: 90, resize: 'none',
                background: hasOutput ? 'transparent' : 'rgba(0,0,0,0.35)',
                border: hasOutput ? 'none' : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8, padding: hasOutput ? '2px 2px' : '8px 10px',
                color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                lineHeight: 1.4, textShadow: hasOutput ? '0 1px 3px rgba(0,0,0,0.7)' : 'none',
              }}
            />

            {/* Bottom bar */}
            <div style={{
              position: 'absolute', left: 10, right: 10, bottom: 10, zIndex: 2,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {Array.isArray(def.models) && (
                <button
                  onClick={(e) => { setAnchorRect(e.currentTarget.getBoundingClientRect()); setPickerOpen((v) => !v); }}
                  className="nodrag"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'rgba(20,20,20,0.7)', backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
                    padding: '6px 9px', color: '#fff', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit', maxWidth: 150,
                  }}
                >
                  <Icon style={{ width: 13, height: 13, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {data.settings?.model || def.models[0]}
                  </span>
                  <ChevronDown style={{ width: 11, height: 11, flexShrink: 0, color: '#aaa' }} />
                </button>
              )}
              {pickerOpen && (
                <ModelPicker
                  models={def.models}
                  value={data.settings?.model || def.models[0]}
                  anchorRect={anchorRect}
                  onChange={(m) => updateNodeData(id, { settings: { ...data.settings, model: m } })}
                  onClose={() => setPickerOpen(false)}
                />
              )}

              <div style={{ flex: 1 }} />

              <button
                onClick={() => runNode(id)}
                disabled={isRunning}
                className="nodrag"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: isRunning ? 'rgba(227,28,28,0.5)' : '#E31C1C',
                  color: '#fff', border: 'none', borderRadius: 999,
                  padding: '7px 14px', fontSize: 12, fontWeight: 700,
                  cursor: isRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  boxShadow: isRunning ? 'none' : '0 4px 14px rgba(227,28,28,0.5)',
                }}
              >
                {isRunning
                  ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />
                  : <Sparkles style={{ width: 13, height: 13 }} />}
                {isRunning ? '' : `✦ ${def.cost ?? 1}`}
              </button>
            </div>
          </>
        )}

        {data.error && showControls && (
          <div style={{ position: 'absolute', left: 10, right: 10, bottom: 52, zIndex: 2, fontSize: 11, color: '#FF8A8A', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            {data.error}
          </div>
        )}
      </div>

      {/* Output handles */}
      {def.outputs.map((port) => (
        <Handle
          key={`out-${port.id}`}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{ background: typeColor(port.type), width: 11, height: 11, border: '2px solid #141414' }}
        />
      ))}
    </div>
  );
}
