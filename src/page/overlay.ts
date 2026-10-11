import { computeCrop, type Crop, type Point } from '@/lib/geometry';

/** A cropped region of the captured still, ready to show and send. */
export interface CapturedImage {
  /** PNG or JPEG data URL of the cropped, scaled image. */
  dataUrl: string;
  mediaType: 'image/png' | 'image/jpeg';
  /** Base64 payload of `dataUrl`. */
  data: string;
  /** Where the Selection was drawn, in viewport CSS pixels. */
  rect: Crop['rect'];
}

// Stay well under the API's 5 MB per-image limit.
const MAX_IMAGE_BYTES = 3_500_000;

const OVERLAY_CSS = `
  :host { all: initial; }
  .overlay {
    position: fixed; inset: 0; z-index: 2147483647;
    cursor: crosshair; user-select: none; touch-action: none;
  }
  .still { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .shade { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.25); }
  .rect {
    position: absolute; display: none;
    outline: 2px solid #d97757; outline-offset: 0;
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
  }
  .hint {
    position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
    font: 13px/1.4 system-ui, sans-serif; color: #fff; background: rgba(20, 20, 20, 0.85);
    padding: 6px 12px; border-radius: 6px; pointer-events: none;
  }
`;

const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Shows the captured still over the page and lets the user draw a rectangle on
 * it. Resolves with the cropped Selection image, or null if the user pressed Esc.
 * The page cannot scroll while this is open, so the still and the page stay aligned.
 */
export async function runSelectionMode(stillDataUrl: string): Promise<CapturedImage | null> {
  const still = new Image();
  still.src = stillDataUrl;
  await still.decode();

  const host = document.createElement('browser-click-overlay');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  still.className = 'still';
  still.draggable = false;
  const shade = document.createElement('div');
  shade.className = 'shade';
  const rectEl = document.createElement('div');
  rectEl.className = 'rect';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Drag over the part you want to ask about · Esc to cancel';
  overlay.append(still, shade, rectEl, hint);
  root.append(style, overlay);
  document.documentElement.append(host);

  return new Promise((resolve) => {
    let start: Point | null = null;

    const viewport = () => ({ width: overlay.clientWidth, height: overlay.clientHeight });
    const cropFor = (end: Point) =>
      start &&
      computeCrop({
        start,
        end,
        viewport: viewport(),
        // Measured from the still itself, so browser zoom is accounted for.
        devicePixelRatio: still.naturalWidth / viewport().width,
      });

    const blockScroll = (event: Event) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(null);
      } else if (SCROLL_KEYS.has(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      start = { x: event.clientX, y: event.clientY };
      hint.style.display = 'none';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!start) return;
      const crop = cropFor({ x: event.clientX, y: event.clientY });
      if (!crop) {
        rectEl.style.display = 'none';
        shade.style.display = '';
        return;
      }
      shade.style.display = 'none';
      Object.assign(rectEl.style, {
        display: 'block',
        left: `${crop.rect.left}px`,
        top: `${crop.rect.top}px`,
        width: `${crop.rect.width}px`,
        height: `${crop.rect.height}px`,
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!start) return;
      const crop = cropFor({ x: event.clientX, y: event.clientY });
      start = null;
      if (!crop) {
        // A stray click: stay in Selection Mode.
        rectEl.style.display = 'none';
        shade.style.display = '';
        hint.style.display = '';
        return;
      }
      finish(cropImage(still, crop));
    };

    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('contextmenu', blockScroll);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', blockScroll, { capture: true, passive: false });
    window.addEventListener('touchmove', blockScroll, { capture: true, passive: false });

    function finish(result: CapturedImage | null) {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', blockScroll, true);
      window.removeEventListener('touchmove', blockScroll, true);
      host.remove();
      resolve(result);
    }
  });
}

function cropImage(still: HTMLImageElement, crop: Crop): CapturedImage {
  const canvas = document.createElement('canvas');
  canvas.width = crop.output.width;
  canvas.height = crop.output.height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const { x, y, width, height } = crop.source;
  ctx.drawImage(still, x, y, width, height, 0, 0, crop.output.width, crop.output.height);

  let mediaType: CapturedImage['mediaType'] = 'image/png';
  let dataUrl = canvas.toDataURL(mediaType);
  // Photos and video frames compress badly as PNG; fall back to JPEG when large.
  if (dataUrl.length * 0.75 > MAX_IMAGE_BYTES) {
    mediaType = 'image/jpeg';
    dataUrl = canvas.toDataURL(mediaType, 0.9);
  }
  return { dataUrl, mediaType, data: dataUrl.slice(dataUrl.indexOf(',') + 1), rect: crop.rect };
}
