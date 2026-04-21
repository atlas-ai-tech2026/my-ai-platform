import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import TransitionCard from '@/components/common/TransitionCard';
import { transitions } from '@/components/data/siteData';
import { ArrowRight } from 'lucide-react';

export default function TrendingTransitions() {
  const trendingTransitions = transitions.slice(0, 8);

  return (
    <section className="py-16 px-4 bg-background-secondary/30">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="font-heading text-3xl sm:text-4xl tracking-wider text-white mb-2">
              Trending Transitions
            </h2>
            <p className="text-foreground-muted">
              Add cinematic effects to your videos
            </p>
          </div>
          <Link 
            to={createPageUrl('Templates')}
            className="hidden sm:flex items-center gap-2 text-primary hover:text-primary-hover transition-colors"
          >
            View All <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Horizontal Scroll */}
        <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-4">
          {trendingTransitions.map((transition) => (
            <div key={transition.id} className="flex-shrink-0 w-48">
              <TransitionCard transition={transition} />
            </div>
          ))}
        </div>

        {/* Mobile View All */}
        <div className="sm:hidden flex justify-center mt-6">
          <Link 
            to={createPageUrl('Templates')}
            className="flex items-center gap-2 text-primary hover:text-primary-hover transition-colors"
          >
            View All Transitions <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}