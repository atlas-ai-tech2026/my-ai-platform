import React, { useState, useRef } from 'react';
import { Play, Eye, Heart, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const gradientStyles = [
  'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
  'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)',
  'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)',
  'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
];

export default function MediaCard({ 
  type = 'image', 
  title,
  model,
  category,
  creator,
  views,
  likes,
  prompt,
  imageUrl,
  videoUrl,
  onClick,
  gradientIndex = 0,
  className,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef(null);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (videoRef.current) videoRef.current.play().catch(() => {});
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
  };

  return (
    <div 
      className={cn(
        "group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 flex flex-col",
        "hover:-translate-y-1 hover:border-glow-red",
        className
      )}
      style={{ background: '#111', border: '1px solid #2A2A2A' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div 
        className="w-full relative overflow-hidden"
        style={{ 
          background: gradientStyles[gradientIndex % gradientStyles.length], 
          minHeight: '200px',
          aspectRatio: '4/3'
        }}
      >
        {imageUrl && !videoUrl && (
          <img src={imageUrl} alt={title || model} className="absolute inset-0 w-full h-full object-cover" />
        )}
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            onError={() => {}}
            onCanPlay={() => { if (isHovered) videoRef.current?.play().catch(() => {}); }}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            loop
            playsInline
            preload="none"
          />
        )}
        {type === 'video' && (
          <div className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-300",
            isHovered && videoUrl ? "opacity-0" : "opacity-100"
          )}>
            <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm border border-white/20">
              <Play className="w-6 h-6 text-white fill-white" />
            </div>
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
        {model && (
          <span className="px-2 py-1 text-xs font-semibold bg-primary text-white rounded-full">
            {model}
          </span>
        )}
        {category && (
          <span className="px-2 py-1 text-xs font-medium bg-black/60 text-white rounded-full backdrop-blur-sm">
            {category}
          </span>
        )}
      </div>

      {/* Hover Overlay - subtle dim, hidden when video is playing */}
      <div className={cn(
        "absolute inset-0 bg-black/20 transition-opacity duration-300 pointer-events-none",
        isHovered && !videoUrl ? "opacity-100" : "opacity-0"
      )} />

      {/* Bottom Info + Try Now Button */}
      <div className="px-3 py-3 flex flex-col gap-2" style={{ background: '#111' }}>
        {(creator || views || likes) && (
          <div className="flex items-center justify-between text-xs text-foreground-secondary">
            {creator && <span>@{creator}</span>}
            <div className="flex items-center gap-2">
              {views && (
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {views}
                </span>
              )}
              {likes && (
                <span className="flex items-center gap-1">
                  <Heart className="w-3 h-3" />
                  {likes}
                </span>
              )}
            </div>
          </div>
        )}
        <button
          onClick={onClick}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
          style={{ background: '#E01E1E' }}
          onMouseEnter={e => e.currentTarget.style.background = '#ff2222'}
          onMouseLeave={e => e.currentTarget.style.background = '#E01E1E'}
        >
          <Wand2 className="w-4 h-4" />
          Try Now
        </button>
      </div>
    </div>
  );
}