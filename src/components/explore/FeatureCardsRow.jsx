import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { featureCards } from '@/components/data/siteData';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const OpenAIMark = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);

const GoogleG = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden>
    <path fill="#FFFFFF" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FFFFFF" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#FFFFFF" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#FFFFFF" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

const KlingMark = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden xmlns="http://www.w3.org/2000/svg">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M 3 12 A 9 4.2 0 1 0 21 12 A 9 4.2 0 1 0 3 12 Z M 7 12 A 5 1.6 0 1 1 17 12 A 5 1.6 0 1 1 7 12 Z"
      transform="rotate(-30 12 12)"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M 3 12 A 9 4.2 0 1 0 21 12 A 9 4.2 0 1 0 3 12 Z M 7 12 A 5 1.6 0 1 1 17 12 A 5 1.6 0 1 1 7 12 Z"
      transform="rotate(30 12 12)"
    />
  </svg>
);

const SeedanceMark = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <rect x="3.5" y="14" width="3.2" height="6" rx="0.6" />
    <rect x="10.4" y="9" width="3.2" height="11" rx="0.6" />
    <rect x="17.3" y="4" width="3.2" height="16" rx="0.6" />
  </svg>
);

const SparkleMark = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12 2 L13.5 9.5 L21 11 L13.5 12.5 L12 20 L10.5 12.5 L3 11 L10.5 9.5 Z" />
  </svg>
);

const cardIcon = {
  'Nano Banana Pro': GoogleG,
  'Kling 3.0': KlingMark,
  'Seedance 2.0': SeedanceMark,
  'Voxel Studio': SparkleMark,
  'Seedream 4.5': SparkleMark,
  'Face Swap': OpenAIMark,
};

const cardMedia = {
  'Nano Banana Pro': {
    type: 'carousel',
    images: [
      'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/3f5150d23_hf_20260305_215156_32b827a7-a96e-49fa-a8b5-5f3469e742f6.png',
      'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/dbb89c959_hf_20260305_223734_38d5166b-2396-4e82-95e8-1b12124d37a4.png',
      'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/80b8b24e2_hf_20260305_223817_243ab818-26fc-4bcb-bd1e-1a8d4996b1e5.png',
      'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/1a9382dde_hf_20260305_221453_b848f7f8-c4f4-4105-87b5-6d644c5eb62f.png',
    ],
  },
  'Voxel Studio': {
    type: 'image',
    src: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69a83da7490a426a3f30f581/35e69567c_hf_20260307_232753_6dc6c935-e9cd-4b00-8112-5d6c16e94805.jpg',
  },
  'Seedance 2.0': {
    type: 'video',
    src: '/media/seedance-2-hero.mp4',
  },
  'Kling 3.0': {
    type: 'video',
    src: '/media/kling-3-card.mp4',
  },
  'Seedream 4.5': {
    type: 'gradient',
    bg: 'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
  },
  'Face Swap': {
    type: 'gradient',
    bg: 'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
  },
};

function ImageCarousel({ images, alt }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(prev => (prev + 1) % images.length);
    }, 1200);
    return () => clearInterval(timer);
  }, [images.length]);

  return (
    <div className="absolute inset-0">
      {images.map((src, i) => (
        <img
          key={i}
          src={src}
          alt={`${alt} ${i + 1}`}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: i === current ? 1 : 0 }}
        />
      ))}
    </div>
  );
}

function CardMedia({ title, media }) {
  if (media.type === 'carousel') return <ImageCarousel images={media.images} alt={title} />;
  if (media.type === 'image')
    return <img src={media.src} alt={title} className="absolute inset-0 w-full h-full object-cover" />;
  if (media.type === 'video')
    return (
      <video
        src={media.src}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
    );
  return <div className="absolute inset-0" style={{ background: media.bg }} />;
}

