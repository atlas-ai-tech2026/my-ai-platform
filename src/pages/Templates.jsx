import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import TemplateModal from '@/components/common/TemplateModal';
import TransitionCard from '@/components/common/TransitionCard';
import { imageTemplates, videoTemplates, transitions } from '@/components/data/siteData';
import { Image, Film, Sparkles, Play } from 'lucide-react';

const imageCategories = ['All', 'Portrait', 'Cinematic', 'Product Ad', 'Fashion', 'Architecture', 'Art'];
const videoCategories = ['All', 'Action', 'Cinematic', 'Product Ad', 'Nature', 'Character'];
const transitionCategories = ['All', 'Cinematic', 'Elemental', 'Motion', 'Glitch', 'Smooth', '3D'];

export default function Templates() {
  const [activeTab, setActiveTab] = useState('image');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [imageCategory, setImageCategory] = useState('All');
  const [videoCategory, setVideoCategory] = useState('All');
  const [transitionCategory, setTransitionCategory] = useState('All');

  const filteredImages = imageCategory === 'All' 
    ? imageTemplates 
    : imageTemplates.filter(t => t.category === imageCategory);

  const filteredVideos = videoCategory === 'All'
    ? videoTemplates
    : videoTemplates.filter(t => t.category === videoCategory);

  const filteredTransitions = transitionCategory === 'All'
    ? transitions
    : transitions.filter(t => t.category === transitionCategory);

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-wider text-white mb-4">
            TEMPLATES
          </h1>
          <p className="text-foreground-secondary">
            Browse curated templates for images, videos, and transitions
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full max-w-lg mx-auto grid grid-cols-3 bg-background-secondary border border-border mb-8">
            <TabsTrigger value="image" className="data-[state=active]:bg-primary data-[state=active]:text-white">
              <Image className="w-4 h-4 mr-2" />
              Image
            </TabsTrigger>
            <TabsTrigger value="video" className="data-[state=active]:bg-primary data-[state=active]:text-white">
              <Film className="w-4 h-4 mr-2" />
              Video
            </TabsTrigger>
            <TabsTrigger value="transitions" className="data-[state=active]:bg-primary data-[state=active]:text-white">
              <Sparkles className="w-4 h-4 mr-2" />
              Transitions
            </TabsTrigger>
          </TabsList>

          {/* Image Templates Tab */}
          <TabsContent value="image">
            {/* Category Filter */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {imageCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setImageCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    imageCategory === cat
                      ? 'bg-primary text-white'
                      : 'bg-background-secondary text-foreground-secondary border border-border hover:border-primary/50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredImages.map((template, index) => {
                const gradients = [
                  'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
                  'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)',
                  'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)',
                  'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
                ];
                return (
                <div
                  key={template.id}
                  onClick={() => setSelectedTemplate({ ...template, type: 'image' })}
                  className="group relative rounded-xl overflow-hidden cursor-pointer border border-border hover:border-primary/50 hover:-translate-y-1 transition-all duration-300"
                  style={{ background: gradients[index % 4] }}
                >
                  <div className="aspect-[4/5]" />
                  
                  <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                    <span className="px-2 py-1 text-xs font-semibold bg-primary text-white rounded-full">
                      {template.model}
                    </span>
                    <span className="px-2 py-1 text-xs font-medium bg-black/60 text-white rounded-full backdrop-blur-sm">
                      {template.category}
                    </span>
                  </div>

                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                    <h3 className="text-white font-semibold text-lg">{template.title}</h3>
                    <p className="text-foreground-secondary text-sm mt-1">Click to view prompt</p>
                  </div>
                </div>
                );
              })}
            </div>
          </TabsContent>

          {/* Video Templates Tab */}
          <TabsContent value="video">
            {/* Category Filter */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {videoCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setVideoCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    videoCategory === cat
                      ? 'bg-primary text-white'
                      : 'bg-background-secondary text-foreground-secondary border border-border hover:border-primary/50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredVideos.map((template, index) => {
                const gradients = [
                  'linear-gradient(135deg, #1a0000 0%, #8B0000 50%, #1a1a1a 100%)',
                  'linear-gradient(135deg, #0a0a1a 0%, #1a0a2a 50%, #2a0a0a 100%)',
                  'linear-gradient(135deg, #0d0d0d 0%, #2a0000 60%, #111 100%)',
                  'linear-gradient(135deg, #1a1a0a 0%, #3a1a00 50%, #0a0a0a 100%)',
                ];
                return (
                <div
                  key={template.id}
                  onClick={() => setSelectedTemplate({ ...template, type: 'video' })}
                  className="group relative rounded-xl overflow-hidden cursor-pointer border border-border hover:border-primary/50 hover:-translate-y-1 transition-all duration-300"
                  style={{ background: gradients[index % 4] }}
                >
                  <div className="aspect-video flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                      <Play className="w-6 h-6 text-white fill-white" />
                    </div>
                  </div>
                  
                  <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                    <span className="px-2 py-1 text-xs font-semibold bg-primary text-white rounded-full">
                      {template.model}
                    </span>
                    <span className="px-2 py-1 text-xs font-medium bg-black/60 text-white rounded-full backdrop-blur-sm">
                      {template.duration}
                    </span>
                  </div>

                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                    <h3 className="text-white font-semibold">{template.title}</h3>
                    <p className="text-foreground-secondary text-sm">{template.category}</p>
                  </div>
                </div>
                );
              })}
            </div>
          </TabsContent>

          {/* Transitions Tab */}
          <TabsContent value="transitions">
            {/* Category Filter */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {transitionCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setTransitionCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    transitionCategory === cat
                      ? 'bg-primary text-white'
                      : 'bg-background-secondary text-foreground-secondary border border-border hover:border-primary/50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredTransitions.map((transition) => (
                <TransitionCard key={transition.id} transition={transition} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Template Modal */}
      {selectedTemplate && (
        <TemplateModal
          template={selectedTemplate}
          onClose={() => setSelectedTemplate(null)}
          type={selectedTemplate.type}
        />
      )}
    </div>
  );
}