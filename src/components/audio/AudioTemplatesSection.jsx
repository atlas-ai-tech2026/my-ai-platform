import React from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { audioTemplates } from '@/components/data/siteData';

export default function AudioTemplatesSection() {
  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="font-heading text-3xl tracking-wider text-white mb-2">
          Audio Templates
        </h2>
        <p className="text-foreground-muted">
          Click to Preview & Use
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {audioTemplates.map((template, index) => (
          <div
            key={template.id}
            className="group bg-background-secondary rounded-xl border border-border p-4 hover:border-primary/50 transition-all cursor-pointer"
          >
            {/* Waveform Preview */}
            <div 
              className="h-20 rounded-lg mb-4 flex items-center justify-center gap-0.5"
              style={{ background: [
                'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
                'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)',
                'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)',
                'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
              ][index % 4] }}
            >
              {[...Array(30)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-white/30 rounded-full"
                  style={{ height: `${Math.sin(i * 0.3) * 30 + 40}%` }}
                />
              ))}
            </div>

            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-white font-medium mb-1">{template.title}</h3>
                <p className="text-foreground-muted text-sm">{template.description}</p>
                <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded">
                  {template.useCase}
                </span>
              </div>
              <button className="p-2 rounded-lg bg-primary/20 hover:bg-primary/30 transition-colors">
                <Play className="w-4 h-4 text-primary" />
              </button>
            </div>

            <div className="flex items-center gap-1 mt-4 text-primary text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              Use Template <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}