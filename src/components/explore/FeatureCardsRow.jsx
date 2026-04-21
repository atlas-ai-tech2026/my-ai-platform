import React, { useState, useEffect } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { featureCards } from '@/components/data/siteData';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const gradientStyles = [
  'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
  'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)',
  'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)',
  'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
];

const NANO_BANANA_IMAGES = [
  'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/3f5150d23_hf_20260305_215156_32b827a7-a96e-49fa-a8b5-5f3469e742f6.png',
  'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/dbb89c959_hf_20260305_223734_38d5166b-2396-4e82-95e8-1b12124d37a4.png',
  'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/80b8b24e2_hf_20260305_223817_243ab818-26fc-4bcb-bd1e-1a8d4996b1e5.png',
  'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/1a9382dde_hf_20260305_221453_b848f7f8-c4f4-4105-87b5-6d644c5eb62f.png',
];

function ImageCarousel() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(prev => (prev + 1) % NANO_BANANA_IMAGES.length);
    }, 400);
    return () => clearInterval(timer);
  }, []);

  const prev = (e) => {
    e.stopPropagation();
    setCurrent(prev => (prev - 1 + NANO_BANANA_IMAGES.length) % NANO_BANANA_IMAGES.length);
  };
  const next = (e) => {
    e.stopPropagation();
    setCurrent(prev => (prev + 1) % NANO_BANANA_IMAGES.length);
  };

  return (
    <div className="relative h-56 overflow-hidden group/carousel">
      {NANO_BANANA_IMAGES.map((src, i) => (
        <img
          key={i}
          src={src}
          alt={`Nano Banana Pro sample ${i + 1}`}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-100"
          style={{ opacity: i === current ? 1 : 0 }}
        />
      ))}
      {/* Arrows */}
      <button
        onClick={prev}
        className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity"
      >
        <ChevronLeft className="w-4 h-4 text-white" />
      </button>
      <button
        onClick={next}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity"
      >
        <ChevronRight className="w-4 h-4 text-white" />
      </button>
      {/* Dots */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
        {NANO_BANANA_IMAGES.map((_, i) => (
          <button
            key={i}
            onClick={e => { e.stopPropagation(); setCurrent(i); }}
            className="w-1.5 h-1.5 rounded-full transition-all"
            style={{ background: i === current ? '#E01E1E' : 'rgba(255,255,255,0.4)' }}
          />
        ))}
      </div>
    </div>
  );
}

export default function FeatureCardsRow() {
  const navigate = useNavigate();

  return (
    <section className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-4">
          {featureCards.map((card, index) => (
            <div
              key={card.id}
              onClick={() => {
              if (card.title === 'Nano Banana Pro') navigate(createPageUrl('Image'));
              else if (card.title === 'Voxel Studio') navigate(createPageUrl('Studio'));
              else if (card.title === 'Kling 3.0') navigate(createPageUrl('Video'));
              else if (card.title === 'Seedance 2.0') navigate('/video?model=seedance-2');
            }}
              className="group flex-shrink-0 w-72 rounded-xl border border-border bg-background-secondary overflow-hidden hover:border-primary/50 hover:-translate-y-1 transition-all duration-300 cursor-pointer"
            >
              {/* Image area */}
              <div className="relative">
                {card.title === 'Nano Banana Pro' ? (
                  <ImageCarousel />
                ) : card.title === 'Voxel Studio' ? (
                  <div className="h-56 relative overflow-hidden">
                    <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/35e69567c_hf_20260307_232753_6dc6c935-e9cd-4b00-8112-5d6c16e94805.jpg" alt="Voxel Studio" className="w-full h-full object-cover" />
                  </div>
                ) : card.title === 'Seedance 2.0' ? (
                  <div className="h-56 relative overflow-hidden" style={{ background: '#0a0a0a' }}>
                    <video
                      src="/media/seedance-2-hero.mp4"
                      className="w-full h-full object-cover"
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                    />
                  </div>
                ) : card.title === 'Kling 3.0' ? (
                  <div className="h-40 relative overflow-hidden">
                    <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/8e02001c4_ChatGPTImageMar8202603_02_54AM.png" alt="Kling 3.0" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-40 relative" style={{ background: gradientStyles[index % 4] }} />
                )}
                <span className="absolute top-3 left-3 px-2 py-1 text-xs font-bold bg-primary text-white rounded z-10">
                  {card.tag}
                </span>
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-primary transition-colors">
                  {card.title}
                </h3>
                <p className="text-sm text-foreground-muted line-clamp-2">
                  {card.description}
                </p>
                <div className="flex items-center mt-3 text-primary text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Try Now <ArrowRight className="ml-1 w-4 h-4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}