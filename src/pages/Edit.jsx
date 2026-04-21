import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import VoxelLogo from '@/components/VoxelLogo';
import { 
  Scissors, Layers, Music, Type, Palette, Sparkles, 
  CheckCircle2, Bell, ArrowRight, Play, Undo, Redo, 
  Download, Settings, Maximize, Volume2
} from 'lucide-react';
import { toast } from 'sonner';

const comingFeatures = [
  'AI-powered auto-edit',
  '30+ transitions built-in',
  'Lipsync & voice sync',
  'One-click effects',
  'Multi-track timeline',
  '4K export',
  'Caption generator',
  'Music & SFX library',
  'Background remover',
  'Color grading AI',
];

export default function Edit() {
  const [email, setEmail] = useState('');

  const handleNotify = () => {
    if (!email.includes('@')) {
      toast.error('Please enter a valid email');
      return;
    }
    toast.success('You\'ll be notified when VOXEL Edit launches!');
    setEmail('');
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background Editor Mockup (blurred) */}
      <div className="absolute inset-0 opacity-30 blur-sm">
        {/* Top Toolbar */}
        <div className="h-14 bg-background-secondary border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-muted" />
            <div className="w-8 h-8 rounded bg-muted" />
            <div className="w-8 h-8 rounded bg-muted" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-20 h-8 rounded bg-primary/30" />
          </div>
        </div>

        {/* Main Area */}
        <div className="flex h-[calc(100vh-14rem)]">
          {/* Left Panel */}
          <div className="w-64 bg-background-secondary border-r border-border p-4">
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 rounded bg-muted" />
              ))}
            </div>
          </div>

          {/* Preview Area */}
          <div className="flex-1 flex items-center justify-center bg-background p-8">
            <div className="w-full max-w-4xl aspect-video bg-card-gradient-2 rounded-lg" />
          </div>

          {/* Right Panel */}
          <div className="w-72 bg-background-secondary border-l border-border p-4">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 rounded bg-muted" />
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="h-48 bg-background-secondary border-t border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded bg-muted" />
            <div className="flex-1 h-2 rounded bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-12 rounded bg-card-gradient-1" />
            <div className="h-12 rounded bg-card-gradient-3" />
          </div>
        </div>
      </div>

      {/* Coming Soon Overlay */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full glass rounded-2xl border border-primary/40 border-glow-red p-8 sm:p-12 text-center">
          {/* Pulsing Logo */}
          <div className="flex justify-center mb-6">
            <div className="animate-pulse">
              <VoxelLogo size="large" showText={false} />
            </div>
          </div>

          {/* Title */}
          <h1 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-2">
            VOXEL EDIT
          </h1>
          <p className="text-xl text-primary font-medium mb-4">
            AI-Powered Video Editor
          </p>

          {/* Description */}
          <p className="text-foreground-secondary mb-8 max-w-md mx-auto">
            Cut, trim, add transitions, sync audio, apply effects — all with AI assistance. 
            No timeline experience needed.
          </p>

          {/* Coming Soon Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/20 rounded-full text-primary font-semibold mb-8">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            COMING SOON
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-2 gap-3 mb-8 text-left">
            {comingFeatures.map((feature, i) => (
              <div key={i} className="flex items-center gap-2 text-foreground-secondary text-sm">
                <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                {feature}
              </div>
            ))}
          </div>

          {/* Email Signup */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-background border-border text-white placeholder:text-foreground-muted"
            />
            <Button 
              onClick={handleNotify}
              className="bg-primary hover:bg-primary-hover text-white"
            >
              <Bell className="w-4 h-4 mr-2" />
              Notify Me
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}