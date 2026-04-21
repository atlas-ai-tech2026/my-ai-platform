import React, { useState } from 'react';

const MODELS = [
  { id: 'nano-pro', name: 'Nano Banana Pro', desc: 'Best 4K image model', credits: 150 },
  { id: 'seedream-5', name: 'Seedream 5.0 Lite', desc: 'Fast unlimited model', credits: 50 },
  { id: 'gpt-image', name: 'GPT Image 1.5', desc: 'True-color precision', credits: 200 },
  { id: 'flux-2', name: 'Flux 2', desc: 'Fast high-quality', credits: 60 },
];
const OUTPUT_FORMATS = ['MP4 (H.264)', 'MP4 (H.265)', 'WebM', 'MOV'];
const RESOLUTIONS = ['1080p', '4K', '720p', '480p'];
const FRAMERATES = ['24fps', '30fps', '60fps'];

export default function SettingsModule({ project, onUpdateSettings }) {
  const settings = project?.settings_json ? JSON.parse(project.settings_json || '{}') : {};
  const [model, setModel] = useState(settings.model || 'nano-pro');
  const [format, setFormat] = useState(settings.format || 'MP4 (H.264)');
  const [resolution, setResolution] = useState(settings.resolution || '1080p');
  const [framerate, setFramerate] = useState(settings.framerate || '24fps');

  const save = () => {
    onUpdateSettings && onUpdateSettings({ model, format, resolution, framerate });
  };

  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 18, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 600, padding: '24px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', height: '100%' }} className="hide-scrollbar">
      <Row label="Default AI Model">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MODELS.map(m => (
            <button key={m.id} onClick={() => setModel(m.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: model === m.id ? 'rgba(229,57,53,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${model === m.id ? 'rgba(229,57,53,0.4)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 9, padding: '10px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
              <div>
                <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{m.name}</div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{m.desc}</div>
              </div>
              <span style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>✦ {m.credits}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row label="Export Format">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {OUTPUT_FORMATS.map(f => (
            <button key={f} onClick={() => setFormat(f)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: format === f ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${format === f ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.08)'}`, color: format === f ? '#E53935' : 'rgba(255,255,255,0.6)', fontFamily: '"DM Sans", sans-serif' }}>{f}</button>
          ))}
        </div>
      </Row>
      <Row label="Resolution">
        <div style={{ display: 'flex', gap: 6 }}>
          {RESOLUTIONS.map(r => (
            <button key={r} onClick={() => setResolution(r)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: resolution === r ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${resolution === r ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.08)'}`, color: resolution === r ? '#E53935' : 'rgba(255,255,255,0.6)', fontFamily: '"DM Sans", sans-serif' }}>{r}</button>
          ))}
        </div>
      </Row>
      <Row label="Frame Rate">
        <div style={{ display: 'flex', gap: 6 }}>
          {FRAMERATES.map(f => (
            <button key={f} onClick={() => setFramerate(f)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: framerate === f ? 'rgba(229,57,53,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${framerate === f ? 'rgba(229,57,53,0.5)' : 'rgba(255,255,255,0.08)'}`, color: framerate === f ? '#E53935' : 'rgba(255,255,255,0.6)', fontFamily: '"DM Sans", sans-serif' }}>{f}</button>
          ))}
        </div>
      </Row>
      <button onClick={save} style={{ padding: '12px', background: '#E53935', border: 'none', borderRadius: 9, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: '"DM Sans", sans-serif', alignSelf: 'flex-start', minWidth: 180 }}>Save Settings</button>
    </div>
  );
}