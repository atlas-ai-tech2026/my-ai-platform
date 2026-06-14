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

  return (
    <div
      style={{
        width: 268,
        background: '#141414',
        border: `1px solid ${selected ? '#E31C1C' : 'rgba(255,255,255,0.14)'}`,
        borderRadius: 12,
        fontFamily: '"DM Sans", sans-serif',
        boxShadow: selected ? '0 0 0 1px #E31C1C, 0 12px 40px rgba(0,0,0,0.5)' : '0 12px 40px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}
    >
      {/* Input handles */}
      {def.inputs.map((port) => (
        <Handle
          key={`in-${port.id}`}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{ background: typeColor(port.type), width: 10, height: 10, border: '2px solid #141414' }}
        />
      ))}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Icon style={{ width: 15, height: 15, color: '#fff' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', flex: 1 }}>{def.label}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: status.fg, background: status.bg, padding: '2px 7px', borderRadius: 5 }}>
          {status.label}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: 12 }}>
        {isText ? (
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
        ) : (
          <>
            {/* Inline editable prompt — type directly on the node. A
                connected Text node still overrides this at run time. */}
            <textarea
              value={data.settings?.prompt || ''}
              onChange={(e) => updateNodeData(id, { settings: { ...data.settings, prompt: e.target.value } })}
              placeholder="Describe what you want to create…"
              className="nodrag"
              style={{
                width: '100%', minHeight: 56, resize: 'vertical', marginBottom: 10,
                background: '#1A1A1A', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8, padding: '8px 10px', color: '#fff',
                fontSize: 13, fontFamily: 'inherit', outline: 'none', lineHeight: 1.45,
              }}
            />
            {data.outputs?.video ? (
              <video
                src={data.outputs.video}
                controls autoPlay muted loop playsInline
                style={{ width: '100%', borderRadius: 8, display: 'block', background: '#1A1A1A' }}
              />
            ) : data.outputs?.image ? (
              <img
                src={data.outputs.image}
                alt="output"
                style={{ width: '100%', borderRadius: 8, display: 'block', background: '#1A1A1A' }}
              />
            ) : (
              <div style={{
                width: '100%', aspectRatio: '16/9', borderRadius: 8,
                background: '#1A1A1A', border: '1px dashed rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#878787', fontSize: 12,
              }}>
                {isRunning ? 'Generating…' : 'No output yet'}
              </div>
            )}
            {data.error && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#FF5454', lineHeight: 1.4 }}>{data.error}</div>
            )}
          </>
        )}
      </div>

      {/* Bottom bar (generator nodes): model chip · batch · settings · run */}
      {def.runnable && (
        <div style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {/* Model chip → opens the searchable ModelPicker */}
          {Array.isArray(def.models) && (
            <>
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="nodrag"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 8, padding: '6px 9px', color: '#fff', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', maxWidth: 130,
                }}
              >
                <Icon style={{ width: 13, height: 13, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {data.settings?.model || def.models[0]}
                </span>
                <ChevronDown style={{ width: 11, height: 11, flexShrink: 0, color: '#878787' }} />
              </button>
              {pickerOpen && (
                <ModelPicker
                  models={def.models}
                  value={data.settings?.model || def.models[0]}
                  onChange={(m) => updateNodeData(id, { settings: { ...data.settings, model: m } })}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </>
          )}

          <div style={{ flex: 1 }} />

          {/* Red credit/run pill */}
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
              boxShadow: isRunning ? 'none' : '0 4px 14px rgba(227,28,28,0.4)',
            }}
          >
            {isRunning
              ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />
              : <Sparkles style={{ width: 13, height: 13 }} />}
            {isRunning ? '' : `✦ ${def.cost ?? 1}`}
          </button>
        </div>
      )}

      {/* Output handles */}
      {def.outputs.map((port) => (
        <Handle
          key={`out-${port.id}`}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{ background: typeColor(port.type), width: 10, height: 10, border: '2px solid #141414' }}
        />
      ))}
    </div>
  );
}
