import { useState, useLayoutEffect, type RefObject } from "react";

/** Tracks the HLS player shell size (the element with `containerRef`)  not the viewport. */
export function usePlayerContainerSize(containerRef: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setSize((prev) =>
          prev.width === r.width && prev.height === r.height
            ? prev
            : { width: r.width, height: r.height },
        );
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [containerRef]);

  return size;
}

/** Matches ControlBar mobile breakpoint (`isMobileLayout`). */
export const END_CARD_MOBILE_BREAKPOINT = 480;

export type EndCardOverlayLayout = {
  isMobile: boolean;
  maxCards: number;
  insetTopPx: number;
  insetBottomPx: number;
  /** Card slot width in px  always applied via inline style (not dynamic Tailwind). */
  cardWidthPx: number;
};

/**
 * End-card geometry from the player box. Clearances mirror ControlBar zones;
 * card width scales up as the player grows.
 */
export function endCardOverlayLayout(
  playerW: number,
  playerH: number,
): EndCardOverlayLayout {
  const w = playerW > 0 ? playerW : 640;
  const h = playerH > 0 ? playerH : 360;
  const isMobile = playerW > 0 && playerW < END_CARD_MOBILE_BREAKPOINT;

  if (isMobile) {
    const insetTopPx = Math.max(48, Math.round(h * 0.11));
    const insetBottomPx = Math.max(92, Math.round(h * 0.2));
    const centerReservePx = Math.max(80, Math.round(w * 0.22));
    const sideBudget = Math.max(88, (w - centerReservePx - 12) / 2);
    const cardWidthPx = Math.round(Math.min(w * 0.36, sideBudget));

    return {
      isMobile: true,
      maxCards: 2,
      insetTopPx,
      insetBottomPx,
      cardWidthPx,
    };
  }

  const insetTopPx = Math.max(8, Math.round(h * 0.03));
  const insetBottomPx = Math.max(76, Math.round(h * 0.16));

  let pct: number;
  let minPx: number;
  let maxPx: number;
  if (w < 720) {
    pct = 0.28;
    minPx = 120;
    maxPx = 232;
  } else if (w < 1100) {
    pct = 0.24;
    minPx = 152;
    maxPx = 280;
  } else if (w < 1600) {
    pct = 0.21;
    minPx = 176;
    maxPx = 320;
  } else {
    pct = 0.19;
    minPx = 192;
    maxPx = 352;
  }
  const cardWidthPx = Math.round(
    Math.min(maxPx, Math.max(minPx, w * pct)),
  );

  return {
    isMobile: false,
    maxCards: 4,
    insetTopPx,
    insetBottomPx,
    cardWidthPx,
  };
}
