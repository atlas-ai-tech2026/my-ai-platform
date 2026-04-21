import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MediaCard from '@/components/common/MediaCard';
import { communityFeed } from '@/components/data/siteData';
import { X, Copy, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

function ImageModal({ item, onClose, onRecreate }) {
  const copyPrompt = () => {
    navigator.clipboard.writeText(item.prompt);
    toast.success('Prompt copied!');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden animate-scale-in"
        style={{ background: '#111', border: '1px solid #2A2A2A' }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 rounded-full" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <X size={18} className="text-white" />
        </button>

        <div className="w-full relative overflow-hidden" style={{ background: '#1a1a1a' }}>
          {item.videoUrl ? (
            <video src={item.videoUrl} className="w-full block" controls autoPlay muted loop playsInline style={{ maxHeight: '400px', objectFit: 'cover' }} />
          ) : item.imageUrl ? (
            <img src={item.imageUrl} alt="" className="w-full h-auto block" />
          ) : (
            <div className="w-full h-48" style={{ background: ['linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)', 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)', 'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)', 'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)'][item.id % 4] }} />
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 text-xs font-bold rounded-full" style={{ background: '#E01E1E', color: '#fff' }}>{item.model}</span>
              <span className="text-sm" style={{ color: '#888' }}>@{item.creator}</span>
            </div>
            <span className="text-xs" style={{ color: '#555' }}>{item.type}</span>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#555' }}>Prompt</p>
            <div className="p-4 rounded-xl font-mono text-sm leading-relaxed" style={{ background: '#0D0D0D', border: '1px solid #2A2A2A', color: '#ccc' }}>
              "{item.prompt}"
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={copyPrompt}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-colors"
              style={{ border: '1px solid #2A2A2A', color: '#aaa', background: 'transparent' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#2A2A2A'}
            >
              <Copy className="w-4 h-4" /> Copy Prompt
            </button>
            <button
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
              style={{ background: '#E01E1E' }}
              onMouseEnter={e => e.currentTarget.style.background = '#ff2222'}
              onMouseLeave={e => e.currentTarget.style.background = '#E01E1E'}
              onClick={() => onRecreate(item.prompt)}
            >
              <Wand2 className="w-4 h-4" /> Recreate Now →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DiscoverFeed() {
  const [selectedItem, setSelectedItem] = useState(null);
  const navigate = useNavigate();

  return (
    <section className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-4">
            DISCOVER THE PROJECTS, AND RECREATE IT!
          </h2>
          <p className="text-foreground-secondary max-w-2xl mx-auto">
            Browse AI-generated content. Click any card to see its prompt and recreate it.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {communityFeed.map((item, index) => (
            <MediaCard
              key={item.id}
              type={item.type}
              model={item.model}
              creator={item.creator}
              views={item.views}
              likes={item.likes}
              prompt={item.prompt}
              imageUrl={item.imageUrl}
              videoUrl={item.videoUrl}
              gradientIndex={index}
              onClick={() => setSelectedItem(item)}
            />
          ))}
        </div>

        <div className="flex justify-center mt-10">
          <button className="px-8 py-3 text-foreground-secondary hover:text-white border border-border hover:border-primary/50 rounded-full transition-all duration-300">
            Load More
          </button>
        </div>
      </div>

      {selectedItem && (
        <ImageModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onRecreate={(prompt) => { navigate('/Image?prompt=' + encodeURIComponent(prompt)); setSelectedItem(null); }}
        />
      )}
    </section>
  );
}