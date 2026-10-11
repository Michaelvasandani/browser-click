/**
 * Selection geometry: turns the rectangle the user drew (in CSS pixels) into
 * the region to crop from the captured tab image (in image pixels) and the
 * size to scale that region to before it is sent to the model.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CropInput {
  /** Where the drag started, in viewport CSS pixels. */
  start: Point;
  /** Where the drag ended, in viewport CSS pixels. May lie outside the viewport. */
  end: Point;
  /** Viewport size in CSS pixels. */
  viewport: Size;
  /** Image pixels per CSS pixel in the captured still. */
  devicePixelRatio: number;
}

export interface Crop {
  /** The selected rectangle in viewport CSS pixels, clamped to the viewport. */
  rect: { left: number; top: number; width: number; height: number };
  /** The region of the captured image to crop, in image pixels. */
  source: { x: number; y: number; width: number; height: number };
  /** The size of the image to send, after scaling down large Selections. */
  output: Size;
}

/** Drags narrower or shorter than this (CSS px) are treated as stray clicks. */
export const MIN_SELECTION_PX = 8;

/**
 * Long-edge cap for images sent to the model. Anthropic's vision guidance
 * resizes images whose long edge exceeds 1568px, so sending more only costs
 * upload time.
 */
export const MAX_IMAGE_EDGE = 1568;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function computeCrop({ start, end, viewport, devicePixelRatio }: CropInput): Crop | null {
  const left = clamp(Math.min(start.x, end.x), 0, viewport.width);
  const right = clamp(Math.max(start.x, end.x), 0, viewport.width);
  const top = clamp(Math.min(start.y, end.y), 0, viewport.height);
  const bottom = clamp(Math.max(start.y, end.y), 0, viewport.height);
  const width = right - left;
  const height = bottom - top;

  if (width < MIN_SELECTION_PX || height < MIN_SELECTION_PX) return null;

  const imageWidth = Math.round(viewport.width * devicePixelRatio);
  const imageHeight = Math.round(viewport.height * devicePixelRatio);
  const x = clamp(Math.round(left * devicePixelRatio), 0, imageWidth - 1);
  const y = clamp(Math.round(top * devicePixelRatio), 0, imageHeight - 1);
  const sourceWidth = clamp(Math.round(right * devicePixelRatio), x + 1, imageWidth) - x;
  const sourceHeight = clamp(Math.round(bottom * devicePixelRatio), y + 1, imageHeight) - y;

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));

  return {
    rect: { left, top, width, height },
    source: { x, y, width: sourceWidth, height: sourceHeight },
    output: {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    },
  };
}
