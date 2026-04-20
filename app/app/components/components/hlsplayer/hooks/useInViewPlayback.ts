import { useEffect, type RefObject } from 'react';

function isRemotePlaybackActive(video: HTMLVideoElement): boolean {
  if ((video as unknown as { webkitCurrentPlaybackTargetIsWireless?: boolean }).webkitCurrentPlaybackTargetIsWireless)
    return true;
  if ((video as unknown as { remote?: { state?: string } }).remote?.state === 'connected') return true;
  return false;
}

/**
 * When enabled, plays the video while the player container is sufficiently visible in the viewport
 * and pauses when it is not (feeds, carousels). Skips muting / autoplay policy handling —
 * use with muted or after user gesture as appropriate.
 *
 * Retries attaching the observer if `containerRef` is not yet populated (first paint / portals).
 */
export function useInViewPlayback(
  enabled: boolean,
  containerRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  options?: { amount?: number; rootMargin?: string },
) {
  const amount = options?.amount ?? 0.55;
  const rootMargin = options?.rootMargin;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    let attempts = 0;
    const maxAttachAttempts = 120;

    const thresholds = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1];

    const startObserver = (root: HTMLElement) => {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          const video = videoRef.current;
          if (!video) return;
          if (isRemotePlaybackActive(video)) return;

          const visibleEnough = entry.isIntersecting && entry.intersectionRatio >= amount;
          if (visibleEnough) {
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        },
        { root: null, rootMargin, threshold: thresholds },
      );
      observer.observe(root);
    };

    const tryAttach = () => {
      if (cancelled) return;
      const root = containerRef.current;
      if (!root) {
        attempts += 1;
        if (attempts < maxAttachAttempts) {
          requestAnimationFrame(tryAttach);
        }
        return;
      }
      startObserver(root);
    };

    tryAttach();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [enabled, containerRef, videoRef, amount, rootMargin]);
}
