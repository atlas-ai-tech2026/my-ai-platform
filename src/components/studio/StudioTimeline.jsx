import React from 'react';
import { ChevronDown, ChevronUp, Plus, Play } from 'lucide-react';

export default function StudioTimeline({ scenes, activeSceneId, onSceneSelect, onAddScene, collapsed, onToggle }) {
  return (
    <div style={{
      height: collapsed ? 36 : 160,
      background: '#0A0A0A',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      flexShrink: 0,
      transition: 'height 0.3s ease',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Timeline header */}
      <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10, borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Timeline — {scenes?.length || 0} scenes</span>
        <div style={{ flex: 1 }} />
        <button
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(229,57,53,0.12)', border: '1px solid rgba(229,57,53,0.25)', borderRadius: 6, padding: '4px 10px', color: '#E53935', fontSize: 12, cursor: 'pointer', fontFamily: '"DM Sans", sans-serif' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(229,57,53,0.2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(229,57,53,0.12)'}
        >
          <Play size={11} /> Preview All
        </button>
        <button
          onClick={onToggle}
          style={{ width: 26, height: 26, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}
        >
          {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* Scenes strip */}
      {!collapsed && (
        <div style={{ flex: 1, overflowX: 'auto', display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 8 }} className="hide-scrollbar">
          {(scenes || []).map((scene, i) => (
            <React.Fragment key={scene.id}>
              <button
                onClick={() => onSceneSelect(scene)}
                style={{
                  flexShrink: 0, width: 96, height: 84,
                  background: '#1a1a1a',
                  border: `2px solid ${scene.id === activeSceneId ? '#E53935' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 8, cursor: 'pointer', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column',
                  transition: 'border-color 0.18s',
                  position: 'relative',
                }}
              >
                {scene.generated_output_url ? (
                  <img src={scene.generated_output_url} alt="" style={{ width: '100%', height: 60, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: 60, background: 'linear-gradient(135deg,#1a0000,#111)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 18 }}>🎬</span>
                  </div>
                )}
                <div style={{ padding: '3px 5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 600 }}>S{i + 1}</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{scene.duration_seconds || 5}s</span>
                </div>
              </button>
              {/* + between scenes */}
              <button
                onClick={onAddScene}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(229,57,53,0.15)'; e.currentTarget.style.borderColor = 'rgba(229,57,53,0.4)'; e.currentTarget.style.color = '#E53935'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
              >
                <Plus size={11} />
              </button>
            </React.Fragment>
          ))}

          {/* Add first scene */}
          <button
            onClick={onAddScene}
            style={{
              flexShrink: 0, width: 96, height: 84,
              background: 'rgba(229,57,53,0.05)',
              border: '2px dashed rgba(229,57,53,0.2)',
              borderRadius: 8, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              color: 'rgba(229,57,53,0.6)', fontSize: 11, transition: 'all 0.18s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(229,57,53,0.1)'; e.currentTarget.style.borderColor = 'rgba(229,57,53,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(229,57,53,0.05)'; e.currentTarget.style.borderColor = 'rgba(229,57,53,0.2)'; }}
          >
            <Plus size={16} />
            <span>New Scene</span>
          </button>
        </div>
      )}
    </div>
  );
}