import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Wand2, Download } from 'lucide-react';
import { toast } from 'sonner';

const voiceStyles = [
  { id: 1, name: 'Narrator', description: 'Deep, authoritative' },
  { id: 2, name: 'News Anchor', description: 'Clear, professional' },
  { id: 3, name: 'Character', description: 'Expressive, dynamic' },
  { id: 4, name: 'ASMR', description: 'Soft, whispery' },
  { id: 5, name: 'Deep', description: 'Low, resonant' },
  { id: 6, name: 'Feminine', description: 'Warm, melodic' },
  { id: 7, name: 'Masculine', description: 'Strong, bold' },
  { id: 8, name: 'Child', description: 'Young, energetic' },
];

const languages = ['English (US)', 'English (UK)', 'Spanish', 'French', 'German', 'Japanese', 'Arabic'];
const accents = ['American', 'British', 'Australian', 'Indian', 'None'];

export default function TextToSpeechTab() {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = () => {
    if (!text.trim()) {
      toast.error('Please enter text to convert');
      return;
    }
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      toast.success('Speech generated!');
    }, 2000);
  };

  return (
    <div className="bg-background-secondary rounded-2xl border border-border p-6">
      {/* Text Input */}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type anything to hear it spoken..."
        className="min-h-[150px] bg-background border-border text-white mb-6"
      />

      {/* Voice Styles Grid */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-foreground-secondary mb-3">Voice Style</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {voiceStyles.map((voice) => (
            <button
              key={voice.id}
              onClick={() => setSelectedVoice(voice.id)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedVoice === voice.id
                  ? 'bg-primary/10 border-primary text-white'
                  : 'bg-background border-border text-foreground-secondary hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{voice.name}</span>
                <Play className="w-3 h-3" />
              </div>
              <p className="text-xs opacity-70">{voice.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Language & Accent */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="text-sm text-foreground-secondary mb-2 block">Language</label>
          <Select defaultValue="English (US)">
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
          <label className="text-sm text-foreground-secondary mb-2 block">Accent</label>
          <Select defaultValue="American">
            <SelectTrigger className="bg-background border-border text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accents.map((accent) => (
                <SelectItem key={accent} value={accent}>{accent}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Generate Button */}
      <Button 
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full bg-primary hover:bg-primary-hover text-white mb-6"
      >
        <Wand2 className="w-4 h-4 mr-2" />
        {isGenerating ? 'Generating...' : 'Generate Speech'}
      </Button>

      {/* Output */}
      <div className="bg-background rounded-xl border border-border p-4">
        <div className="flex items-center justify-center h-16 gap-1">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="w-1.5 bg-primary/40 rounded-full"
              style={{ height: `${Math.random() * 60 + 20}%` }}
            />
          ))}
        </div>
        <div className="flex justify-center gap-3 mt-4">
          <Button variant="outline" size="sm" className="border-border text-white">
            <Play className="w-4 h-4 mr-2" />
            Play
          </Button>
          <Button variant="outline" size="sm" className="border-border text-white">
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}