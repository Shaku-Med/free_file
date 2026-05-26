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
 * Size a reel player shell to the video aspect ratio while fitting inside the viewport.
 * Portrait: height-led; landscape: width-led.
 */
export function reelVideoFrameStyle(
  aspectRatio: number,
  { maxHeight, maxWidth }: ReelVideoFrameOptions,
): CSSProperties {
  const ar = aspectRatio > 0 ? aspectRatio : REEL_FALLBACK_ASPECT;

  if (ar >= 1) {
    return {
      aspectRatio: ar,
      width: `min(${maxWidth}, calc(${maxHeight} * ${ar}))`,
      maxWidth,
      maxHeight,
      height: "auto",
    };
  }

  return {
    aspectRatio: ar,
    height: maxHeight,
    maxHeight,
    maxWidth,
    width: "auto",
  };
}
