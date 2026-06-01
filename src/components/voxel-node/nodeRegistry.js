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
    category: 'Text',
    icon: 'Type',
    inputs: [],
    outputs: [{ id: 'text', type: 'text' }],
    defaultSettings: { value: '' },
    runnable: false,
  },
  'image-generator': {
    type: 'image-generator',
    label: 'Image Generator',
    category: 'Image',
    icon: 'Image',
    // Allow-list mirrored server-side (NODE_IMAGE_MODELS). The server
    // resolves the chosen label → FAL endpoint, so this is just the UI list.
    models: ['Flux Dev', 'Flux Schnell', 'Flux Pro Ultra', 'Seedream 4', 'Ideogram v3', 'Recraft v3', 'Nano Banana'],
    inputs: [{ id: 'prompt', type: 'text' }],
    outputs: [{ id: 'image', type: 'image' }],
    defaultSettings: { model: 'Flux Dev', image_size: 'landscape_16_9' },
    runnable: true,
    cost: 2, // display-only; the server computes the real charge
  },
};

export const NODE_LIST = Object.values(NODE_DEFS);

export function getNodeDef(type) {
  return NODE_DEFS[type] || null;
}
