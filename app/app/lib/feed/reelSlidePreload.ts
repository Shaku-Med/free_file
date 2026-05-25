import type { Swiper as SwiperType } from "swiper";

/** Prefer Swiper’s `realIndex` (virtual / loop); fall back to `activeIndex`. */
export function swiperRealIndex(swiper: SwiperType): number {
  const r = (swiper as SwiperType & { realIndex?: number }).realIndex;
  return typeof r === "number" ? r : swiper.activeIndex;
}

/**
 * Whether this slide should mount the HLS player vs poster-only (limits concurrent CDN / segment traffic).
 *
 * - **Always** the active slide.
 * - **Forward-only:** the next **two** reels in swipe-up / feed order (no symmetric “behind” preload → fewer 429s).
 * - Combine with ReelSwiper’s “sticky” list for reels the user has **already** opened  those stay mounted without widening the lookahead window.
 */
export function reelShouldPreloadHls(
  slideIndex: number,
  activeIdx: number,
  total: number,
  rewindDeck: boolean,
): boolean {
  if (total <= 0) return false;
  if (slideIndex === activeIdx) return true;

  if (!rewindDeck) {
    // Linear: next two higher indices only (no preload above the current slide).
    return slideIndex === activeIdx + 1 || slideIndex === activeIdx + 2;
  }

  // Rewind: next two slides in circular “forward” direction (same as Swiper slideNext).
  const next1 = (activeIdx + 1) % total;
  const next2 = (activeIdx + 2) % total;
  return slideIndex === next1 || slideIndex === next2;
}
