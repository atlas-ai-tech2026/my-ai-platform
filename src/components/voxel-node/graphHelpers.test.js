import { describe, it, expect } from 'vitest';
import { validateConnection, canConnectPorts, getPort } from './graphHelpers';

// Minimal graph: an Image upload node, an Image Generator, a Video Generator,
// and a Text node — exercising real registry port definitions.
const nodes = [
  { id: 'img1', data: { nodeType: 'image' } },           // out: image
  { id: 'gen1', data: { nodeType: 'image-generator' } }, // in: prompt(text), image(reference) | out: image
  { id: 'gen2', data: { nodeType: 'image-generator' } }, // same shape — used for cycle test
  { id: 'vid1', data: { nodeType: 'video-generator' } }, // in: prompt(text), image(image) | out: video
  { id: 'txt1', data: { nodeType: 'text' } },            // out: text
];

const conn = (source, sourceHandle, target, targetHandle) => ({ source, sourceHandle, target, targetHandle });

describe('getPort', () => {
  it('resolves typed output/input descriptors from the registry', () => {
    expect(getPort(nodes[0], 'image', 'output')).toMatchObject({ direction: 'output', dataType: 'image' });
    expect(getPort(nodes[1], 'image', 'input')).toMatchObject({ direction: 'input', dataType: 'reference', label: 'Reference' });
  });
});

describe('validateConnection', () => {
  it('accepts a compatible image → reference connection', () => {
    const r = validateConnection(nodes, [], conn('img1', 'image', 'gen1', 'image'));
    expect(r.ok).toBe(true);
  });

  it('accepts image → video start-frame (same type)', () => {
    expect(validateConnection(nodes, [], conn('img1', 'image', 'vid1', 'image')).ok).toBe(true);
  });

  it('rejects an incompatible image → text(prompt) connection', () => {
    const r = validateConnection(nodes, [], conn('img1', 'image', 'gen1', 'prompt'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/image output → text input/i);
  });

  it('rejects a self-loop', () => {
    const r = validateConnection(nodes, [], conn('gen1', 'image', 'gen1', 'image'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/itself/i);
  });

  it('rejects a cycle (same-type back-edge)', () => {
    // gen1.image → gen2.image already exists (image → reference, valid).
    // Adding gen2.image → gen1.image would close the loop.
    const edges = [{ source: 'gen1', sourceHandle: 'image', target: 'gen2', targetHandle: 'image' }];
    const r = validateConnection(nodes, edges, conn('gen2', 'image', 'gen1', 'image'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/loop/i);
  });

  it('rejects a second edge into a full single-connection input', () => {
    const edges = [{ source: 'img1', sourceHandle: 'image', target: 'gen1', targetHandle: 'image' }];
    const r = validateConnection(nodes, edges, conn('img1', 'image', 'gen1', 'image'));
    expect(r.ok).toBe(false);
  });

  it('canConnectPorts is the boolean wrapper', () => {
    expect(canConnectPorts(nodes, [], conn('img1', 'image', 'gen1', 'image'))).toBe(true);
    expect(canConnectPorts(nodes, [], conn('img1', 'image', 'gen1', 'prompt'))).toBe(false);
  });
});
