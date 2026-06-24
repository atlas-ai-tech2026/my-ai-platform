import React, { useRef } from 'react';
import { Upload, Image as ImageIcon, Film, Puzzle, Heart, Plus } from 'lucide-react';
import SeedanceMediaGrid from './SeedanceMediaGrid';

const S = { font: '"DM Sans", sans-serif' };

const TABS = [
  { id: 'uploads', label: 'Uploads', icon: Upload },
  { id: 'image_gens', label: 'Image Generations', icon: ImageIcon },
  { id: 'video_gens', label: 'Video Generations', icon: Film },
  { id: 'elements', label: 'Elements', icon: Puzzle },
  { id: 'liked', label: 'Liked', icon: Heart },
];

export default function SeedanceRightPanel({
  activeTab, onTabChange,
  media, elements,
  onCheckEligibility, onMediaRemove, onUploadClick, onMediaUpload,
  videos = [],
  isPopup = false, onClose,
  imageRoles = {}, onImageRoleChange,
}) {
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach(file => {
      const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
      onMediaUpload?.(type, file);
    });
  };
  const allMedia = [...(media?.images || []), ...(media?.videos || []), ...(media?.audios || [])];

  return (
    <div style={{
      ...(isPopup ? { height: '100%' } : { marginLeft: 380, height: 'calc(100vh - 60px)' }),
      overflowY: 'auto',
      background: isPopup ? 'transparent' : '#0D0D0D',
      borderLeft: isPopup ? 'none' : '1px solid #0D0D0D',
      display: 'flex', flexDirection: 'column', fontFamily: S.font,
    }}>
      {/* Header with close button (popup mode) */}
      {isPopup && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Media & Elements</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '0 16px', borderBottom: '1px solid #0D0D0D',
        position: 'sticky', top: 0, background: '#0D0D0D', zIndex: 5,
        overflowX: 'auto',
      }} className="hide-scrollbar">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => onTabChange(tab.id)}
            style={{
              padding: '14px 16px', background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #0D9488' : '2px solid transparent',
              color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 13, fontFamily: S.font, cursor: 'pointer',
              whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, padding: 20 }}>

        {/* Uploads */}
        {/* Hidden file input for right panel upload */}
        <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />

        {activeTab === 'uploads' && (
          <div>
            {/* Upload media button */}
            <button onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', maxWidth: 300, padding: '30px 20px', marginBottom: 20,
                background: 'rgba(255,255,255,0.02)', border: '1.5px dashed rgba(255,255,255,0.12)',
                borderRadius: 14, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                backdropFilter: 'blur(8px)', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(13,148,136,0.4)'; e.currentTarget.style.background = 'rgba(13,148,136,0.05)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus style={{ width: 20, height: 20, color: 'rgba(255,255,255,0.4)' }} />
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Upload media</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>Protected content is not allowed</div>
            </button>

            {allMedia.length > 0 ? (
              <SeedanceMediaGrid
                items={allMedia}
                onCheckEligibility={onCheckEligibility}
                onRemove={onMediaRemove}
                imageRoles={imageRoles}
                onImageRoleChange={onImageRoleChange}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
                No uploads yet
              </div>
            )}
          </div>
        )}

        {/* Elements */}
        {activeTab === 'elements' && (
          <div>
            {elements.length > 0 ? (
              <SeedanceMediaGrid items={elements} />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
                No approved elements yet. Upload characters and check eligibility.
              </div>
            )}
          </div>
        )}

        {/* Video Generations */}
        {activeTab === 'video_gens' && (
          <div>
            {videos.filter(v => v.status === 'completed' && v.result_url).length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {videos.filter(v => v.status === 'completed' && v.result_url).map((v, i) => (
                  <div key={v.id || i} style={{ background: '#161616', borderRadius: 10, overflow: 'hidden', border: '1px solid #0D0D0D' }}>
                    <div style={{ aspectRatio: '16/9', position: 'relative' }}>
                      <video src={v.result_url + '#t=0.1'} muted playsInline preload="auto"
                        onLoadedData={e => { e.target.currentTime = 0.1; }}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div style={{ padding: '8px 10px' }}>
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.prompt}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
                No video generations yet
              </div>
            )}
          </div>
        )}

        {/* Image Generations + Liked — placeholders */}
        {(activeTab === 'image_gens' || activeTab === 'liked') && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
            {activeTab === 'image_gens' ? 'No image generations yet' : 'No liked items yet'}
          </div>
        )}
      </div>
    </div>
  );
}
