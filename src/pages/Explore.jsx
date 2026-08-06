import React from 'react';
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