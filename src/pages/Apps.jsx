import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { ArrowRight, Image, Sparkles, Zap, User, Smile, RefreshCw, Box, Paintbrush, Sun, Maximize, Video, Move, Film, Clapperboard, Camera, Palette, Users, UserCheck, Shirt, Maximize2, MousePointer, Star, Package, MessageSquare, Bookmark, Mic, MessageCircle, Globe, Headphones, Music, Feather, Flame, Droplets, Wind, Boxes } from 'lucide-react';
import { apps } from '@/components/data/siteData';

const iconMap = {
  Image, Sparkles, Zap, User, Smile, RefreshCw, Box, Paintbrush, Sun, Maximize, Video, Move, Film, Clapperboard, Camera, Palette, Users, UserCheck, Shirt, Maximize2, MousePointer, Star, Package, MessageSquare, Bookmark, Mic, MessageCircle, Globe, Headphones, Music, Feather, Flame, Droplets, Wind, Boxes
};

const categories = ['All', 'Image', 'Video', 'Audio', 'Effects', 'Enhancement', 'Marketing'];

export default function Apps() {
  const [activeCategory, setActiveCategory] = useState('All');

  const filteredApps = activeCategory === 'All'
    ? apps
    : apps.filter(app => app.category === activeCategory);

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-4">
            APPS LIBRARY
          </h1>
          <p className="text-foreground-secondary max-w-xl mx-auto">
            Explore our complete suite of AI-powered creative tools
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                activeCategory === cat
                  ? 'bg-primary text-white border-glow-red'
                  : 'bg-background-secondary text-foreground-secondary border border-border hover:border-primary/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Apps Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredApps.map((app) => {
            const Icon = iconMap[app.icon] || Sparkles;
            return (
              <div
                key={app.id}
                className="group bg-background-secondary rounded-xl border border-border p-5 hover:border-primary/50 hover:-translate-y-1 transition-all duration-300"
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold truncate">{app.name}</h3>
                      <span className="px-2 py-0.5 text-[10px] font-medium bg-primary/20 text-primary rounded-full">
                        {app.category}
                      </span>
                    </div>
                    <p className="text-foreground-muted text-sm line-clamp-2 mb-3">
                      {app.description}
                    </p>
                    <Button 
                      size="sm" 
                      className="bg-primary hover:bg-primary-hover text-white text-xs"
                    >
                      Try Now <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}