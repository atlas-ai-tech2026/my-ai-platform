import React from 'react';
import { Film, Users, Globe, Scissors, Music, FileText, FolderOpen, Settings, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

const MODULES = [
  { id: 'director',   icon: Film,       label: 'Director'   },
  { id: 'casting',    icon: Users,      label: 'Casting'    },
  { id: 'locations',  icon: Globe,      label: 'Locations'  },
  { id: 'editor',     icon: Scissors,   label: 'Editor'     },
  { id: 'audio',      icon: Music,      label: 'Audio'      },
  { id: 'script',     icon: FileText,   label: 'Script'     },
  { id: 'assets',     icon: FolderOpen, label: 'Assets'     },
  { id: 'settings',   icon: Settings,   label: 'Settings'   },
];

export default function StudioSidebar({ activeModule, onModuleChange, projects, activeProjectId, onProjectSelect, onNewProject, collapsed, onToggle }) {
  return (
    <div style={{
      width: collapsed ? 56 : 220,
      background: '#0D0D0D',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.3s ease',
      flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Toggle button */}
      <div style={{ display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end', padding: '8px 8px 0 8px' }}>
        <button
          onClick={onToggle}
          style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', transition: 'all 0.18s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Module nav */}
      <div style={{ padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {MODULES.map(({ id, icon: Icon, label }) => {
          const active = activeModule === id;
          return (
            <button
              key={id}
              onClick={() => onModuleChange(id)}
              title={collapsed ? label : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: collapsed ? '9px 0' : '9px 12px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: active ? '#E53935' : 'transparent',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                fontSize: 13, fontWeight: active ? 600 : 400,
                fontFamily: '"DM Sans", sans-serif',
                transition: 'all 0.18s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; } }}
            >
              <Icon size={16} style={{ flexShrink: 0 }} />
              {!collapsed && <span>{label}</span>}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      {!collapsed && (
        <>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 12px' }} />
          <div style={{ padding: '0 12px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>My Projects</div>
            <div style={{ flex: 1, overflowY: 'auto' }} className="hide-scrollbar">
              {(projects || []).slice(0, 8).map(p => (
                <button
                  key={p.id}
                  onClick={() => onProjectSelect(p)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    background: p.id === activeProjectId ? 'rgba(229,57,53,0.12)' : 'transparent',
                    border: `1px solid ${p.id === activeProjectId ? 'rgba(229,57,53,0.3)' : 'transparent'}`,
                    borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                    textAlign: 'left', marginBottom: 2, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (p.id !== activeProjectId) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (p.id !== activeProjectId) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ width: 32, height: 20, background: '#1a1a1a', borderRadius: 3, flexShrink: 0, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#2a0000,#1a1a1a)' }} />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ color: '#fff', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                      {p.updated_date ? new Date(p.updated_date).toLocaleDateString() : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={onNewProject}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(229,57,53,0.1)',
                border: '1px dashed rgba(229,57,53,0.3)', borderRadius: 8, padding: '8px 12px',
                color: '#E53935', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                margin: '8px 0', transition: 'all 0.18s', fontFamily: '"DM Sans", sans-serif', width: '100%', justifyContent: 'center',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(229,57,53,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(229,57,53,0.1)'; }}
            >
              <Plus size={14} /> New Project
            </button>
          </div>
        </>
      )}
    </div>
  );
}