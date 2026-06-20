// Voxel Node — node registry (P0-P2 slice: Text + Image Generator).
// Each definition declares typed ports, default settings, and (for
// provider nodes) the node `type` the backend maps to a FAL model.
// The FAL model id itself lives SERVER-SIDE (server/src/index.js
// NODE_RUN_MODELS) so the browser can't repoint a node at an arbitrary
// model. See spec §8/§9.

export const NODE_DEFS = {
  text: {
    type: 'text',
    label: 'Text',
    category: 'Input',
    icon: 'Type',
    inputs: [],
    outputs: [{ id: 'text', type: 'text' }],
    defaultSettings: { value: '' },
    runnable: false,
  },
  'sticky-note': {
    type: 'sticky-note',
    label: 'Sticky Note',
    category: 'Utilities',
    icon: 'StickyNote',
    inputs: [],
    outputs: [],
    defaultSettings: { value: '', color: '#F5C84B' },
    runnable: false,
    ui: true, // pure annotation node, no ports / no run
  },
  'image-generator': {
    type: 'image-generator',
    label: 'Image Generator',
    category: 'Image',
    icon: 'Image',
    // Same model names as the main Image page (server resolves each to its
    // proven FAL endpoint via MODEL_CONFIG). The server is the source of
    // truth for the FAL model id.
    models: ['Nano Banana Pro', 'Nano Banana 2', 'GPT Image 2', 'GPT Image 1.5', 'Seedream 4.5', 'Seedream 5.0 Lite', 'Soul 2.0', 'Flux Kontext', 'Flux 2', 'Wan 2.2 Image'],
    inputs: [{ id: 'prompt', type: 'text' }],
    outputs: [{ id: 'image', type: 'image' }],
    defaultSettings: { model: 'Nano Banana Pro', aspect_ratio: '1:1', quality: '1K' },
    runnable: true,
    cost: 2, // display-only; the server computes the real charge
  },
  voiceover: {
    type: 'voiceover',
    label: 'Voiceover',
    category: 'Audio',
    icon: 'Mic',
    inputs: [{ id: 'prompt', type: 'text' }],
    outputs: [{ id: 'audio', type: 'audio' }],
    defaultSettings: { voice: 'Rachel' },
    runnable: true,
    cost: 1,
  },
  music: {
    type: 'music',
    label: 'Music',
    category: 'Audio',
    icon: 'Music',
    inputs: [{ id: 'prompt', type: 'text' }],
    outputs: [{ id: 'audio', type: 'audio' }],
    defaultSettings: {},
    runnable: true,
    cost: 1,
  },
  'video-generator': {
    type: 'video-generator',
    label: 'Video Generator',
    category: 'Video',
    icon: 'Video',
    // Accepts either a text prompt OR an upstream image (start frame).
    // When an image is connected the server runs image-to-video. Model
    // names match the main Video page (server resolves via VIDEO_DIRECT_MAP).
    models: ['Kling 3.0', 'Kling 2.6', 'Veo 3.1', 'Wan 2.6', 'Seedance 2.0', 'Hailuo 2.3', 'PixVerse 5', 'Sora 2', 'Luma Dream Machine'],
    inputs: [
      { id: 'prompt', type: 'text' },
      { id: 'image', type: 'image' },
    ],
    outputs: [{ id: 'video', type: 'video' }],
    defaultSettings: { model: 'Kling 3.0', duration: 5, aspect_ratio: '16:9' },
    runnable: true,
    async: true, // queue + poll, not synchronous
    cost: 20, // display-only; server computes the real charge
  },
};

export const NODE_LIST = Object.values(NODE_DEFS);

export function getNodeDef(type) {
  return NODE_DEFS[type] || null;
}
