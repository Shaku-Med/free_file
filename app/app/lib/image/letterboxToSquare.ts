import type { CanvasRenderingContext2D, Image } from 'canvas';

/** No CSS on the server; neutral dark fill aligned with typical app shell. */
export const SERVER_METADATA_SQUARE_BG = '#0a0a0a';

/** Square metadata thumbnails  same footprint as client media-session artwork (400×400). */
export const SERVER_METADATA_SQUARE_SIZE = 400;

/**
 * Letterboxes `image` into a `size`×`size` square on `ctx`, preserving aspect ratio.
 * Caller must create a `size`×`size` canvas before calling.
 * Mirrors client-side media session square artwork (fit inside, bars on sides or top/bottom).
 */
export function drawImageLetterboxedInSquare(
  ctx: CanvasRenderingContext2D,
  image: Image,
  size: number,
  qualityScale: number,
  background: string = SERVER_METADATA_SQUARE_BG
): void {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  const iw = image.width * qualityScale;
  const ih = image.height * qualityScale;
  if (iw <= 0 || ih <= 0) return;
  const fit = Math.min(size / iw, size / ih);
  const dw = Math.round(iw * fit);
  const dh = Math.round(ih * fit);
  const dx = Math.round((size - dw) / 2);
  const dy = Math.round((size - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, 0, 0, image.width, image.height, dx, dy, dw, dh);
}
