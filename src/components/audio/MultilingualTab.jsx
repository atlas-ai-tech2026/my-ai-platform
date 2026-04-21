import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Wand2, Play, Download } from 'lucide-react';
import { toast } from 'sonner';

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
];

const voiceTypes = ['Male', 'Female', 'Neutral'];

export default function MultilingualTab() {
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState('ar');
  const [voiceType, setVoiceType] = useState('Female');
  const [autoDetect, setAutoDetect] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = () => {
    if (!text.trim()) {
      toast.error('Please enter text to translate');
      return;
    }
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      toast.success(`Generated in ${languages.find(l => l.code === targetLang)?.name}!`);
    }, 2000);
  };

  return (
    <div className="bg-background-secondary rounded-2xl border border-border p-6">
      {/* Text Input */}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter text to convert to any language..."
        className="min-h-[120px] bg-background border-border text-white mb-4"
      />

      {/* Auto Detect Toggle */}
      <div className="flex items-center justify-between p-4 bg-background rounded-lg border border-border mb-6">
        <div>
          <p className="text-white font-medium text-sm">Auto-detect source language</p>
          <p className="text-foreground-muted text-xs">AI will identify the input language</p>
        </div>
        <Switch checked={autoDetect} onCheckedChange={setAutoDetect} />
      </div>

      {/* Target Language Grid */}
      <div className="mb-6">
        <label className="text-sm font-semibold text-foreground-secondary mb-3 block">
          Target Language
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => setTargetLang(lang.code)}
              className={`p-3 rounded-lg border text-center transition-all ${
                targetLang === lang.code
                  ? 'bg-primary/10 border-primary'
                  : 'bg-background border-border hover:border-primary/50'
              }`}
            >
              <span className="text-2xl mb-1 block">{lang.flag}</span>
              <span className="text-xs text-white">{lang.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Voice Type */}
      <div className="mb-6">
        <label className="text-sm font-semibold text-foreground-secondary mb-3 block">Voice</label>
        <div className="flex gap-2">
          {voiceTypes.map((type) => (
            <button
              key={type}
              onClick={() => setVoiceType(type)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                voiceType === type
                  ? 'bg-primary text-white'
                  : 'bg-background text-foreground-secondary border border-border hover:border-primary/50'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Generate Button */}
      <Button 
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full bg-primary hover:bg-primary-hover text-white mb-6"
      >
        <Wand2 className="w-4 h-4 mr-2" />
        {isGenerating ? 'Generating...' : `Generate in ${languages.find(l => l.code === targetLang)?.name}`}
      </Button>

      {/* Output */}
      <div className="bg-background rounded-xl border border-border p-4">
        <div className="flex items-center justify-center h-16 gap-1">
          {[...Array(10)].map((_, i) => (
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