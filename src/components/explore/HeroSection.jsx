import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ArrowRight } from 'lucide-react';

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
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <ellipse cx="9" cy="12" rx="3.6" ry="6" transform="rotate(-30 9 12)" />
    <ellipse cx="15" cy="12" rx="3.6" ry="6" transform="rotate(30 15 12)" />
  </svg>
);

const SeedanceMark = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <rect x="3.5" y="14" width="3.2" height="6" rx="0.6" />
    <rect x="10.4" y="9" width="3.2" height="11" rx="0.6" />
    <rect x="17.3" y="4" width="3.2" height="16" rx="0.6" />
  </svg>
);

const ElevenLabsMark = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <rect x="6.5" y="5" width="3.6" height="14" rx="0.6" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="0.6" />
  </svg>
);

const modelPills = [
  { name: 'Sora', Icon: OpenAIMark, color: 'text-white' },
  { name: 'Veo', Icon: GoogleG, color: '' },
  { name: 'Nano Banana', Icon: GoogleG, color: '' },
  { name: 'Kling', Icon: KlingMark, color: 'text-white' },
  { name: 'Seedance', Icon: SeedanceMark, color: 'text-white' },
  { name: 'GPT Image', Icon: OpenAIMark, color: 'text-white' },
  { name: 'Lyria', Icon: GoogleG, color: '' },
  { name: 'ElevenLabs', Icon: ElevenLabsMark, color: 'text-white' },
];

export default function HeroSection() {
  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-4 overflow-hidden">
      <video
        className="absolute inset-0 w-full h-full object-cover"
        src="/media/explore-hero.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0.05) 100%)',
        }}
      />

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center px-4 pt-12 pb-40">
        <h1
          className="font-serif-display text-white mb-6 animate-fade-in-up"
          style={{
            fontSize: 'clamp(2.75rem, 7vw, 6rem)',
            fontWeight: 400,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          Create without limits
        </h1>

        <p
          className="text-white/80 max-w-2xl mx-auto mb-10 animate-fade-in-up font-body"
          style={{
            fontSize: 'clamp(1rem, 1.4vw, 1.25rem)',
            lineHeight: 1.55,
            animationDelay: '0.15s',
          }}
        >
          The ultimate creative AI ecosystem — image, video, audio, and editing.
          One place for every model, every workflow.
        </p>

        <div
          className="flex justify-center animate-fade-in-up"
          style={{ animationDelay: '0.3s' }}
        >
          <Link to={createPageUrl('Image')}>
            <button
              className="bg-primary hover:bg-primary-hover text-white font-semibold rounded-full transition-colors flex items-center gap-2"
              style={{
                height: 56,
                padding: '0 36px',
                fontSize: '1.0625rem',
                boxShadow:
                  '0 0 0 1px rgba(255,255,255,0.05), 0 12px 40px rgba(224,30,30,0.45), 0 0 60px rgba(224,30,30,0.35)',
              }}
            >
              Start Creating
              <ArrowRight className="w-5 h-5" />
            </button>
          </Link>
        </div>
      </div>

      <div className="absolute bottom-10 left-0 right-0 z-10 flex justify-center px-4">
        <div
          className="flex items-center overflow-x-auto max-w-full hide-scrollbar"
          style={{
            background: 'transparent',
            backdropFilter: 'blur(14px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 9999,
            padding: '14px 28px',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(255,255,255,0.02), 0 10px 40px rgba(0,0,0,0.3), 0 24px 80px rgba(0,0,0,0.2)',
          }}
        >
          {modelPills.map(({ name, Icon, color }) => (
            <div
              key={name}
              className="flex items-center gap-2.5 px-5 shrink-0"
            >
              <Icon className={`w-[18px] h-[18px] ${color}`} />
              <span
                className="text-white whitespace-nowrap"
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 500,
                  letterSpacing: '-0.005em',
                }}
              >
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
