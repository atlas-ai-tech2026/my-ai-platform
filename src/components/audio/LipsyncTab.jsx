import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Video, Mic, Wand2, Play } from 'lucide-react';
import { toast } from 'sonner';

export default function LipsyncTab() {
  const [audioMode, setAudioMode] = useState('upload');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSync = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      toast.success('Lipsync complete!');
    }, 3000);
  };

  return (
    <div className="bg-background-secondary rounded-2xl border border-border p-6">
      <p className="text-foreground-secondary mb-6">
        Upload a video and audio file — Voxel AI syncs the lips perfectly to the new voice.
      </p>

      {/* Upload Zones */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Video Upload */}
        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
          <Video className="w-12 h-12 mx-auto text-foreground-muted mb-4" />
          <p className="text-white font-medium mb-2">Upload Video</p>
          <p className="text-foreground-muted text-sm mb-4">MP4, MOV, WebM</p>
          <Button variant="outline" size="sm" className="border-border text-white">
            <Upload className="w-4 h-4 mr-2" />
            Choose Video
          </Button>
        </div>

        {/* Audio Upload */}
        <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors">
          <Tabs value={audioMode} onValueChange={setAudioMode} className="mb-4">
            <TabsList className="bg-background border border-border w-full">
              <TabsTrigger value="upload" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-white">
                Upload Audio
              </TabsTrigger>
              <TabsTrigger value="text" className="flex-1 data-[state=active]:bg-primary data-[state=active]:text-white">
                Enter Text
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {audioMode === 'upload' ? (
            <>
              <Mic className="w-10 h-10 mx-auto text-foreground-muted mb-3" />
              <p className="text-white font-medium text-sm mb-2">Upload Audio File</p>
              <Button variant="outline" size="sm" className="border-border text-white">
                <Upload className="w-4 h-4 mr-2" />
                Choose Audio
              </Button>
            </>
          ) : (
            <Textarea
              placeholder="Enter text to be spoken and synced..."
              className="min-h-[100px] bg-background border-border text-white text-sm"
            />
          )}
        </div>
      </div>

      {/* Processing Options */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="text-sm text-foreground-secondary mb-2 block">Face Detection</label>
          <Select defaultValue="auto">
            <SelectTrigger className="bg-background border-border text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto Detect</SelectItem>
              <SelectItem value="manual">Manual Select</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm text-foreground-secondary mb-2 block">Quality</label>
          <Select defaultValue="hd">
            <SelectTrigger className="bg-background border-border text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">Fast</SelectItem>
              <SelectItem value="hd">HD</SelectItem>
              <SelectItem value="ultra">Ultra HD</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Sync Button */}
      <Button 
        onClick={handleSync}
        disabled={isProcessing}
        className="w-full bg-primary hover:bg-primary-hover text-white mb-6"
      >
        <Wand2 className="w-4 h-4 mr-2" />
        {isProcessing ? 'Processing...' : 'Sync Lips · 0.5 credits'}
      </Button>

      {/* Output Preview */}
      <div className="bg-background rounded-xl border border-border aspect-video flex items-center justify-center">
        <div className="text-center">
          <Play className="w-12 h-12 text-foreground-muted mx-auto mb-2" />
          <p className="text-foreground-muted text-sm">Output preview will appear here</p>
        </div>
      </div>
    </div>
  );
}