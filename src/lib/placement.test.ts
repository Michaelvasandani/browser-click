import { describe, expect, it } from 'vitest';
import { clampPanel, placePanel } from './placement';

const viewport = { width: 1400, height: 900 };
const panel = { width: 380, height: 500 };

describe('placePanel', () => {
  it('opens to the right of the Selection when there is room', () => {
    const pos = placePanel({ left: 100, top: 200, width: 300, height: 100 }, viewport, panel);
    expect(pos).toEqual({ left: 100 + 300 + 12, top: 200 });
  });

  it('opens to the left when the right side is too narrow', () => {
    const pos = placePanel({ left: 900, top: 200, width: 300, height: 100 }, viewport, panel);
    expect(pos).toEqual({ left: 900 - 12 - 380, top: 200 });
  });

  it('falls back to the right edge when neither side has room', () => {
    const pos = placePanel({ left: 300, top: 200, width: 800, height: 100 }, viewport, panel);
    expect(pos.left).toBe(1400 - 12 - 380);
  });

  it('keeps the Panel inside the viewport vertically', () => {
    const pos = placePanel({ left: 100, top: 800, width: 300, height: 90 }, viewport, panel);
    expect(pos.top).toBe(900 - 12 - 500);
  });
});

describe('clampPanel', () => {
  it('keeps a dragged Panel on screen', () => {
    expect(clampPanel({ left: -50, top: -20 }, viewport, panel)).toEqual({ left: 0, top: 0 });
    expect(clampPanel({ left: 1300, top: 850 }, viewport, panel)).toEqual({ left: 1020, top: 400 });
  });

  it('pins a Panel taller than the viewport to the top', () => {
    expect(clampPanel({ left: 10, top: 50 }, { width: 1400, height: 300 }, panel)).toEqual({ left: 10, top: 0 });
  });
});
