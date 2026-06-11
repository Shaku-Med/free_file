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
 * - **Forward-only:** the next `lookahead` reels in swipe-up / feed order (no symmetric “behind” preload → fewer 429s).
 * - Combine with ReelSwiper’s “sticky” list for reels the user has **already** opened  those stay mounted without widening the lookahead window.
 *
 * `lookahead` is 2 by default; iOS passes 1  iPhone Safari has a tiny media
 * decoder pool (~3-4 pipelines) and exhausting it is what kills reel autoplay
 * after sustained scrolling.
 */
export function reelShouldPreloadHls(
  slideIndex: number,
  activeIdx: number,
  total: number,
  rewindDeck: boolean,
  lookahead = 2,
): boolean {
  if (total <= 0) return false;
  if (slideIndex === activeIdx) return true;

  const ahead = Math.max(0, lookahead);
  for (let step = 1; step <= ahead; step++) {
    const next = rewindDeck ? (activeIdx + step) % total : activeIdx + step;
    if (slideIndex === next) return true;
  }
  return false;
}
