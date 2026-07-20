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
    outputs: [{ id: 'text', type: 'text', label: 'Text' }],
    defaultSettings: { value: '' },
    runnable: false,
  },
  // Uploaded image — a first-class "Creation" input node that exposes a
  // single image output port. The pixels live at settings.url (uploaded via
  // /api/upload); the same URL is mirrored into data.outputs.image so the
  // store's resolveImageInput()/staleness logic treats it like any other
  // upstream image producer.
  image: {
    type: 'image',
    label: 'Image',
    category: 'Input',
    icon: 'Image',
    inputs: [],
    outputs: [{ id: 'image', type: 'image', label: 'Image' }],
    defaultSettings: { url: '', fileName: '' },
    runnable: false,
    upload: true,
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
    // Same catalog as the main Image page (Voxel_Plans_and_Credits.xlsx,
    // all kie.ai-backed — server resolves each via MODEL_CONFIG).
    models: ['Nano Banana Pro', 'Nano Banana 2', 'GPT Image 2', 'Seedream 5.0 Lite'],
    // `image` is a REFERENCE input: a connected image triggers image-to-image
    // / edit on the server (TYPE_COMPAT lets an image output feed it).
    inputs: [
      { id: 'image', type: 'reference', label: 'References', multiple: true },
      { id: 'prompt', type: 'text', label: 'Prompt' },
    ],
    outputs: [{ id: 'image', type: 'image', label: 'Image' }],
    defaultSettings: { model: 'Nano Banana Pro', aspect_ratio: '1:1', quality: '1K' },
    runnable: true,
    cost: 2, // display-only; the server computes the real charge
  },
  voiceover: {
    type: 'voiceover',
    label: 'Voiceover',
    category: 'Audio',
    icon: 'Mic',
    inputs: [{ id: 'prompt', type: 'text', label: 'Prompt' }],
    outputs: [{ id: 'audio', type: 'audio', label: 'Audio' }],
    defaultSettings: { voice: 'Rachel' },
    runnable: true,
    cost: 1,
  },
  music: {
    type: 'music',
    label: 'Music',
    category: 'Audio',
    icon: 'Music',
    inputs: [{ id: 'prompt', type: 'text', label: 'Prompt' }],
    outputs: [{ id: 'audio', type: 'audio', label: 'Audio' }],
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
    // kie.ai-only catalog (Voxel_Plans_and_Credits.xlsx)
    models: ['Kling 3.0', 'Kling 2.6', 'Veo 3.1', 'Veo 3 Fast', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini'],
    inputs: [
      { id: 'image', type: 'image', label: 'Image refs', multiple: true },
      { id: 'prompt', type: 'text', label: 'Prompt' },
    ],
    outputs: [{ id: 'video', type: 'video', label: 'Video' }],
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
