// Voxel Node — canvas page. Loads a space, mounts the React Flow canvas,
// renders the top bar (brand badge + editable name + save indicator).
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, Play, Loader2 } from 'lucide-react';
import Canvas from '@/components/voxel-node/Canvas';
import { useNodeStore } from '@/components/voxel-node/store';
import { nodeApi } from '@/components/voxel-node/api';

export default function NodeCanvas() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const setSpace = useNodeStore((s) => s.setSpace);
  const spaceName = useNodeStore((s) => s.spaceName);
  const setSpaceName = useNodeStore((s) => s.setSpaceName);
  const saving = useNodeStore((s) => s.saving);
  const runWorkflow = useNodeStore((s) => s.runWorkflow);
  const workflowRunning = useNodeStore((s) => s.workflowRunning);

  const handleRunWorkflow = async () => {
    const res = await runWorkflow();
    if (!res || (res.ran === 0 && res.failed === 0)) {
      toast.info('Add a runnable node (e.g. Image Generator) first.');
    } else if (res.failed === 0) {
      toast.success(`Workflow complete — ${res.ran} node${res.ran > 1 ? 's' : ''} ran.`);
    } else {
      toast.error(`Workflow finished with ${res.failed} failed, ${res.ran} ok.`);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const space = await nodeApi.getSpace(spaceId);
        if (active) { setSpace(space); setLoading(false); }
      } catch (e) {
        if (active) { setError(e.message); setLoading(false); }
        if (/401/.test(e.message)) toast.error('Please sign in to open this space.');
      }
    })();
    return () => { active = false; };
  }, [spaceId, setSpace]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0F0F0F', fontFamily: '"DM Sans", sans-serif' }}>
      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 56, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
        background: 'rgba(15,15,15,0.92)', borderBottom: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
      }}>
        <button onClick={() => navigate('/node')} style={{ background: 'none', border: 'none', color: '#878787', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft style={{ width: 18, height: 18 }} />
        </button>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#fff', background: '#E31C1C',
          padding: '3px 9px', borderRadius: 999, letterSpacing: '0.04em',
        }}>VOXEL NODE</span>
        <input
          value={spaceName}
          onChange={(e) => setSpaceName(e.target.value)}
          style={{
            background: 'transparent', border: 'none', color: '#fff',
            fontSize: 14, fontWeight: 600, outline: 'none', minWidth: 200,
          }}
        />
        <span style={{ fontSize: 11, color: '#878787', marginLeft: 'auto' }}>
          {saving ? 'Saving…' : 'Saved'}
        </span>
        <button
          onClick={handleRunWorkflow}
          disabled={workflowRunning}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: workflowRunning
              ? 'rgba(227,28,28,0.5)'
              : 'linear-gradient(135deg, #FF2A2A, #B30F0F)',
            color: '#fff', border: 'none', borderRadius: 9,
            padding: '8px 16px', fontSize: 13, fontWeight: 700,
            cursor: workflowRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            boxShadow: workflowRunning ? 'none' : '0 4px 14px rgba(227,28,28,0.4)',
          }}
        >
          {workflowRunning
            ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
            : <Play style={{ width: 14, height: 14 }} />}
          {workflowRunning ? 'Running…' : 'Run Workflow'}
        </button>
      </div>

      {/* Canvas area (below the 56px bar) */}
      <div style={{ position: 'absolute', top: 56, left: 0, right: 0, bottom: 0 }}>
        {loading ? (
          <Centered text="Loading space…" />
        ) : error ? (
          <Centered text={error} />
        ) : (
          <Canvas />
        )}
      </div>
    </div>
  );
}

function Centered({ text }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#878787', fontSize: 14 }}>
      {text}
    </div>
  );
}
