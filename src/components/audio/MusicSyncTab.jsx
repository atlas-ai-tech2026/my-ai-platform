import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Upload, Video, Wand2, Play } from 'lucide-react';
import { toast } from 'sonner';

const musicStyles = [
  'Cinematic', 'Hip-Hop', 'Electronic', 'Lo-Fi', 'Dramatic', 'Upbeat', 'Dark'
];

export default function MusicSyncTab() {
  const [selectedStyle, setSelectedStyle] = useState('Cinematic');
  const [bpm, setBpm] = useState([120]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleGenerate = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      toast.success('Music generated and synced!');
    }, 3000);
  };

  return (
    <div className="bg-background-secondary rounded-2xl border border-border p-6">
      <p className="text-foreground-secondary mb-6">
        Upload your video — AI picks the perfect music and syncs cuts to the beat.
      </p>

      {/* Video Upload */}
      <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer mb-6">
        <Video className="w-12 h-12 mx-auto text-foreground-muted mb-4" />
        <p className="text-white font-medium mb-2">Upload Your Video</p>
        <p className="text-foreground-muted text-sm mb-4">MP4, MOV, WebM · Max 10 minutes</p>
        <Button variant="outline" className="border-border text-white">
          <Upload className="w-4 h-4 mr-2" />
          Choose Video
        </Button>
      </div>

      {/* Music Style */}
      <div className="mb-6">
        <label className="text-sm font-semibold text-foreground-secondary mb-3 block">Music Style</label>
        <div className="flex flex-wrap gap-2">
          {musicStyles.map((style) => (
            <button
              key={style}
              onClick={() => setSelectedStyle(style)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedStyle === style
                  ? 'bg-primary text-white'
                  : 'bg-background text-foreground-secondary border border-border hover:border-primary/50'
              }`}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      {/* BPM Slider */}
      <div className="mb-6">
        <label className="text-sm font-semibold text-foreground-secondary mb-2 block">
          BPM Preference: {bpm[0]}
        </label>
        <Slider
          value={bpm}
          onValueChange={setBpm}
          min={60}
          max={180}
          step={1}
          className="py-2"
        />
        <div className="flex justify-between text-xs text-foreground-muted mt-1">
          <span>60 (Slow)</span>
          <span>Auto Detect</span>
          <span>180 (Fast)</span>
        </div>
      </div>

      {/* Generate Button */}
      <Button 
        onClick={handleGenerate}
        disabled={isProcessing}
        className="w-full bg-primary hover:bg-primary-hover text-white mb-6"
      >
        <Wand2 className="w-4 h-4 mr-2" />
        {isProcessing ? 'Processing...' : 'Generate Music & Sync'}
      </Button>

      {/* Output Preview */}
      <div className="bg-background rounded-xl border border-border p-4">
        <div className="aspect-video bg-card-gradient-2 rounded-lg flex items-center justify-center mb-4">
          <Play className="w-12 h-12 text-white/50" />
        </div>
        <p className="text-center text-foreground-muted text-sm">
          Video with beat markers will appear here
        </p>
      </div>
    </div>
  );
}