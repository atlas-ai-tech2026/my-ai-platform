import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Upload, Mic, Play, Download, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

const savedVoices = [
  { id: 1, name: 'My Voice', initial: 'M' },
  { id: 2, name: 'Narrator', initial: 'N' },
  { id: 3, name: 'Character 1', initial: 'C' },
];

const emotions = ['Neutral', 'Happy', 'Serious', 'Dramatic', 'Whisper'];
const languages = ['English', 'Arabic', 'French', 'Spanish', 'Japanese', 'German', 'Korean'];

export default function VoiceCloneTab() {
  const [voiceName, setVoiceName] = useState('');
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState([1]);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleTrain = () => {
    if (!voiceName) {
      toast.error('Please enter a voice name');
      return;
    }
    toast.success('Voice training started!');
  };

  const handleGenerate = () => {
    if (!text.trim()) {
      toast.error('Please enter text to generate');
      return;
    }
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      toast.success('Audio generated!');
    }, 2000);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Left Panel - Upload & Train */}
      <div className="bg-background-secondary rounded-2xl border border-border p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Upload & Train Voice</h3>
        
        {/* Upload Area */}
        <div className="border-2 border-dashed border-primary/30 rounded-xl p-8 text-center mb-6 hover:border-primary/50 transition-colors cursor-pointer">
          <Mic className="w-12 h-12 mx-auto text-primary mb-4" />
          <p className="text-white font-medium mb-2">Upload a voice sample</p>
          <p className="text-foreground-muted text-sm mb-4">Min 10 seconds · MP3, WAV, M4A</p>
          <Button variant="outline" className="border-border text-white hover:bg-muted">
            <Upload className="w-4 h-4 mr-2" />
            Choose File
          </Button>
        </div>

        {/* Voice Name */}
        <div className="mb-4">
          <label className="text-sm text-foreground-secondary mb-2 block">Voice Name</label>
          <Input
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            placeholder="e.g., My Voice"
            className="bg-background border-border text-white"
          />
        </div>

        <Button onClick={handleTrain} className="w-full bg-primary hover:bg-primary-hover text-white">
          Train Voice →
        </Button>

        {/* Saved Voices */}
        <div className="mt-6 pt-6 border-t border-border">
          <h4 className="text-sm font-semibold text-foreground-secondary mb-3">Your Saved Voices</h4>
          <div className="flex flex-wrap gap-2">
            {savedVoices.map((voice) => (
              <button
                key={voice.id}
                className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-border hover:border-primary/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold">
                  {voice.initial}
                </div>
                <span className="text-sm text-white">{voice.name}</span>
                <Play className="w-4 h-4 text-foreground-muted" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - Generate */}
      <div className="bg-background-secondary rounded-2xl border border-border p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Generate with Cloned Voice</h3>

        {/* Text Input */}
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter the text you want spoken..."
          className="min-h-[120px] bg-background border-border text-white mb-4"
        />

        {/* Settings */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm text-foreground-secondary mb-2 block">Language</label>
            <Select defaultValue="English">
              <SelectTrigger className="bg-background border-border text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm text-foreground-secondary mb-2 block">Emotion</label>
            <Select defaultValue="Neutral">
              <SelectTrigger className="bg-background border-border text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {emotions.map((emotion) => (
                  <SelectItem key={emotion} value={emotion}>{emotion}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Speed Slider */}
        <div className="mb-6">
          <label className="text-sm text-foreground-secondary mb-2 block">
            Speed: {speed[0]}x
          </label>
          <Slider
            value={speed}
            onValueChange={setSpeed}
            min={0.5}
            max={2}
            step={0.1}
            className="py-2"
          />
          <div className="flex justify-between text-xs text-foreground-muted mt-1">
            <span>0.5x</span>
            <span>1.0x</span>
            <span>2.0x</span>
          </div>
        </div>

        <Button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full bg-primary hover:bg-primary-hover text-white mb-6"
        >
          <Wand2 className="w-4 h-4 mr-2" />
          Generate Audio · 0.2 credits
        </Button>

        {/* Output Area */}
        <div className="bg-background rounded-xl border border-border p-4">
          <div className="flex items-center justify-center h-20 gap-1">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="w-2 bg-primary/50 rounded-full waveform-bar"
                style={{ height: '40%', animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
          <div className="flex justify-center mt-4">
            <Button variant="outline" size="sm" className="border-border text-white">
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}