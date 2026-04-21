import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const animationClasses = {
  wipe: 'transition-wipe-left',
  dissolve: 'transition-dissolve',
  zoom: 'transition-zoom',
  glitch: 'transition-glitch',
  spin: 'transition-spin',
};

export default function TransitionCard({ 
  transition,
  onClick,
  compact = false 
}) {
  const animClass = animationClasses[transition.animation] || 'transition-dissolve';

  return (
    <div 
      className={cn(
        "group relative rounded-xl overflow-hidden cursor-pointer border border-border",
        "hover:border-primary/50 hover:border-glow-red transition-all duration-300",
        compact ? "w-40" : "w-full"
      )}
      onClick={onClick}
    >
      {/* Preview Thumbnail */}
      <div className={cn(
        "relative bg-card-gradient-3",
        compact ? "aspect-square" : "aspect-video"
      )}>
        {/* Animation Preview */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <div className={cn(
            "w-full h-full opacity-0 group-hover:opacity-100 transition-opacity duration-300",
            animClass
          )}>
            <div className="w-full h-full bg-gradient-to-r from-primary/20 to-primary-dark/20" />
          </div>
        </div>
        
        {/* Category Badge */}
        <div className="absolute top-2 left-2">
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-black/60 text-foreground-secondary rounded-full backdrop-blur-sm">
            {transition.category}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className={cn(
        "bg-background-secondary border-t border-border",
        compact ? "p-2" : "p-3"
      )}>
        <h3 className={cn(
          "font-medium text-white truncate",
          compact ? "text-xs" : "text-sm"
        )}>
          {transition.name}
        </h3>
        {!compact && (
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-foreground-muted truncate">{transition.description}</p>
            <span className="flex items-center gap-1 text-xs text-primary font-medium whitespace-nowrap ml-2">
              Try It <ArrowRight size={12} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}