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

/**
 * Below this player width the end-card overlay switches to a YouTube-mobile
 * style vertical stack of full-width horizontal cards. Above it we use a
 * centered pair of horizontal cards side by side. Independent from ControlBar's
 * mobile breakpoint.
 */
export const END_CARD_MOBILE_BREAKPOINT = 640;
/**
 * Above END_CARD_MOBILE_BREAKPOINT but with a player shorter than this, use
 * the landscape flanking side-by-side layout instead of the centered pair.
 */
export const END_CARD_LANDSCAPE_COMPACT_HEIGHT = 450;

export type EndCardOverlayVariant = "stack" | "sideBySide" | "centerPair";

export type EndCardOverlayLayout = {
  /**
   *  stack       : portrait phone  vertical column of full-width horiz cards
   *  sideBySide  : landscape phone  2 horiz cards left/right of a center gap
   *  centerPair  : tablet/desktop   2 horiz cards centered side by side
   */
  variant: EndCardOverlayVariant;
  /** Legacy boolean. Kept so existing checks (`layout.isMobile`) still work. */
  isMobile: boolean;
  maxCards: number;
  insetTopPx: number;
  insetBottomPx: number;
  /** Per-card width in px  applied via inline style (not dynamic Tailwind). */
  cardWidthPx: number;
  /** Horizontal-card variants only: each card's height. */
  cardHeightPx: number;
  /** Stack only: vertical gap between stacked cards. */
  cardGapPx: number;
  /** sideBySide only: width reserved between the two cards for the replay
   *  button (and breathing room). */
  centerReservePx: number;
};

/**
 * End-card geometry from the player box. Clearances mirror ControlBar zones;
 * card width scales up as the player grows. On narrow players (phones) we
 * render a YouTube-style stack of full-width horizontal cards instead of
 * the tiny two-column tiles the old layout produced.
 */
export function endCardOverlayLayout(
  playerW: number,
  playerH: number,
): EndCardOverlayLayout {
  const w = playerW > 0 ? playerW : 640;
  const h = playerH > 0 ? playerH : 360;

  const isNarrow = playerW > 0 && playerW < END_CARD_MOBILE_BREAKPOINT;
  const isShort = playerH > 0 && playerH < END_CARD_LANDSCAPE_COMPACT_HEIGHT;

  if (isNarrow) {
    const sideInsetPx = 8;
    const cardWidthPx = Math.max(240, Math.round(w - 2 * sideInsetPx));
    const thumbWidth = cardWidthPx * 0.36;
    const idealHeight = Math.round((thumbWidth * 9) / 16) + 14;
    const cardHeightPx = Math.max(88, Math.min(Math.round(h * 0.2), idealHeight));
    const cardGapPx = 8;
    const insetTopPx = Math.max(48, Math.round(h * 0.11));
    const insetBottomPx = Math.max(76, Math.round(h * 0.16));
    const availablePx = Math.max(0, h - insetTopPx - insetBottomPx);
    const fits = Math.floor(
      (availablePx + cardGapPx) / (cardHeightPx + cardGapPx),
    );
    const maxCards = Math.max(1, Math.min(2, fits || 1));

    return {
      variant: "stack",
      isMobile: true,
      maxCards,
      insetTopPx,
      insetBottomPx,
      cardWidthPx,
      cardHeightPx,
      cardGapPx,
      centerReservePx: 0,
    };
  }

  if (isShort) {
    const sideInsetPx = 6;
    const centerReservePx = Math.max(108, Math.round(w * 0.22));
    const sideBudget = Math.max(
      200,
      Math.round((w - centerReservePx - 2 * sideInsetPx - 12) / 2),
    );
    const cardWidthPx = Math.min(420, sideBudget);
    const thumbWidth = cardWidthPx * 0.4;
    const thumbHeight = Math.round((thumbWidth * 9) / 16);
    const topReservePx = 56;
    const bottomReservePx = 84;
    const verticalRoom = Math.max(88, h - topReservePx - bottomReservePx);
    const cardHeightPx = Math.max(
      88,
      Math.min(verticalRoom, thumbHeight + 18),
    );

    return {
      variant: "sideBySide",
      isMobile: true,
      maxCards: 2,
      insetTopPx: topReservePx,
      insetBottomPx: bottomReservePx,
      cardWidthPx,
      cardHeightPx,
      cardGapPx: 0,
      centerReservePx,
    };
  }

  const insetTopPx = Math.max(48, Math.round(h * 0.1));
  const insetBottomPx = Math.max(68, Math.round(h * 0.12));
  const cardGapPx = 16;
  const horizontalPad = 20;
  const perCardBudget = Math.max(
    220,
    Math.round((w - horizontalPad * 2 - cardGapPx) / 2),
  );
  const cardWidthPx = Math.min(460, Math.max(240, perCardBudget));
  const thumbWidth = cardWidthPx * 0.36;
  const idealHeight = Math.round((thumbWidth * 9) / 16) + 16;
  const cardHeightPx = Math.max(
    96,
    Math.min(Math.round(h * 0.34), idealHeight),
  );

  return {
    variant: "centerPair",
    isMobile: false,
    maxCards: 2,
    insetTopPx,
    insetBottomPx,
    cardWidthPx,
    cardHeightPx,
    cardGapPx,
    centerReservePx: 0,
  };
}
