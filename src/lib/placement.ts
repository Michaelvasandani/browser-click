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

/** Keep the Panel fully on screen (top-left wins when it does not fit). */
export function clampPanel(position: Position, viewport: Size, panel: Size): Position {
  return {
    left: Math.max(0, Math.min(position.left, viewport.width - panel.width)),
    top: Math.max(0, Math.min(position.top, viewport.height - panel.height)),
  };
}
