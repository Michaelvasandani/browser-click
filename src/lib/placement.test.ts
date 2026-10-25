import { describe, expect, it } from 'vitest';
import { clampPanel, moveAside, placePanel } from './placement';

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

describe('moveAside', () => {
  const overlaps = (pos: { left: number; top: number }, t: { left: number; top: number; width: number; height: number }) =>
    pos.left < t.left + t.width && t.left < pos.left + panel.width && pos.top < t.top + t.height && t.top < pos.top + panel.height;
  const inside = (pos: { left: number; top: number }) =>
    pos.left >= 0 && pos.top >= 0 && pos.left + panel.width <= viewport.width && pos.top + panel.height <= viewport.height;

  it('leaves the Panel where it is when the Mark is not under it', () => {
    expect(moveAside({ left: 900, top: 100 }, panel, { left: 100, top: 200, width: 80, height: 30 }, viewport)).toEqual({
      left: 900,
      top: 100,
    });
  });

  it('moves the Panel the shortest way off a Mark under it, staying fully inside the window', () => {
    const target = { left: 1000, top: 200, width: 80, height: 30 };
    const pos = moveAside({ left: 900, top: 100 }, panel, target, viewport);
    // There is no room to the right or above; below is nearer than the left.
    expect(pos).toEqual({ left: 900, top: 200 + 30 + 12 });
    expect(overlaps(pos, target)).toBe(false);
    expect(inside(pos)).toBe(true);
  });

  it('moves the Panel sideways off a tall Mark', () => {
    const target = { left: 150, top: 50, width: 100, height: 800 };
    const pos = moveAside({ left: 100, top: 100 }, panel, target, viewport);
    expect(pos).toEqual({ left: 250 + 12, top: 100 });
    expect(inside(pos)).toBe(true);
  });

  it('also moves off a Mark that only comes close to its edge', () => {
    const target = { left: 1285, top: 200, width: 40, height: 40 };
    const pos = moveAside({ left: 900, top: 100 }, { width: 380, height: 500 }, target, viewport);
    expect(pos).not.toEqual({ left: 900, top: 100 });
  });

  it('stays inside the window when no place clears the Mark, covering as little of it as it can', () => {
    const target = { left: 150, top: 0, width: 1000, height: 900 };
    const pos = moveAside({ left: 500, top: 100 }, panel, target, viewport);
    expect(inside(pos)).toBe(true);
    // Pushed to the edge with the least overlap: here the right edge.
    expect(pos.left).toBe(1400 - 380);
  });
});
