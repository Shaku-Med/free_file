import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Keyboard, Mousewheel } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import "swiper/css";

import { cn } from "~/lib/utils";
import { reelShouldPreloadHls, swiperRealIndex } from "~/lib/feed/reelSlidePreload";
import { PipReelItem } from "~/routes/pip/components/PipReelItem";
import type { FileType } from "~/lib/types";

interface ReelSwiperProps {
  items: FileType[];
  onEndReached?: () => void;
  /** When false, do not request another page. */
  hasMore?: boolean;
  /** Parent sets true while `/api/reel-feed` append is in flight (clears in-flight guard when false). */
  isLoadingMore?: boolean;
  userActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
  /** Full-page reel: poster palette from the active slide’s player (thumbnail colors). */
  onReelPosterColors?: (colors: string[]) => void;
}

/** Prefetch the next API page when this many swipes from the last slide. */
const PREFETCH_WHEN_SWIPES_REMAINING = 2;

/**
 * Keep HLS mounted for recently viewed reels so scrolling back does not cold-load again.
 * Kept small: each entry is a live hls.js instance + <video> decoder, and 20 of them piling
 * up made sustained scrolling stutter (and pressured mobile memory). 8 covers realistic
 * scroll-back without that cost.
 */
const MAX_STICKY_HLS_MOUNT = 8;

const POSITION_PILL_VISIBLE_MS = 2200;

/** Swipe-hint localStorage flag  shown once per browser. */
const SWIPE_HINT_KEY = "memories.reelSwipeHintSeen";
const SWIPE_HINT_AUTO_DISMISS_MS = 3000;

function shouldPrefetchNextPage(activeIndex: number, slideCount: number): boolean {
  if (slideCount <= 0) return false;
  const lastIndex = slideCount - 1;
  return lastIndex - activeIndex <= PREFETCH_WHEN_SWIPES_REMAINING;
}

/**
 * Detect pointer-fine environments so we only render desktop arrows where they make sense.
 * SSR-safe: defaults to `false` until the first client render.
 */
