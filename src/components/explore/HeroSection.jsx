import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import VoxelLogo from '@/components/VoxelLogo';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import LiquidBackground from './LiquidBackground';

const tickerItems = [
  'Image', 'Video', 'Edit', 'Audio', 'Apps', '4K Upscaling', 'Face Swap',
  'Voice Clone', 'Transitions', 'Lipsync', 'Product Ads', 'AI Influencer'
];

export default function HeroSection() {
  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-4 overflow-hidden noise-overlay">
      <LiquidBackground />

      <div className="relative z-10 w-full max-w-6xl mx-auto text-center px-4">
        <div style={{
          background: 'linear-gradient(135deg, rgba(139,0,0,0.18) 0%, rgba(255,255,255,0.04) 40%, rgba(80,0,0,0.14) 80%, rgba(224,30,30,0.10) 100%)',
          backdropFilter: 'blur(40px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.8)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 32,
          padding: 'clamp(40px, 6vw, 80px) clamp(32px, 6vw, 96px)',
          boxShadow: '0 0 120px rgba(224,30,30,0.22), 0 32px 80px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.07)',
        }}>
          <div className="flex justify-center mb-8 animate-scale-in">
            <VoxelLogo size="hero" />
          </div>

          <h1 className="font-heading text-5xl sm:text-7xl lg:text-8xl tracking-wider text-white mb-6 animate-fade-in-up">
            Create Without Limits
          </h1>

          <p className="text-lg sm:text-xl text-foreground-secondary max-w-2xl mx-auto mb-10 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            AI-powered image generation, video creation, and editing — all in one place.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
            <Link to={createPageUrl('Image')}>
              <Button size="lg" className="h-14 px-8 text-lg bg-primary hover:bg-primary-hover text-white font-semibold border-glow-red">
                Start Creating <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link to={createPageUrl('Templates')}>
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-foreground-secondary/30 text-white hover:bg-white/5">
                Explore Templates
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 py-4 bg-gradient-to-t from-background to-transparent">
        <div className="overflow-hidden">
          <div className="flex animate-ticker whitespace-nowrap">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span key={i} className="flex items-center text-foreground-muted text-sm font-medium mx-4">
                <span className="w-1.5 h-1.5 bg-primary rounded-full mr-4" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}