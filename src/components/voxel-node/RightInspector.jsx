// Voxel Node — right inspector panel (spec §11). Slides in when a single
// node is selected, mirroring the Higgsfield reference: prompt, model,
// aspect ratio, resolution, batch size + a big Regenerate button.
// Glass/transparent surface on near-black.
import React from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { useNodeStore } from './store';
import { getNodeDef } from './nodeRegistry';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'];
const RESOLUTIONS = ['1K', '2K', '4K'];
const VIDEO_DURATIONS = ['5', '10'];

const panel = {
  position: 'absolute', top: 12, right: 12, bottom: 12, width: 320, zIndex: 20,
  background: 'rgba(20,20,20,0.72)',
  backdropFilter: 'blur(36px) saturate(1.4)', WebkitBackdropFilter: 'blur(36px) saturate(1.4)',
  border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16,
  boxShadow: '0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  fontFamily: '"DM Sans", sans-serif',
};

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontSize: 13, color: '#CCCCCC' }}>{label}</span>
      {children}
    </div>
  );
}

const chip = {
  background: '#1A1A1A', color: '#fff', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8, fontSize: 12, padding: '5px 10px', outline: 'none', cursor: 'pointer',
};

export default function RightInspector() {
  const nodes = useNodeStore((s) => s.nodes);
  const updateNodeSettings = useNodeStore((s) => s.updateNodeSettings);
  const clearSelection = useNodeStore((s) => s.clearSelection);
  const runNode = useNodeStore((s) => s.runNode);

  // Show only when exactly one node is selected.
  const selected = nodes.filter((n) => n.selected);
  if (selected.length !== 1) return null;

  const node = selected[0];
  const def = getNodeDef(node.data?.nodeType);
  if (!def) return null;

  const settings = node.data?.settings || {};
  const isRunning = node.data?.status === 'running';
  const isVideo = def.type === 'video-generator';
  const isText = def.type === 'text';
  const set = (patch) => updateNodeSettings(node.id, patch);

  return (
    <div style={panel}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', flex: 1 }}>{def.label}</span>
        <button onClick={clearSelection} className="nodrag" style={{ background: 'none', border: 'none', color: '#878787', cursor: 'pointer', display: 'flex' }}>
          <X style={{ width: 16, height: 16 }} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {/* Prompt */}
        <textarea
          value={isText ? (settings.value || '') : (settings.prompt || '')}
          onChange={(e) => set(isText ? { value: e.target.value } : { prompt: e.target.value })}
          placeholder={isText ? 'Type your text…' : 'Describe what to generate…'}
          className="nodrag"
          style={{
            width: '100%', minHeight: 84, resize: 'vertical',
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13,
            fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
          }}
        />

        {!isText && (
          <>
            {Array.isArray(def.models) && (
              <Row label="Model">
                <select value={settings.model || def.models[0]} onChange={(e) => set({ model: e.target.value })} className="nodrag" style={chip}>
                  {def.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Row>
            )}

            <Row label="Aspect Ratio">
              <select value={settings.aspect_ratio || (isVideo ? '16:9' : '1:1')} onChange={(e) => set({ aspect_ratio: e.target.value })} className="nodrag" style={chip}>
                {ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Row>

            {isVideo ? (
              <Row label="Duration">
                <select value={String(settings.duration || 5)} onChange={(e) => set({ duration: Number(e.target.value) })} className="nodrag" style={chip}>
                  {VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
              </Row>
            ) : (
              <Row label="Resolution">
                <select value={settings.quality || '1K'} onChange={(e) => set({ quality: e.target.value })} className="nodrag" style={chip}>
                  {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Row>
            )}
          </>
        )}
      </div>

      {/* Regenerate */}
      {def.runnable && (
        <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => runNode(node.id)}
            disabled={isRunning}
            className="nodrag"
            style={{
              width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: isRunning ? 'rgba(227,28,28,0.5)' : 'linear-gradient(135deg, #FF2A2A, #B30F0F)',
              color: '#fff', border: 'none', borderRadius: 12, padding: '13px 16px',
              fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              cursor: isRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              boxShadow: isRunning ? 'none' : '0 8px 24px rgba(227,28,28,0.4)',
            }}
          >
            {isRunning
              ? <Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} />
              : <Sparkles style={{ width: 15, height: 15 }} />}
            {isRunning ? 'Generating…' : `Regenerate · ✦${def.cost ?? 1}`}
          </button>
        </div>
      )}
    </div>
  );
}
