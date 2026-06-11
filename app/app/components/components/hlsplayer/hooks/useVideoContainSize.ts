import { useEffect, useState, type RefObject } from 'react';

/** Pixel size of a video fitted with object-contain inside a box. */
export function objectContainSize(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number,
): { width: number; height: number } {
  if (containerW <= 0 || containerH <= 0) return { width: 0, height: 0 };
  if (videoW <= 0 || videoH <= 0) return { width: containerW, height: containerH };
  const fit = Math.min(containerW / videoW, containerH / videoH);
  return { width: videoW * fit, height: videoH * fit };
}

/** Tracks the object-contain rect for the player shell (updates on resize + metadata). */
export function useVideoContainSize(
  containerRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!active) {
      setSize({ width: 0, height: 0 });
      return;
    }

    const update = () => {
      const container = containerRef.current;
      const video = videoRef.current;
      if (!container) return;
      const { clientWidth, clientHeight } = container;
      setSize(
        objectContainSize(clientWidth, clientHeight, video?.videoWidth ?? 0, video?.videoHeight ?? 0),
      );
    };

    update();
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(update);
    ro.observe(container);

    const video = videoRef.current;
    video?.addEventListener('loadedmetadata', update);
    video?.addEventListener('loadeddata', update);

    return () => {
      ro.disconnect();
      video?.removeEventListener('loadedmetadata', update);
      video?.removeEventListener('loadeddata', update);
    };
  }, [active, containerRef, videoRef]);

  return size;
}
