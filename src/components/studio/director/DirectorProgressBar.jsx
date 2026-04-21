import React from 'react';
import { Check } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'Character' },
  { id: 2, label: 'Wardrobe' },
  { id: 3, label: 'Location' },
  { id: 4, label: 'Scene Compose' },
  { id: 5, label: 'Direct Shot' },
  { id: 6, label: 'Generate Video' },
  { id: 7, label: 'Timeline' },
];

export default function DirectorProgressBar({ currentStep, completedSteps, onStepClick }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(0,0,0,0.3)', overflowX: 'auto', flexShrink: 0,
    }} className="hide-scrollbar">
      {STEPS.map((step, i) => {
        const isActive = currentStep === step.id;
        const isDone = completedSteps.includes(step.id);
        const isLocked = !isDone && step.id > currentStep;
        return (
          <React.Fragment key={step.id}>
            <button
              onClick={() => !isLocked && onStepClick(step.id)}
              disabled={isLocked}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 20, whiteSpace: 'nowrap',
                background: isActive ? 'rgba(229,57,53,0.15)' : 'transparent',
                border: `1px solid ${isActive ? 'rgba(229,57,53,0.5)' : 'transparent'}`,
                cursor: isLocked ? 'default' : 'pointer',
                transition: 'all 0.2s ease',
                opacity: isLocked ? 0.35 : 1,
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                background: isDone ? '#E53935' : isActive ? 'rgba(229,57,53,0.3)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${isDone || isActive ? '#E53935' : 'rgba(255,255,255,0.12)'}`,
                color: isDone ? '#fff' : isActive ? '#E53935' : 'rgba(255,255,255,0.4)',
              }}>
                {isDone ? <Check size={12} /> : step.id}
              </div>
              <span style={{
                fontSize: 12, fontWeight: isActive ? 600 : 500,
                color: isActive ? '#E53935' : isDone ? '#fff' : 'rgba(255,255,255,0.5)',
                fontFamily: '"DM Sans", sans-serif',
              }}>
                {step.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, minWidth: 16, height: 1,
                background: isDone ? 'rgba(229,57,53,0.4)' : 'rgba(255,255,255,0.08)',
                transition: 'background 0.3s',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}