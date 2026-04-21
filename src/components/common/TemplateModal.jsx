import React from 'react';
import { X, Copy, Wand2, Clock, Zap, Camera, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const gradientStyles = [
  'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
  'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)',
  'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)',
  'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
];

export default function TemplateModal({ 
  template, 
  onClose, 
  type = 'image',
  onRecreate 
}) {
  if (!template) return null;

  const copyPrompt = () => {
    navigator.clipboard.writeText(template.prompt);
    toast.success('Prompt copied to clipboard!');
  };

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-background-secondary rounded-2xl border border-border animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
        >
          <X size={20} />
        </button>

        {/* Preview */}
        <div 
          className="aspect-video w-full relative"
          style={{ background: gradientStyles[template.id % 4] }}
        >
          {type === 'video' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-20 h-20 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm border border-white/20 animate-pulse-red">
                <div className="w-0 h-0 border-l-[16px] border-l-white border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent ml-1" />
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Title & Tags */}
          <div className="space-y-3">
            <h2 className="text-2xl font-heading tracking-wider text-white">
              {template.title}
            </h2>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 text-sm font-semibold bg-primary text-white rounded-full">
                {template.model}
              </span>
              <span className="px-3 py-1 text-sm font-medium bg-background-elevated text-foreground-secondary rounded-full border border-border">
                {template.category}
              </span>
              {type === 'video' && template.duration && (
                <span className="flex items-center gap-1 px-3 py-1 text-sm font-medium bg-background-elevated text-foreground-secondary rounded-full border border-border">
                  <Clock size={14} />
                  {template.duration}
                </span>
              )}
              {type === 'video' && template.motion && (
                <span className="flex items-center gap-1 px-3 py-1 text-sm font-medium bg-background-elevated text-foreground-secondary rounded-full border border-border">
                  <Zap size={14} />
                  {template.motion} Motion
                </span>
              )}
            </div>
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wider">
              Prompt
            </h3>
            <div className="relative">
              <div className="p-4 bg-background rounded-lg border border-primary/30 font-mono text-sm text-foreground-secondary leading-relaxed">
                "{template.prompt}"
              </div>
            </div>
          </div>

          {/* Settings Info */}
          {type === 'video' && (
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-background rounded-lg border border-border text-center">
                <Camera className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-foreground-muted">Camera</p>
                <p className="text-sm font-medium text-white">Auto</p>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border text-center">
                <Settings className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-foreground-muted">Resolution</p>
                <p className="text-sm font-medium text-white">4K</p>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border text-center">
                <Zap className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-foreground-muted">FPS</p>
                <p className="text-sm font-medium text-white">30</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button 
              variant="outline" 
              className="flex-1 border-border text-white hover:bg-muted"
              onClick={copyPrompt}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Prompt
            </Button>
            <Button 
              className="flex-1 bg-primary hover:bg-primary-hover text-white"
              onClick={() => onRecreate?.(template)}
            >
              <Wand2 className="w-4 h-4 mr-2" />
              Recreate Now →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}