// Cards float at the top, the dramatic background image sits UNDER them,
// overlapping the bottom half of each card — Artlist-style.
import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Image as ImageIcon, Video, AudioWaveform, Music } from 'lucide-react';

const CARD_HEIGHT = 230;       // fixed height for the glass cards
const IMAGE_TOP_OFFSET = 115;  // image starts this many px from top of stage

const cards = [
  {
    title: 'AI Image',
    Icon: ImageIcon,
    description: 'Create high-end visuals from prompts or images.',
    learnMore: 'Image',
    tryItNow: 'Image',
  },
  {
    title: 'AI Video',
    Icon: Video,
    description: 'Make cinematic videos that feel professionally directed.',
    learnMore: 'Video',
    tryItNow: 'Video',
  },
  {
    title: 'AI Voiceover',
    Icon: AudioWaveform,
    description: 'Get studio-quality voiceovers in every major language.',
    learnMore: 'Audio',
    tryItNow: 'Audio',
  },
  {
    title: 'AI Music',
    Icon: Music,
    description: 'Create a song for any video production.',
    learnMore: 'Audio',
    tryItNow: 'Audio',
    tryItNowQuery: 'mode=music',
  },
];

export default function WhatWillYouCreate() {
  return (
    <section
      className="relative"
      style={{
        background: '#0A0A0A',
        padding: '80px 16px 60px',
      }}
    >
      <div className="max-w-7xl mx-auto">
        {/* Title — Fraunces serif */}
        <div className="text-center" style={{ marginBottom: 40 }}>
          <h2
            className="text-white"
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 'clamp(2rem, 4.5vw, 3.5rem)',
              fontWeight: 400,
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              marginBottom: 14,
            }}
          >
            What will you create today?
          </h2>
          <p
            className="mx-auto"
            style={{
              fontFamily: 'Inter, sans-serif',
              color: 'rgba(255,255,255,0.72)',
              fontSize: '1rem',
              lineHeight: 1.55,
              maxWidth: 620,
            }}
          >
            Choose from our suite of AI-powered tools to bring your creative
            vision to life.
          </p>
        </div>

        {/* Stage: cards at the top, image sits behind starting halfway down them */}
        <div
          className="relative"
          style={{ height: CARD_HEIGHT + 320 /* ~320px of image visible below */ }}
        >
          {/* Background image container — starts under the upper half of the cards */}
          <div
            className="absolute inset-x-0"
            style={{
              top: IMAGE_TOP_OFFSET,
              bottom: 0,
              borderRadius: 28,
              overflow: 'hidden',
            }}
          >
            <img
              src="/media/what-will-you-create-bg.png"
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            {/* Gentle vignette so cards stay legible at top of image */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.10) 30%, rgba(0,0,0,0.10) 70%, rgba(0,0,0,0.55) 100%)',
              }}
            />
          </div>

          {/* Cards — fixed height, anchored to top of stage, naturally laid out */}
          <div
            className="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
            style={{ gap: 20, padding: '0 24px' }}
          >
            {cards.map(({ title, Icon, description, learnMore, tryItNow, tryItNowQuery }) => (
              <article
                key={title}
                className="flex flex-col"
                style={{
                  height: CARD_HEIGHT,
                  background: 'rgba(15,15,18,0.55)',
                  backdropFilter: 'blur(34px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(34px) saturate(1.4)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 20,
                  padding: 20,
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.08), 0 16px 40px rgba(0,0,0,0.45)',
                }}
              >
                <Icon
                  style={{ width: 20, height: 20, color: '#FFF' }}
                  strokeWidth={1.6}
                />
                <h3
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    color: '#FFF',
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: '-0.015em',
                    marginTop: 10,
                    lineHeight: 1.15,
                  }}
                >
                  {title}
                </h3>
                <p
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    color: 'rgba(255,255,255,0.72)',
                    fontSize: 13,
                    lineHeight: 1.45,
                    marginTop: 6,
                    flex: 1,
                  }}
                >
                  {description}
                </p>

                <div
                  className="flex items-center justify-between"
                  style={{ marginTop: 12 }}
                >
                  <Link
                    to={createPageUrl(learnMore)}
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      color: '#FFF',
                      fontSize: 12,
                      fontWeight: 500,
                      textDecoration: 'underline',
                      textUnderlineOffset: 4,
                    }}
                  >
                    Learn More
                  </Link>
                  <Link
                    to={createPageUrl(tryItNow) + (tryItNowQuery ? `?${tryItNowQuery}` : '')}
                    className="inline-flex items-center justify-center transition-colors"
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      background: '#E01E1E',
                      color: '#FFFFFF',
                      fontSize: 12,
                      fontWeight: 600,
                      height: 32,
                      padding: '0 16px',
                      borderRadius: 9999,
                      letterSpacing: '-0.005em',
                      boxShadow:
                        '0 6px 18px rgba(224,30,30,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
                    }}
                  >
                    Try it Now
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
