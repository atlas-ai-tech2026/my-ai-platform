import React from 'react';
import VoxelLogo from '../VoxelLogo';
import { Loader2, Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function GenerationCanvas({ 
  type = 'image',
  isGenerating = false,
  result = null,
  className
}) {
  return (
    <div 
      className={cn(
        "relative w-full rounded-2xl overflow-hidden border border-border bg-background-secondary",
        isGenerating && "animate-pulse-red",
        type === 'video' ? "aspect-video" : "aspect-square md:aspect-[4/3]",
        className
      )}
    >
      {/* Empty State */}
      {!isGenerating && !result && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {type === 'video' ? (
            <Clapperboard className="w-16 h-16 text-foreground-muted mb-4" />
          ) : (
            <VoxelLogo size="large" showText={false} />
          )}
          <p className="text-foreground-muted mt-4">
            {type === 'video' ? 'Describe your scene...' : 'Describe your vision...'}
          </p>
        </div>
      )}

      {/* Generating State */}
      {isGenerating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background-secondary">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          </div>
          <p className="text-white font-medium mt-6">Generating...</p>
          <p className="text-foreground-muted text-sm mt-1">This may take a few seconds</p>
          
          {/* Progress Bar */}
          <div className="w-64 h-1 bg-muted rounded-full mt-4 overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Result */}
      {result && !isGenerating && (
        <div className="absolute inset-0 bg-card-gradient-2 animate-fade-in-up">
          {/* Placeholder for generated content */}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-foreground-secondary">Generated {type}</p>
          </div>
        </div>
      )}
    </div>
  );
}