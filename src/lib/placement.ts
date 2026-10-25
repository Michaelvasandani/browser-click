import type { Size } from './geometry';

export interface Position {
  left: number;
  top: number;
}

const GAP = 12;

/** Where to open the Panel so it sits next to the Selection without covering it. */
export function placePanel(
  selection: { left: number; top: number; width: number; height: number },
  viewport: Size,
  panel: Size,
): Position {
  const rightSide = selection.left + selection.width + GAP;
  const leftSide = selection.left - GAP - panel.width;
  let left: number;
  if (rightSide + panel.width + GAP <= viewport.width) left = rightSide;
  else if (leftSide >= GAP) left = leftSide;
  else left = viewport.width - GAP - panel.width;

  const top = Math.min(selection.top, viewport.height - GAP - panel.height);
  return clampPanel({ left, top: Math.max(GAP, top) }, viewport, panel);
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where to move the Panel so a Mark's target is not under it. The Panel moves
 * the shortest way to the right, left, below or above the target, always
 * staying fully inside the window. When no such place clears the target, it
 * goes where it covers the least of it. A Panel already clear stays put.
 */
export function moveAside(position: Position, panel: Size, target: Rect, viewport: Size): Position {
  // Keep a little space around the target, so the Panel doesn't touch it.
  const avoid = { left: target.left - GAP, top: target.top - GAP, width: target.width + GAP * 2, height: target.height + GAP * 2 };
  if (overlapArea(position, panel, avoid) === 0) return position;
  const candidates = [
    { left: avoid.left + avoid.width, top: position.top },
    { left: avoid.left - panel.width, top: position.top },
    { left: position.left, top: avoid.top + avoid.height },
    { left: position.left, top: avoid.top - panel.height },
  ].map((candidate) => clampPanel(candidate, viewport, panel));
  const score = (candidate: Position) => ({
    covered: overlapArea(candidate, panel, target),
    distance: Math.hypot(candidate.left - position.left, candidate.top - position.top),
  });
  return candidates.reduce((best, candidate) => {
    const [a, b] = [score(candidate), score(best)];
    return a.covered < b.covered || (a.covered === b.covered && a.distance < b.distance) ? candidate : best;
  });
}

function overlapArea(position: Position, panel: Size, rect: Rect): number {
  const width = Math.min(position.left + panel.width, rect.left + rect.width) - Math.max(position.left, rect.left);
  const height = Math.min(position.top + panel.height, rect.top + rect.height) - Math.max(position.top, rect.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Keep the Panel fully on screen (top-left wins when it does not fit). */
export function clampPanel(position: Position, viewport: Size, panel: Size): Position {
  return {
    left: Math.max(0, Math.min(position.left, viewport.width - panel.width)),
    top: Math.max(0, Math.min(position.top, viewport.height - panel.height)),
  };
}
