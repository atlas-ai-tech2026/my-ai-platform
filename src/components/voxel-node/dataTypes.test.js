import { describe, it, expect } from 'vitest';
import { canConnect, typesCompatible, PORT_COLORS, typeColor } from './dataTypes';

const out = (dataType, extra = {}) => ({ direction: 'output', dataType, ...extra });
const inp = (dataType, extra = {}) => ({ direction: 'input', dataType, ...extra });

describe('typesCompatible', () => {
  it('matches identical types', () => {
    expect(typesCompatible('image', 'image')).toBe(true);
    expect(typesCompatible('text', 'text')).toBe(true);
  });
  it('uses the compatibility table (image → reference)', () => {
    expect(typesCompatible('image', 'reference')).toBe(true);
    expect(typesCompatible('image', 'mask')).toBe(true);
  });
  it('rejects unrelated types', () => {
    expect(typesCompatible('image', 'text')).toBe(false);
    expect(typesCompatible('audio', 'video')).toBe(false);
  });
  it('rejects missing types', () => {
    expect(typesCompatible(null, 'image')).toBe(false);
    expect(typesCompatible('image', undefined)).toBe(false);
  });
});

describe('canConnect (port-level)', () => {
  it('accepts output → input of the same type', () => {
    expect(canConnect(out('image'), inp('image')).ok).toBe(true);
  });
  it('accepts a compatible type (image output → reference input)', () => {
    expect(canConnect(out('image'), inp('reference')).ok).toBe(true);
  });
  it('rejects incompatible types with a helpful reason', () => {
    const r = canConnect(out('image'), inp('text'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/image output → text input/i);
  });
  it('rejects output → output', () => {
    expect(canConnect(out('image'), out('image')).ok).toBe(false);
  });
  it('rejects input → input (must start from an output)', () => {
    expect(canConnect(inp('image'), inp('image')).ok).toBe(false);
  });
  it('rejects when a port is missing', () => {
    expect(canConnect(null, inp('image')).ok).toBe(false);
    expect(canConnect(out('image'), null).ok).toBe(false);
  });
});

describe('PORT_COLORS', () => {
  it('is the single source of truth for type colors', () => {
    expect(PORT_COLORS.image).toBeTruthy();
    expect(typeColor('image')).toBe(PORT_COLORS.image);
    expect(typeColor('does-not-exist')).toBe('#878787');
  });
});
