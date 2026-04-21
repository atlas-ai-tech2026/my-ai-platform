import React, { useState, useEffect } from 'react';
import MediaCard from '@/components/common/MediaCard';
import { communityFeed } from '@/components/data/siteData';
import { Trophy, Video, Image, Sparkles, Users, Palette, Award } from 'lucide-react';

const stats = [
  { label: 'Videos Generated', value: '4M+', icon: Video },
  { label: 'Creators', value: '745K+', icon: Users },
  { label: 'AI Models', value: '30+', icon: Sparkles },
  { label: 'Quality', value: '4K', icon: Palette },
];

const filters = ['Trending', 'New', 'Images', 'Videos', 'Transitions', 'Contests'];

export default function Community() {
  const [activeFilter, setActiveFilter] = useState('Trending');
  const [animatedStats, setAnimatedStats] = useState(stats.map(() => 0));

  // Animated count-up effect
  useEffect(() => {
    const targets = [4000000, 745000, 30, 4];
    const durations = [2000, 2000, 1000, 500];
    
    targets.forEach((target, index) => {
      let start = 0;
      const increment = target / (durations[index] / 16);
      
      const timer = setInterval(() => {
        start += increment;
        if (start >= target) {
          start = target;
          clearInterval(timer);
        }
        setAnimatedStats(prev => {
          const newStats = [...prev];
          newStats[index] = Math.floor(start);
          return newStats;
        });
      }, 16);
    });
  }, []);

  const formatNumber = (num, index) => {
    if (index === 0) return `${(num / 1000000).toFixed(1)}M+`;
    if (index === 1) return `${Math.floor(num / 1000)}K+`;
    if (index === 2) return `${num}+`;
    return `${num}K`;
  };

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-4">
            COMMUNITY
          </h1>
          <p className="text-foreground-secondary">
            Discover and share AI-generated content with creators worldwide
          </p>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div 
                key={stat.label}
                className="bg-background-secondary rounded-xl border border-border p-4 text-center"
              >
                <Icon className="w-6 h-6 text-primary mx-auto mb-2" />
                <p className="font-heading text-2xl sm:text-3xl text-white mb-1">
                  {formatNumber(animatedStats[index], index)}
                </p>
                <p className="text-xs text-foreground-muted">{stat.label}</p>
              </div>
            );
          })}
        </div>

        {/* Weekly Contest Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-dark to-primary mb-10 p-6 sm:p-8">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-[100px]" />
          <div className="relative flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-white/10 flex items-center justify-center">
                <Trophy className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white/80 text-sm font-medium">🏆 WEEKLY CONTEST</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-heading tracking-wider text-white">
                  Best Action Scene
                </h3>
                <p className="text-white/70 text-sm">Prize: $500 Credits</p>
              </div>
            </div>
            <button className="px-6 py-3 bg-white text-primary font-semibold rounded-lg hover:bg-white/90 transition-colors">
              Submit Your Entry →
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar mb-8">
          {filters.map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeFilter === filter
                  ? 'bg-primary text-white'
                  : 'bg-background-secondary text-foreground-secondary border border-border hover:border-primary/50'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Feed Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...communityFeed, ...communityFeed].map((item, index) => (
            <MediaCard
              key={`${item.id}-${index}`}
              type={item.type}
              model={item.model}
              creator={item.creator}
              views={item.views}
              likes={item.likes}
              gradientIndex={index}
              className={index % 5 === 0 ? 'md:row-span-2' : ''}
            />
          ))}
        </div>

        {/* Load More */}
        <div className="flex justify-center mt-10">
          <button className="px-8 py-3 text-foreground-secondary hover:text-white border border-border hover:border-primary/50 rounded-full transition-all duration-300">
            Load More
          </button>
        </div>
      </div>
    </div>
  );
}