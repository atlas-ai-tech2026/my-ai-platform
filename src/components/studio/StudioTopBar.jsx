import React, { useState, useRef, useEffect } from 'react';
import { Save, Download, ChevronDown, Zap, ChevronLeft } from 'lucide-react';
import VoxelLogo from '@/components/VoxelLogo';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function StudioTopBar({ project, onProjectNameChange, saveStatus, onExport }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project?.name || 'Untitled Project');
  const inputRef = useRef(null);

  useEffect(() => {
    if (project?.name) setName(project.name);
  }, [project?.name]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (name.trim() && name !== project?.name) onProjectNameChange(name.trim());
  };

  return (
    <div style={{
      height: 48, background: '#0A0A0A', borderBottom: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0, zIndex: 50,
    }}>
      {/* Back button */}
      <Link
        to={createPageUrl('Explore')}
        style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 13, flexShrink: 0, transition: 'color 0.15s', fontFamily: '"DM Sans", sans-serif' }}
        onMouseEnter={e => e.currentTarget.style.color = '#fff'}
        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
      >
        <ChevronLeft size={16} />
      </Link>

      {/* Logo */}
      <div style={{ flexShrink: 0 }}>
        <VoxelLogo size="sm" />
      </div>

      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

      {/* Project name */}
      {editing ? (
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(229,57,53,0.5)',
            borderRadius: 6, color: '#fff', fontSize: 14, fontWeight: 500,
            padding: '4px 10px', outline: 'none', fontFamily: '"DM Sans", sans-serif', minWidth: 160,
          }}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 14, fontWeight: 500, fontFamily: '"DM Sans", sans-serif', padding: '4px 6px', borderRadius: 6, transition: 'background 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {name}
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginLeft: 6 }}>✎</span>
        </button>
      )}

      {/* Save status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: saveStatus === 'saved' ? 'rgba(100,200,100,0.8)' : 'rgba(255,255,255,0.4)', fontSize: 12 }}>
        <Save size={12} />
        <span>{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved ✓' : 'Unsaved'}</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Credits */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '4px 12px' }}>
        <Zap size={12} style={{ color: '#E53935' }} />
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>40,000 credits</span>
      </div>

      {/* Export button */}
      <button
        onClick={onExport}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: '#E53935', border: 'none',
          borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '7px 14px',
          cursor: 'pointer', transition: 'background 0.18s', fontFamily: '"DM Sans", sans-serif',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#ff2222'}
        onMouseLeave={e => e.currentTarget.style.background = '#E53935'}
      >
        <Download size={14} />
        Export
      </button>

      {/* User avatar */}
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#E53935,#8B0000)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
        V
      </div>
    </div>
  );
}