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
 * style vertical stack of full-width horizontal cards. Above it we keep the
 * four-corner desktop layout. This is independent from ControlBar's own
 * mobile breakpoint  controls and end-cards can change at different widths.
 */
export const END_CARD_MOBILE_BREAKPOINT = 640;
/**
 * Above END_CARD_MOBILE_BREAKPOINT but with a player shorter than this, the
 * 4-corner desktop layout can't fit without clobbering the top control row
 * (HD badge / theater / PiP / settings). We switch to a side-by-side layout
 * centered vertically in the safe band  same call YouTube makes on
 * landscape phone.
 */
export const END_CARD_LANDSCAPE_COMPACT_HEIGHT = 450;

export type EndCardOverlayVariant = "stack" | "sideBySide" | "corners";

export type EndCardOverlayLayout = {
  /**
   *  stack       : portrait phone  vertical column of full-width horiz cards
   *  sideBySide  : landscape phone  2 horiz cards left/right of a center gap
   *  corners     : tablet/desktop   4 tile cards in the player corners
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
    // YouTube portrait-phone end screen: full-width horizontal cards stacked
    // vertically against the bottom of the player. Much bigger tap target
    // than tiny side-by-side tiles and they can never overlap each other.
    const sideInsetPx = 10;
    const cardWidthPx = Math.max(220, Math.round(w - 2 * sideInsetPx));
    const thumbWidth = cardWidthPx * 0.38;
    const cardHeightPx = Math.max(74, Math.round((thumbWidth * 9) / 16) + 12);
    const cardGapPx = 10;
    const insetTopPx = Math.max(44, Math.round(h * 0.1));
    const insetBottomPx = Math.max(72, Math.round(h * 0.17));
    // Mobile shows AT MOST 2 cards  keeps the overlay simple and matches
    // what the user asked for. We still clamp by whatever vertically fits so
    // a very short portrait window doesn't render a card behind the controls.
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
    // YouTube landscape-phone end screen: 2 horizontal cards flanking a
    // center column reserved for the replay button. Cards are vertically
    // centered in the player so they NEVER collide with the top control row
    // (HD badge, PiP, theater, settings) or the bottom progress bar.
    const sideInsetPx = 8;
    const centerReservePx = 120;
    const sideBudget = Math.max(
      180,
      Math.round((w - centerReservePx - 2 * sideInsetPx - 16) / 2),
    );
    const cardWidthPx = Math.min(380, sideBudget);
    // Allow a slightly chunkier thumb here since vertical room is tight.
    const thumbWidth = cardWidthPx * 0.42;
    const thumbHeight = Math.round((thumbWidth * 9) / 16);
    // Card height capped by the safe vertical band so we never bleed into
    // the controls even on extreme short players.
    const topReservePx = 52;
    const bottomReservePx = 80;
    const verticalRoom = Math.max(80, h - topReservePx - bottomReservePx);
    const cardHeightPx = Math.max(
      80,
      Math.min(verticalRoom, thumbHeight + 16),
    );

    return {
      variant: "sideBySide",
      isMobile: true,
      maxCards: 2,
      // Used by the dismiss + "Up next" pill so they clear the top control
      // row instead of stacking on top of the HD / settings icons.
      insetTopPx: topReservePx,
      insetBottomPx: bottomReservePx,
      cardWidthPx,
      cardHeightPx,
      cardGapPx: 0,
      centerReservePx,
    };
  }

  // Tablet / desktop: 4 corner tiles. Sizes bumped vs the old layout so the
  // cards have YouTube's chunky end-screen weight on large players.
  const insetTopPx = Math.max(8, Math.round(h * 0.03));
  const insetBottomPx = Math.max(76, Math.round(h * 0.16));

  let pct: number;
  let minPx: number;
  let maxPx: number;
  if (w < 800) {
    pct = 0.34;
    minPx = 184;
    maxPx = 288;
  } else if (w < 1100) {
    pct = 0.3;
    minPx = 216;
    maxPx = 336;
  } else if (w < 1600) {
    pct = 0.26;
    minPx = 248;
    maxPx = 400;
  } else {
    pct = 0.22;
    minPx = 272;
    maxPx = 464;
  }
  const cardWidthPx = Math.round(
    Math.min(maxPx, Math.max(minPx, w * pct)),
  );

  return {
    variant: "corners",
    isMobile: false,
    maxCards: 4,
    insetTopPx,
    insetBottomPx,
    cardWidthPx,
    cardHeightPx: 0,
    cardGapPx: 0,
    centerReservePx: 0,
  };
}