export default function FeatureCardsRow() {
  const navigate = useNavigate();
  const scrollerRef = useRef(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  const handleClick = (title) => {
    if (title === 'Nano Banana Pro') navigate(createPageUrl('Image'));
    else if (title === 'Voxel Studio') navigate(createPageUrl('Studio'));
    else if (title === 'Kling 3.0') navigate(createPageUrl('Video'));
    else if (title === 'Seedance 2.0') navigate('/video?model=seedance-2');
  };

  const updatePage = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const pages = Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth));
    const current = Math.round(el.scrollLeft / el.clientWidth);
    setPageCount(pages);
    setPage(current);
  };

  useEffect(() => {
    updatePage();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updatePage, { passive: true });
    window.addEventListener('resize', updatePage);
    return () => {
      el.removeEventListener('scroll', updatePage);
      window.removeEventListener('resize', updatePage);
    };
  }, []);

  const goTo = (p) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: p * el.clientWidth, behavior: 'smooth' });
  };

  const next = () => goTo(Math.min(page + 1, pageCount - 1));
  const prev = () => goTo(Math.max(page - 1, 0));

  return (
    <section className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <h2
            className="text-white"
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
              fontWeight: 400,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
            }}
          >
            Explore featured models
          </h2>
        </div>

        <div className="relative">
          <div
            ref={scrollerRef}
            className="flex gap-5 overflow-x-auto hide-scrollbar pb-2"
            style={{ scrollSnapType: 'x mandatory' }}
          >
            {featureCards.map((card) => {
              const Icon = cardIcon[card.title] || SparkleMark;
              const media = cardMedia[card.title] || { type: 'gradient', bg: '#111' };
              const showFeaturedTag = card.title === 'Nano Banana Pro';
              return (
                <article
                  key={card.id}
                  onClick={() => handleClick(card.title)}
                  className="group relative flex-shrink-0 overflow-hidden cursor-pointer"
                  style={{
                    width: 320,
                    height: 400,
                    borderRadius: 20,
                    scrollSnapAlign: 'start',
                    transform: 'translateZ(0)',
                  }}
                >
                  <CardMedia title={card.title} media={media} />

                  {/* Frosted-glass blur panel — long, smooth fade */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      backdropFilter: 'blur(38px) saturate(1.2)',
                      WebkitBackdropFilter: 'blur(38px) saturate(1.2)',
                      maskImage:
                        'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,1) 75%)',
                      WebkitMaskImage:
                        'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,1) 75%)',
                    }}
                  />

                  {/* Subtle dark gradient just for text contrast */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.45) 100%)',
                    }}
                  />

                  {showFeaturedTag && (
                    <span
                      className="absolute top-4 left-4 text-white"
                      style={{
                        background: 'rgba(0,0,0,0.55)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 9999,
                        padding: '6px 12px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Exclusively on Voxel
                    </span>
                  )}

                  <div
                    className="absolute left-6 right-6 bottom-6 text-white"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-[16px] h-[16px] text-white" />
                      <h3
                        style={{
                          fontFamily: 'Inter, sans-serif',
                          fontSize: '1.125rem',
                          fontWeight: 700,
                          letterSpacing: '-0.015em',
                          lineHeight: 1.15,
                        }}
                      >
                        {card.title}
                      </h3>
                    </div>
                    <p
                      className="text-white/80"
                      style={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '0.8125rem',
                        fontWeight: 400,
                        lineHeight: 1.4,
                        letterSpacing: '-0.003em',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {card.description}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          {pageCount > 1 && page < pageCount - 1 && (
            <button
              onClick={next}
              aria-label="Next"
              className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full items-center justify-center transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}
            >
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          )}
          {pageCount > 1 && page > 0 && (
            <button
              onClick={prev}
              aria-label="Previous"
              className="hidden md:flex absolute -left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full items-center justify-center transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}
            >
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
          )}
        </div>

        {pageCount > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            {Array.from({ length: pageCount }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Page ${i + 1}`}
                className="rounded-full transition-all"
                style={{
                  width: i === page ? 22 : 7,
                  height: 7,
                  background:
                    i === page ? '#E01E1E' : 'rgba(255,255,255,0.25)',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
