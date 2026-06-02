import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// Returns whether a control should render in "light" colors (text-white on a
// dark background) or "dark" colors (text-black on a bright background) based
// on what's behind it in the source image. Samples pixels with a tiny shared
// canvas, computes WCAG relative luminance, flips at the threshold.
//
// Image must be same-origin or CORS-enabled (`<img crossorigin="anonymous">`).
// Tainted-canvas reads silently fall back to defaultTone.

export type Tone = "light" | "dark";

export interface UseAdaptiveToneOptions {
  /** The image we sample from. */
  imageRef: RefObject<HTMLImageElement | null>;
  /** The element whose viewport rect tells us what to sample. */
  targetRef: RefObject<HTMLElement | null>;
  /** Tone when we cannot sample (no overlap, image not loaded, tainted). */
  defaultTone?: Tone;
  /** Change this to force a re-sample (zoom state, pan offset, etc.). */
  trigger?: unknown;
  /** Sub-image resolution to read; smaller = faster, less accurate. Default 16. */
  sampleSize?: number;
  /**
   * Luminance pivot for the light/dark decision (0..1). Default 0.18 is the
   * WCAG crossover where white-on-bg and black-on-bg have equal contrast
   * picks the higher-contrast tone for ANY color, not just near-white. Raise
   * toward 0.5 to bias more controls toward white.
   */
  threshold?: number;
}

const sharedCanvas =
  typeof document !== "undefined" ? document.createElement("canvas") : null;

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// WCAG relative luminance.
function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function useAdaptiveTone(opts: UseAdaptiveToneOptions): Tone {
  const {
    imageRef,
    targetRef,
    defaultTone = "light",
    trigger,
    sampleSize = 16,
    threshold = 0.18,
  } = opts;

  const [tone, setTone] = useState<Tone>(defaultTone);
  const rafRef = useRef<number>(0);

  const sample = useCallback(() => {
    if (!sharedCanvas) return;
    const img = imageRef.current;
    const target = targetRef.current;
    if (!img || !target) return;
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return;

    const imgRect = img.getBoundingClientRect();
    const tgtRect = target.getBoundingClientRect();

    // Intersect the control with the rendered image  if there's no overlap
    // the control is over the page chrome, not the image. Keep current tone.
    const ix1 = Math.max(imgRect.left, tgtRect.left);
    const iy1 = Math.max(imgRect.top, tgtRect.top);
    const ix2 = Math.min(imgRect.right, tgtRect.right);
    const iy2 = Math.min(imgRect.bottom, tgtRect.bottom);
    if (ix2 <= ix1 || iy2 <= iy1) return;

    // Map the intersection from rendered space to the image's natural pixels.
    const sxScale = img.naturalWidth / imgRect.width;
    const syScale = img.naturalHeight / imgRect.height;
    const sx = (ix1 - imgRect.left) * sxScale;
    const sy = (iy1 - imgRect.top) * syScale;
    const sw = (ix2 - ix1) * sxScale;
    const sh = (iy2 - iy1) * syScale;
    if (sw < 1 || sh < 1) return;

    sharedCanvas.width = sampleSize;
    sharedCanvas.height = sampleSize;
    const ctx = sharedCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    try {
      ctx.clearRect(0, 0, sampleSize, sampleSize);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sampleSize, sampleSize);
      const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);
      let sum = 0;
      const count = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        // Skip fully transparent pixels (the control could overlap a corner
        // of a PNG with alpha).
        if (data[i + 3] === 0) continue;
        sum += relLuminance(data[i], data[i + 1], data[i + 2]);
      }
      const avg = sum / count;
      setTone(avg < threshold ? "light" : "dark");
    } catch {
      // Tainted canvas (cross-origin): keep current tone.
    }
  }, [imageRef, targetRef, sampleSize, threshold]);

  useEffect(() => {
    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(sample);
    };

    schedule();

    const img = imageRef.current;
    const onLoad = () => schedule();
    img?.addEventListener("load", onLoad);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });

    return () => {
      cancelAnimationFrame(rafRef.current);
      img?.removeEventListener("load", onLoad);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, [sample, trigger]);

  return tone;
}
