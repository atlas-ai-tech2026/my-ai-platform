// Voxel Node — landing page. Lists the user's Node Spaces and lets them
// create a new one. Matches the Voxel dark/red brand.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Boxes, Loader2 } from 'lucide-react';
import { nodeApi } from '@/components/voxel-node/api';
import { useAuth } from '@/lib/AuthContext';

export default function NodeLanding() {
  const navigate = useNavigate();
  const { isAuthenticated, openAuthModal } = useAuth();
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await nodeApi.listSpaces();
        if (active) setSpaces(list);
      } catch (e) {
        if (/401/.test(e.message)) {
          openAuthModal?.('login');
        } else {
          toast.error(e.message);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [openAuthModal]);

  const create = async () => {
    if (!isAuthenticated) { openAuthModal?.('login'); return; }
    setCreating(true);
    try {
      const space = await nodeApi.createSpace('Untitled Space');
      navigate(`/node/${space.id}`);
    } catch (e) {
      toast.error(e.message);
      setCreating(false);
    }
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: '#0F0F0F', color: '#fff', fontFamily: '"DM Sans", sans-serif', padding: '48px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, background: '#E31C1C', padding: '4px 10px', borderRadius: 999, letterSpacing: '0.04em' }}>VOXEL NODE</span>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: '8px 0 6px' }}>Node Spaces</h1>
        <p style={{ color: '#878787', marginBottom: 28, fontSize: 15 }}>
          Build AI workflows on an infinite canvas — connect Text, Image, Video, and Audio nodes.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {/* New space card */}
          <button
            onClick={create}
            disabled={creating}
            style={{
              height: 150, borderRadius: 14, cursor: creating ? 'wait' : 'pointer',
              background: '#141414', border: '1px dashed rgba(227,28,28,0.5)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 8, color: '#fff', fontFamily: 'inherit',
            }}
          >
            {creating
              ? <Loader2 style={{ width: 26, height: 26, color: '#E31C1C', animation: 'spin 1s linear infinite' }} />
              : <Plus style={{ width: 26, height: 26, color: '#E31C1C' }} />}
            <span style={{ fontSize: 14, fontWeight: 600 }}>New Space</span>
          </button>

          {loading ? (
            <div style={{ gridColumn: '1 / -1', color: '#878787', fontSize: 14, padding: 12 }}>Loading…</div>
          ) : (
            spaces.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/node/${s.id}`)}
                style={{
                  height: 150, borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                  background: '#141414', border: '1px solid rgba(255,255,255,0.08)',
                  padding: 16, color: '#fff', fontFamily: 'inherit',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(227,28,28,0.5)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
              >
                <Boxes style={{ width: 22, height: 22, color: '#878787' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: '#878787', marginTop: 4 }}>
                    {new Date(s.updated_at).toLocaleDateString()}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
