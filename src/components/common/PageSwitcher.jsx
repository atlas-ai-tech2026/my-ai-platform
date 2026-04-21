import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Image, Video, Music } from 'lucide-react';
import { createPageUrl } from '@/utils';

const TABS = [
  { icon: Image, label: 'Image', path: 'Image' },
  { icon: Video, label: 'Video', path: 'Video' },
  { icon: Music, label: 'Audio', path: 'Audio' },
];

export default function PageSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname.replace('/', '').toLowerCase();

  return (
    <div style={{
      position: 'fixed',
      left: 16,
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      zIndex: 100,
    }}>
      {TABS.map(({ icon: Icon, label, path }) => {
        const active = currentPath === path.toLowerCase();
        return (
          <button
            key={label}
            onClick={() => navigate(createPageUrl(path))}
            title={label}
            style={{
              width: 38, height: 38,
              background: 'rgba(14,14,18,0.55)',
              backdropFilter: 'blur(48px) saturate(2.2)',
              WebkitBackdropFilter: 'blur(48px) saturate(2.2)',
              border: `1px solid ${active ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.09)'}`,
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              color: active ? '#fff' : 'rgba(255,255,255,0.4)',
              transition: 'all 0.2s',
              boxShadow: active ? '0 0 0 1px rgba(255,255,255,0.08) inset' : 'none',
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; }}}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
}