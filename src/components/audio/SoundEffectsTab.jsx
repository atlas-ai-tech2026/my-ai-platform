import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Play, Plus } from 'lucide-react';
import { soundEffects } from '@/components/data/siteData';
import { toast } from 'sonner';

const categories = ['All', 'Nature', 'Urban', 'Action', 'Cinematic', 'Ambient', 'Sci-Fi'];

export default function SoundEffectsTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const filteredEffects = soundEffects.filter((sfx) => {
    const matchesSearch = sfx.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'All' || sfx.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const handleAdd = (sfx) => {
    toast.success(`Added "${sfx.name}" to your project`);
  };

  return (
    <div className="bg-background-secondary rounded-2xl border border-border p-6">
      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sound effects... (e.g. thunder, crowd, fire)"
          className="pl-10 bg-background border-border text-white"
        />
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
              activeCategory === cat
                ? 'bg-primary text-white'
                : 'bg-background text-foreground-secondary border border-border hover:border-primary/50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* SFX Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEffects.map((sfx) => (
          <div
            key={sfx.id}
            className="bg-background rounded-xl border border-border p-4 hover:border-primary/50 transition-all"
          >
            {/* Waveform Preview */}
            <div className="flex items-center justify-center h-12 gap-0.5 mb-3">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary/40 rounded-full"
                  style={{ height: `${Math.random() * 80 + 20}%` }}
                />
              ))}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-white font-medium text-sm">{sfx.name}</h4>
                <p className="text-xs text-foreground-muted">{sfx.duration}</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 rounded-lg bg-background-elevated hover:bg-muted transition-colors">
                  <Play className="w-4 h-4 text-white" />
                </button>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="border-border text-white"
                  onClick={() => handleAdd(sfx)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}