function useHasFinePointer(): boolean {
  const [hasFine, setHasFine] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setHasFine(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return hasFine;
}

export const ReelSwiper = ({
  items,
  onEndReached,
  hasMore = true,
  isLoadingMore = false,
  userActions,
  onReelPosterColors,
}: ReelSwiperProps) => {
  const likedKey = (userActions?.likedFileIds ?? [])
    .map((id) => String(id).toLowerCase())
    .sort()
    .join("|");
  const dislikedKey = (userActions?.dislikedFileIds ?? [])
    .map((id) => String(id).toLowerCase())
    .sort()
    .join("|");
  const userActionsStable = useMemo(
    () => userActions,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by sorted id strings
    [likedKey, dislikedKey],
  );

  const swiperRef = useRef<SwiperType | null>(null);
  /** Blocks double `onEndReached` until parent finishes the request (`isLoadingMore` goes false). */
  const loadRequestedRef = useRef(false);

  const hasFinePointer = useHasFinePointer();

  /** Nav state for desktop arrows + preload index. */
  const [activeIdx, setActiveIdx] = useState(0);
  const [canGoPrev, setCanGoPrev] = useState(false);
  const [canGoNext, setCanGoNext] = useState(items.length > 1 || hasMore);

  const rewindDeck = items.length > 1;

  /** File ids that have been the active slide  stay pre-mounted when user swipes away (FIFO cap). */
  const [stickyHlsIds, setStickyHlsIds] = useState<string[]>([]);
  const stickyHlsSet = useMemo(() => new Set(stickyHlsIds), [stickyHlsIds]);

  useEffect(() => {
    const id = items[activeIdx]?.id;
    if (id == null || id === "") return;
    const s = String(id);
    setStickyHlsIds((prev) => {
      if (prev.includes(s)) return prev;
      const next = [...prev, s];
      return next.length > MAX_STICKY_HLS_MOUNT ? next.slice(-MAX_STICKY_HLS_MOUNT) : next;
    });
  }, [activeIdx, items]);

  /** One-time swipe hint. */
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(SWIPE_HINT_KEY);
      if (!seen && items.length > 1) setShowHint(true);
    } catch {
      // storage blocked  skip the hint rather than risk throwing
    }
  }, [items.length]);

  const dismissHint = useCallback(() => {
    setShowHint(false);
    try {
      window.localStorage.setItem(SWIPE_HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!showHint) return;
    const t = window.setTimeout(() => dismissHint(), SWIPE_HINT_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [showHint, dismissHint]);

  /** Position pill visibility  show briefly after each navigation, then fade out. */
  const [pillVisible, setPillVisible] = useState(false);
  const pillTimerRef = useRef<number | null>(null);
  const flashPill = useCallback(() => {
    setPillVisible(true);
    if (pillTimerRef.current) window.clearTimeout(pillTimerRef.current);
    pillTimerRef.current = window.setTimeout(
      () => setPillVisible(false),
      POSITION_PILL_VISIBLE_MS,
    );
  }, []);
  useEffect(
    () => () => {
      if (pillTimerRef.current) window.clearTimeout(pillTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!isLoadingMore) loadRequestedRef.current = false;
  }, [isLoadingMore]);

  const requestMore = useCallback(() => {
    if (!onEndReached || !hasMore || isLoadingMore || loadRequestedRef.current) return;
    loadRequestedRef.current = true;
    onEndReached();
  }, [onEndReached, hasMore, isLoadingMore]);

  const maybePrefetch = useCallback(
    (swiper: SwiperType) => {
      if (!hasMore || isLoadingMore) return;
      if (shouldPrefetchNextPage(swiperRealIndex(swiper), items.length)) requestMore();
    },
    [hasMore, isLoadingMore, items.length, requestMore],
  );

  const syncNavState = useCallback(
    (swiper: SwiperType) => {
      const idx = swiperRealIndex(swiper);
      setActiveIdx(idx);
      if (rewindDeck) {
        // `rewind` wraps first ↔ last; keep arrows available for the whole deck.
        setCanGoPrev(true);
        setCanGoNext(true);
      } else {
        setCanGoPrev(!swiper.isBeginning);
        setCanGoNext(!swiper.isEnd || hasMore);
      }
    },
    [hasMore, rewindDeck],
  );

  const handleSlideChangeTransitionStart = useCallback(
    (swiper: SwiperType) => {
      maybePrefetch(swiper);
      if (showHint) dismissHint();
    },
    [dismissHint, maybePrefetch, showHint],
  );

  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      maybePrefetch(swiper);
      syncNavState(swiper);
    },
    [maybePrefetch, syncNavState],
  );

  /** Short feeds: prefetch if we already start near the end. */
  useEffect(() => {
    if (items.length === 0 || !hasMore) return;
    const s = swiperRef.current;
    const idx = s ? swiperRealIndex(s) : 0;
    if (shouldPrefetchNextPage(idx, items.length)) requestMore();
  }, [items.length, hasMore, requestMore]);

  /** After appends, recalc slide sizes (layout + fixed chrome) and re-sync nav state. */
  useEffect(() => {
    const s = swiperRef.current;
    if (!s) return;
    const id = requestAnimationFrame(() => {
      s.update();
      syncNavState(s);
    });
    return () => cancelAnimationFrame(id);
  }, [items.length, syncNavState]);

  const goPrev = useCallback(() => {
    swiperRef.current?.slidePrev();
  }, []);
  const goNext = useCallback(() => {
    swiperRef.current?.slideNext();
  }, []);

  /**
   * Extra keyboard shortcuts on top of Swiper's built-in ↑/↓:
   *   J = next, K = previous (YouTube / TikTok muscle memory).
   * Skip when user is typing in an input / textarea / contentEditable.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        goNext();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative isolate h-[100dvh] max-h-[100dvh] min-h-0 overflow-hidden bg-transparent",
        "mx-auto w-full reel-column",
        "touch-pan-y",
      )}
    >
      {/*
        Transform-mode Swiper (NOT cssMode)  the user reported scroll being stuck in cssMode,
        which is expected because cssMode relies on native scroll-snap and conflicts with the
        nested <video> + overlay chrome. Overlays that must not swipe (Actions rail) use
        `swiper-no-swiping`; everything else forwards touches to Swiper.
      */}
      <Swiper
        onSwiper={(s) => {
          swiperRef.current = s;
          syncNavState(s);
        }}
        onSlideChangeTransitionStart={handleSlideChangeTransitionStart}
        onSlideChange={handleSlideChange}
        onReachEnd={() => requestMore()}
        onTouchStart={() => {
          if (showHint) dismissHint();
        }}
        modules={[Keyboard, Mousewheel]}
        direction="vertical"
        slidesPerView={1}
        spaceBetween={0}
        rewind={rewindDeck}
        watchSlidesProgress
        speed={300}
        // Gesture tuning  feels like TikTok, not like a desktop carousel.
        // Lower threshold + higher touchRatio make the slide track the finger
        // sooner and 1:1-ish, which kills the "stiff" feel; a slightly shorter
        // long-swipe ratio lets a small flick commit to the next reel.
        threshold={4}
        touchRatio={1.25}
        longSwipes
        longSwipesMs={180}
        longSwipesRatio={0.15}
        shortSwipes
        followFinger
        resistanceRatio={0.2}
        preventInteractionOnTransition={false}
        // Don't preventDefault on touchstart so native video controls (seek, etc.) keep working.
        touchStartPreventDefault={false}
        touchReleaseOnEdges
        // Wheel + keyboard for desktop.
        mousewheel={{ forceToAxis: true, thresholdDelta: 20, sensitivity: 1, releaseOnEdges: true }}
        keyboard={{ enabled: true, onlyInViewport: true }}
        className="h-full w-full max-h-[100dvh] touch-pan-y"
        role="listbox"
        aria-label="Reels"
      >
        {items.map((file, slideIndex) => (
          <SwiperSlide key={String(file.id)} className="!h-full !max-h-[100dvh] !w-full shrink-0">
            {({ isActive }) => (
              <div
                className="h-full max-h-[100dvh] w-full min-h-0 touch-pan-y"
                role="option"
                aria-selected={isActive}
              >
                <PipReelItem
                  file={file}
                  isActive={isActive}
                  showChrome={isActive}
                  userActions={userActionsStable}
                  variant="page"
                  loadHlsPlayer={
                    reelShouldPreloadHls(slideIndex, activeIdx, items.length, rewindDeck) ||
                    stickyHlsSet.has(String(file.id))
                  }
                  onReelPosterColors={onReelPosterColors}
                  className="min-h-0 flex-1"
                />
              </div>
            )}
          </SwiperSlide>
        ))}
      </Swiper>

      {/* Desktop prev / next  right rail, large screens only (hidden on mobile/tablet portrait). */}
      {hasFinePointer && (
        <div
          className={cn(
            "absolute right-[max(0.75rem,env(safe-area-inset-right))] top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-2 lg:flex",
          )}
        >
          <button
            type="button"
            onClick={goPrev}
            disabled={!canGoPrev}
            aria-label="Previous reel"
            className={cn(
              "group inline-flex h-9 w-9 items-center justify-center rounded-full",
              "border border-white/15 bg-black/45 text-white/85 backdrop-blur-sm",
              "transition-all duration-200 hover:bg-black/70 hover:text-white",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              canGoPrev ? "opacity-60 hover:opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <ChevronUp className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext}
            aria-label="Next reel"
            className={cn(
              "group inline-flex h-9 w-9 items-center justify-center rounded-full",
              "border border-white/15 bg-black/45 text-white/85 backdrop-blur-sm",
              "transition-all duration-200 hover:bg-black/70 hover:text-white",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              canGoNext ? "opacity-60 hover:opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <ChevronDown className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}

      {/* First-visit swipe hint  arrow + text, auto-dismisses on first swipe or after 3s. */}
      {showHint && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-[max(7rem,calc(6rem+env(safe-area-inset-bottom,0px)))] z-30",
            "flex flex-col items-center gap-2 text-white/90",
            "animate-[reelHintFade_3s_ease-in-out_forwards]",
          )}
          aria-hidden
        >
          <div className="reel-hint-chevron rounded-full border border-white/15 bg-black/50 p-2 backdrop-blur-sm">
            <ChevronUp className="h-5 w-5" aria-hidden />
          </div>
          <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-medium backdrop-blur-sm">
            Swipe up for the next reel
          </span>
        </div>
      )}

      {isLoadingMore ? (
        <div
          className={cn(
            "pointer-events-none absolute bottom-[max(5rem,calc(4rem+env(safe-area-inset-bottom,0px)))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2",
            "rounded-full border border-white/20 bg-black/75 px-3 py-1.5 text-xs text-white/90 shadow-lg backdrop-blur-sm",
          )}
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span>Loading more…</span>
        </div>
      ) : null}
    </div>
  );
};
