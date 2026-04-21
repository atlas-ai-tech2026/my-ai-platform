import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Wand2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PromptBar({
  prompt,
  onPromptChange,
  onGenerate,
  isGenerating,
  model,
  type = 'image',
  className
}) {
  const aspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  const qualities = ['HD', '2K', '4K'];
  const durations = ['5s', '8s', '10s', '15s'];
  const motions = ['Low', 'Medium', 'High'];

  return (
    <div className={cn(
      "bg-background-secondary rounded-2xl border border-border p-4",
      className
    )}>
      {/* Prompt Input */}
      <Textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={type === 'video' ? 'Describe your scene...' : 'Describe your image...'}
        className="min-h-[100px] bg-background border-border text-white placeholder:text-foreground-muted resize-none mb-4"
      />

      {/* Controls Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Model Chip */}
        {model && (
          <span className="px-3 py-1.5 text-xs font-semibold bg-primary/20 text-primary border border-primary/30 rounded-full">
            {model.name}
          </span>
        )}

        {/* Aspect Ratio */}
        <Select defaultValue="16:9">
          <SelectTrigger className="w-24 h-9 bg-background border-border text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {aspectRatios.map((ratio) => (
              <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Quality */}
        <Select defaultValue="2K">
          <SelectTrigger className="w-20 h-9 bg-background border-border text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {qualities.map((q) => (
              <SelectItem key={q} value={q}>{q}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Video-specific controls */}
        {type === 'video' && (
          <>
            <Select defaultValue="5s">
              <SelectTrigger className="w-20 h-9 bg-background border-border text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {durations.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select defaultValue="Medium">
              <SelectTrigger className="w-24 h-9 bg-background border-border text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {motions.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {/* Add Button */}
        <Button variant="outline" size="sm" className="h-9 border-border text-foreground-secondary hover:text-white">
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>

        {/* Enhance Button */}
        <Button variant="outline" size="sm" className="h-9 border-border text-foreground-secondary hover:text-white hover:border-primary/50">
          <Sparkles className="w-4 h-4 mr-1 text-primary" />
          Enhance
        </Button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Generate Button */}
        <Button 
          onClick={onGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="h-10 px-6 bg-primary hover:bg-primary-hover text-white font-semibold"
        >
          <Wand2 className="w-4 h-4 mr-2" />
          Generate · 0.1 credits
        </Button>
      </div>
    </div>
  );
}