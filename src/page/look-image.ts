import type { CaptureResponse } from '@/lib/messages';

/** Claude sees images at about this long edge anyway; larger only costs bytes. */
const MAX_LONG_EDGE = 1568;
const JPEG_QUALITIES = [0.8, 0.6, 0.45];

/**
 * Scales a captured still of the tab down to the viewport's CSS size (or less)
 * and re-encodes it as JPEG until its base64 fits in `maxChars`, so a look
 * image fits in one native message.
 */
export async function shrinkStill(stillDataUrl: string, viewportWidth: number, maxChars: number): Promise<CaptureResponse> {
  const still = new Image();
  still.src = stillDataUrl;
  await still.decode();
  const { naturalWidth, naturalHeight } = still;
  let scale = Math.min(1, viewportWidth / naturalWidth, MAX_LONG_EDGE / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement('canvas');
  for (let attempt = 0; attempt < 4; attempt++, scale /= 2) {
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(still, 0, 0, canvas.width, canvas.height);
    for (const quality of JPEG_QUALITIES) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length - dataUrl.indexOf(',') - 1 <= maxChars) return { ok: true, dataUrl };
    }
  }
  return { ok: false, error: 'The image was too large to send.' };
}
