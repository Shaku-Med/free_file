import type { CSSProperties } from "react";

/** Vertical short-form default until intrinsic video size is known. */
export const REEL_FALLBACK_ASPECT = 9 / 16;

export function readVideoAspectRatio(
  width: number,
  height: number,
): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
}

export interface ReelVideoFrameOptions {
  maxHeight: string;
  maxWidth: string;
}

/**
 * Size a reel player shell to the video aspect ratio while fitting inside the
 * given box: as wide as the box allows, or as the height cap allows, whichever
 * is smaller. One rule for portrait and landscape, so the frame always keeps
 * the video's shape.
 */
export function reelVideoFrameStyle(
  aspectRatio: number,
  { maxHeight, maxWidth }: ReelVideoFrameOptions,
): CSSProperties {
  const ar = aspectRatio > 0 ? aspectRatio : REEL_FALLBACK_ASPECT;
  return {
    aspectRatio: ar,
    width: `min(${maxWidth}, calc(${maxHeight} * ${ar}))`,
    height: "auto",
  };
}
