import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { ArrowRight, Image, Video, Scissors, Music, RefreshCw, Maximize, Sparkles, MessageCircle } from 'lucide-react';
import { toolShortcuts } from '@/components/data/siteData';

const iconMap = {
  Image, Video, Scissors, Music, RefreshCw, Maximize, Sparkles, MessageCircle
};

export default function WhatWillYouCreate() {
  return (
    <section className="py-16 px-4 bg-background-secondary/50">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-3 gap-8 items-center">
          {/* Left Content */}
          <div className="lg:col-span-1">
            <h2 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-4">
              What Will You Create Today?
            </h2>
            <p className="text-foreground-secondary mb-6">
              Choose from our suite of AI-powered tools to bring your creative vision to life.
            </p>
            <Link to={createPageUrl('Apps')}>
              <Button className="bg-primary hover:bg-primary-hover text-white">
                Explore All Tools <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </div>

          {/* Tools Grid */}
          <div className="lg:col-span-2">
            <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-4">
              {toolShortcuts.map((tool) => {
                const Icon = iconMap[tool.icon] || Sparkles;
                return (
                  <Link
                    key={tool.id}
                    to={createPageUrl(tool.path)}
                    className="group flex-shrink-0 flex items-center gap-3 px-5 py-4 bg-background rounded-xl border border-border hover:border-primary/50 hover:bg-background-elevated transition-all duration-300"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-white font-medium whitespace-nowrap">{tool.name}</span>
                    <ArrowRight className="w-4 h-4 text-foreground-muted group-hover:text-primary transition-colors" />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}