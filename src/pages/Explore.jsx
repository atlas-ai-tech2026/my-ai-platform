import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import VoxelLogo from '@/components/VoxelLogo';
import { Button } from '@/components/ui/button';
import { ArrowRight, Play, Eye, Heart, Wand2 } from 'lucide-react';
import MediaCard from '@/components/common/MediaCard';
import TransitionCard from '@/components/common/TransitionCard';
import { featureCards, communityFeed, transitions, toolShortcuts } from '@/components/data/siteData';
import HeroSection from '@/components/explore/HeroSection';
import FeatureCardsRow from '@/components/explore/FeatureCardsRow';
import WhatWillYouCreate from '@/components/explore/WhatWillYouCreate';
import DiscoverFeed from '@/components/explore/DiscoverFeed';
import TrendingTransitions from '@/components/explore/TrendingTransitions';

export default function Explore() {
  return (
    <div className="min-h-screen">
      <HeroSection />
      <FeatureCardsRow />
      <WhatWillYouCreate />
      <DiscoverFeed />
      <TrendingTransitions />
    </div>
  );
}