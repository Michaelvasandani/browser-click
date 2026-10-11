import { describe, expect, it } from 'vitest';
import { computeCrop, MAX_IMAGE_EDGE, MIN_SELECTION_PX } from './geometry';

const viewport = { width: 1000, height: 800 };

describe('computeCrop', () => {
  it('maps a rectangle 1:1 at device pixel ratio 1', () => {
    const crop = computeCrop({
      start: { x: 100, y: 50 },
      end: { x: 300, y: 250 },
      viewport,
      devicePixelRatio: 1,
    });
    expect(crop).toEqual({
      rect: { left: 100, top: 50, width: 200, height: 200 },
      source: { x: 100, y: 50, width: 200, height: 200 },
      output: { width: 200, height: 200 },
    });
  });

  it('scales the crop region to image pixels at device pixel ratio 2', () => {
    const crop = computeCrop({
      start: { x: 100, y: 50 },
      end: { x: 300, y: 250 },
      viewport,
      devicePixelRatio: 2,
    });
    expect(crop?.rect).toEqual({ left: 100, top: 50, width: 200, height: 200 });
    expect(crop?.source).toEqual({ x: 200, y: 100, width: 400, height: 400 });
    expect(crop?.output).toEqual({ width: 400, height: 400 });
  });

  it.each([
    ['top-left to bottom-right', { x: 100, y: 50 }, { x: 300, y: 250 }],
    ['bottom-right to top-left', { x: 300, y: 250 }, { x: 100, y: 50 }],
    ['top-right to bottom-left', { x: 300, y: 50 }, { x: 100, y: 250 }],
    ['bottom-left to top-right', { x: 100, y: 250 }, { x: 300, y: 50 }],
  ])('gives the same crop when drawn %s', (_name, start, end) => {
    const crop = computeCrop({ start, end, viewport, devicePixelRatio: 1 });
    expect(crop?.source).toEqual({ x: 100, y: 50, width: 200, height: 200 });
  });

  it('accepts a rectangle that touches every viewport edge', () => {
    const crop = computeCrop({
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 800 },
      viewport,
      devicePixelRatio: 1,
    });
    expect(crop?.source).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it('clamps a drag that ends outside the viewport to its edges', () => {
    const crop = computeCrop({
      start: { x: 900, y: 700 },
      end: { x: 1200, y: 950 },
      viewport,
      devicePixelRatio: 2,
    });
    expect(crop?.rect).toEqual({ left: 900, top: 700, width: 100, height: 100 });
    expect(crop?.source).toEqual({ x: 1800, y: 1400, width: 200, height: 200 });
  });

  it('clamps a drag that ends past the top-left corner', () => {
    const crop = computeCrop({
      start: { x: 50, y: 40 },
      end: { x: -20, y: -30 },
      viewport,
      devicePixelRatio: 1,
    });
    expect(crop?.source).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });

  it('ignores a drag of only a few pixels', () => {
    expect(
      computeCrop({ start: { x: 10, y: 10 }, end: { x: 13, y: 12 }, viewport, devicePixelRatio: 1 }),
    ).toBeNull();
  });

  it('ignores a long but very thin drag', () => {
    expect(
      computeCrop({ start: { x: 10, y: 10 }, end: { x: 500, y: 13 }, viewport, devicePixelRatio: 2 }),
    ).toBeNull();
  });

  it('accepts a drag exactly at the minimum size', () => {
    const crop = computeCrop({
      start: { x: 10, y: 10 },
      end: { x: 10 + MIN_SELECTION_PX, y: 10 + MIN_SELECTION_PX },
      viewport,
      devicePixelRatio: 1,
    });
    expect(crop).not.toBeNull();
  });

  it('measures the minimum size in CSS pixels, not image pixels', () => {
    // 5 CSS px is 10 image px at DPR 2: still a stray click.
    expect(
      computeCrop({ start: { x: 10, y: 10 }, end: { x: 15, y: 15 }, viewport, devicePixelRatio: 2 }),
    ).toBeNull();
  });

  it('scales a large selection so its long edge stays under the cap', () => {
    const crop = computeCrop({
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 800 },
      viewport,
      devicePixelRatio: 2,
    });
    expect(crop?.source).toEqual({ x: 0, y: 0, width: 2000, height: 1600 });
    expect(crop?.output.width).toBe(MAX_IMAGE_EDGE);
    expect(crop?.output.height).toBe(Math.round(1600 * (MAX_IMAGE_EDGE / 2000)));
  });

  it('scales a tall selection by its height', () => {
    const tall = { width: 1000, height: 3000 };
    const crop = computeCrop({
      start: { x: 0, y: 0 },
      end: { x: 500, y: 3000 },
      viewport: tall,
      devicePixelRatio: 1,
    });
    expect(crop?.output.height).toBe(MAX_IMAGE_EDGE);
    expect(crop?.output.width).toBe(Math.round(500 * (MAX_IMAGE_EDGE / 3000)));
  });

  it('does not scale up a small selection', () => {
    const crop = computeCrop({
      start: { x: 0, y: 0 },
      end: { x: 40, y: 30 },
      viewport,
      devicePixelRatio: 1,
    });
    expect(crop?.output).toEqual({ width: 40, height: 30 });
  });

  it('rounds fractional pixel positions without leaving the image', () => {
    const crop = computeCrop({
      start: { x: 0.4, y: 0.6 },
      end: { x: 999.7, y: 799.5 },
      viewport,
      devicePixelRatio: 1.5,
    });
    const { source } = crop!;
    expect(source.x).toBeGreaterThanOrEqual(0);
    expect(source.y).toBeGreaterThanOrEqual(0);
    expect(source.x + source.width).toBeLessThanOrEqual(1500);
    expect(source.y + source.height).toBeLessThanOrEqual(1200);
    expect(Number.isInteger(source.width)).toBe(true);
  });
});
