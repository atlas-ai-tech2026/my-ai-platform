import React, { useState } from 'react';
import PageSwitcher from '@/components/common/PageSwitcher';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { 
  Mic, MessageSquare, Volume2, Music, Globe, Headphones,
  Upload, Play, Download, Plus, Search, Wand2
} from 'lucide-react';
import VoiceCloneTab from '@/components/audio/VoiceCloneTab';
import TextToSpeechTab from '@/components/audio/TextToSpeechTab';
import LipsyncTab from '@/components/audio/LipsyncTab';
import SoundEffectsTab from '@/components/audio/SoundEffectsTab';
import MusicSyncTab from '@/components/audio/MusicSyncTab';
import MultilingualTab from '@/components/audio/MultilingualTab';
import AudioTemplatesSection from '@/components/audio/AudioTemplatesSection';

const audioTools = [
  { id: 'voice-clone', name: 'Voice Clone', icon: Mic },
  { id: 'tts', name: 'Text to Speech', icon: MessageSquare },
  { id: 'lipsync', name: 'Lipsync', icon: Volume2 },
  { id: 'sfx', name: 'Sound Effects', icon: Headphones },
  { id: 'music-sync', name: 'Music Sync', icon: Music },
  { id: 'multilingual', name: 'Multilingual', icon: Globe },
];

export default function Audio() {
  const [activeTool, setActiveTool] = useState('voice-clone');

  return (
    <div className="min-h-screen py-8 px-4">
      <PageSwitcher />
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/20 rounded-full text-primary text-sm font-semibold mb-4">
            <span className="w-2 h-2 rounded-full bg-primary" />
            NEW
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-2">
            AUDIO STUDIO
          </h1>
          <p className="text-foreground-secondary max-w-xl mx-auto">
            Clone voices, generate speech, sync lips, create soundscapes — all powered by AI.
          </p>
        </div>

        {/* Tool Selector */}
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar py-4 mb-8">
          {audioTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  activeTool === tool.id
                    ? 'bg-primary text-white border-glow-red'
                    : 'bg-background-secondary text-foreground-secondary border border-border hover:border-primary/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tool.name}
              </button>
            );
          })}
        </div>

        {/* Tool Content */}
        <div className="mb-16">
          {activeTool === 'voice-clone' && <VoiceCloneTab />}
          {activeTool === 'tts' && <TextToSpeechTab />}
          {activeTool === 'lipsync' && <LipsyncTab />}
          {activeTool === 'sfx' && <SoundEffectsTab />}
          {activeTool === 'music-sync' && <MusicSyncTab />}
          {activeTool === 'multilingual' && <MultilingualTab />}
        </div>

        {/* Audio Templates */}
        <AudioTemplatesSection />
      </div>
    </div>
  );
}