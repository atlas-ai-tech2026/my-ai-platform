import React from 'react';

export default function VoxelLogo({ size = 'default', showText = true }) {
  const sizes = {
    small: { cube: 24, text: 'text-xl' },
    default: { cube: 32, text: 'text-2xl' },
    large: { cube: 48, text: 'text-4xl' },
    hero: { cube: 64, text: 'text-6xl' },
  };

  const { cube, text } = sizes[size] || sizes.default;

  return (
    <div className="flex items-center gap-2">
      {/* V Icon — matches the browser-tab favicon (public/voxel-icon.svg) */}
      <svg
        width={cube}
        height={cube}
        viewBox="0 0 64 64"
        fill="none"
        className="flex-shrink-0"
      >
        <path
          d="M20 18L32 46L44 18"
          stroke="#E01E1E"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="14" r="3" fill="#E01E1E" />
      </svg>

      {/* Text */}
      {showText && (
        <div className="flex items-baseline">
          <span 
            className={`font-display ${text} tracking-wider text-primary glow-red`}
          >
            VOXEL
          </span>
          <span 
            className={`font-display text-white ml-0.5 ${size === 'hero' ? 'text-xl' : size === 'large' ? 'text-sm' : 'text-xs'} -translate-y-1`}
          >
            AI
          </span>
        </div>
      )}
    </div>
  );
}