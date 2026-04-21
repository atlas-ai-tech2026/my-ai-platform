import React from 'react';
import { cn } from '@/lib/utils';

export default function ModelSelector({ models, selectedModel, onSelect }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar py-2">
      {models.map((model) => (
        <button
          key={model.id}
          onClick={() => onSelect(model)}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200",
            selectedModel?.id === model.id
              ? "bg-primary text-white border-glow-red"
              : "bg-background-secondary text-foreground-secondary border border-border hover:border-primary/50 hover:text-white"
          )}
        >
          {model.name}
        </button>
      ))}
    </div>
  );
}