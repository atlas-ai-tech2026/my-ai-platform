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
      {/* 3D Cube Icon */}
      <svg 
        width={cube} 
        height={cube * 0.875} 
        viewBox="0 0 32 28" 
        fill="none"
        className="flex-shrink-0"
      >
        <path 
          d="M16 2L30 10V18L16 26L2 18V10L16 2Z" 
          fill="none" 
          stroke="#E01E1E" 
          strokeWidth="1.5"
        />
        <path d="M16 2L16 26" stroke="#8B0000" strokeWidth="1"/>
        <path d="M2 10L30 10" stroke="#8B0000" strokeWidth="1"/>
        <path d="M16 2L30 10L16 18L2 10Z" fill="#8B0000" fillOpacity="0.4"/>
        <path d="M2 10L16 18L16 26L2 18Z" fill="#E01E1E" fillOpacity="0.3"/>
        <path d="M30 10L16 18L16 26L30 18Z" fill="#E01E1E" fillOpacity="0.15"/>
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