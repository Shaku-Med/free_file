import type { Swiper as SwiperType } from "swiper";

/** Prefer Swiper’s `realIndex` (virtual / loop); fall back to `activeIndex`. */
export function swiperRealIndex(swiper: SwiperType): number {
  const r = (swiper as SwiperType & { realIndex?: number }).realIndex;
  return typeof r === "number" ? r : swiper.activeIndex;
}

const PRELOAD_NEIGHBOR_RADIUS = 1;

/**
 * Whether this slide should mount the HLS player vs poster-only (saves decoders on long feeds).
 * Preloads the active reel and immediate neighbors; optional circular distance when the deck wraps.
 */
export function reelShouldPreloadHls(
  slideIndex: number,
  activeIdx: number,
  total: number,
  rewindDeck: boolean,
): boolean {
  if (total <= 0) return false;
  let dist: number;
  if (rewindDeck && total > 1) {
    const d = Math.abs(slideIndex - activeIdx);
    dist = Math.min(d, total - d);
  } else {
    dist = Math.abs(slideIndex - activeIdx);
  }
  return dist <= PRELOAD_NEIGHBOR_RADIUS;
}
