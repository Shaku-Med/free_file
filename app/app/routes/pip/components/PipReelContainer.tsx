import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Keyboard, Mousewheel, Virtual } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import { Loader2 } from 'lucide-react';
import 'swiper/css';
import 'swiper/css/virtual';

import { cn } from '~/lib/utils';
import {
  reelShouldPreloadHls,
  swiperRealIndex,
} from '~/lib/feed/reelSlidePreload';
import { useFileContext } from '~/lib/Context/Context';
import type { FileType } from '~/lib/types';
import { PipReelItem, type PipReelUserActions } from './PipReelItem';

/**
 * Start loading the next page when the user is this many vertical swipes away from the last slide
 * (same idea as TikTok / Reels: prefetch before they hit the end).
 */
const PREFETCH_WHEN_SWIPES_REMAINING = 2;

function shouldPrefetchNextPage(activeIndex: number, slideCount: number): boolean {
  if (slideCount <= 0) return false;
  const lastIndex = slideCount - 1;
  const swipesRemaining = lastIndex - activeIndex;
  return swipesRemaining <= PREFETCH_WHEN_SWIPES_REMAINING;
}

export type { PipReelUserActions };

export interface PipReelContainerProps {
  items: FileType[];
  /** `unique_id` or numeric id string of the slide to show first. */
  initialActiveId?: string;
  className?: string;
  /** From loader / `/api/pip-feed` — same as vertical feed `userActions`. */
  userActions?: PipReelUserActions;
  /**
   * Feed shuffling seed returned by `loadSecurePipFeed` on the initial page. Paginated fetches
   * MUST echo this back so page 2+ aligns with page 1 (otherwise you get duplicates and jumps).
   */
  seed?: string | null;
  /** Cursor returned by the loader for the second page, or null if the first page exhausted the feed. */
  initialNextCursor?: { cursor_pos: number } | null;
  /**
   * Center entry `unique_id` (same as `/pip/:id`). Used for `/api/pip-feed` pagination so it stays
   * correct even if `items[0]` ordering assumptions change.
   */
  centerUniqueId?: string;
}

/** Fetch one more page of reels relative to the seed + cursor the server gave us. */
async function fetchMorePipFeed(params: {
  uniqueId: string;
  seed: string;
  cursorPos: number;
  excludeIds: string[];
}): Promise<{
  data: FileType[];
  nextCursor: { cursor_pos: number } | null;
  userActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
} | null> {
  const qs = new URLSearchParams({
    unique_id: params.uniqueId,
    seed: params.seed,
    cursor_pos: String(params.cursorPos),
  });
  // Send the ids we've already rendered so the server can dedupe across pages.
  // Cap length — server also re-validates UUID shape.
  if (params.excludeIds.length > 0) {
    qs.set('exclude_ids', JSON.stringify(params.excludeIds.slice(-200)));
  }

  try {
    const res = await fetch(`/api/pip-feed?${qs.toString()}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data: FileType[];
      nextCursor: { cursor_pos: number } | null;
      userActions?: { likedFileIds: string[]; dislikedFileIds: string[] };
    };
    return body;
  } catch (e) {
    console.warn('[PipReelContainer] pagination fetch failed', e);
    return null;
  }
}

export function PipReelContainer({
  items: initialItems,
  initialActiveId,
  className,
  userActions: initialUserActions,
  seed,
  initialNextCursor = null,
  centerUniqueId: centerUniqueIdProp,
}: PipReelContainerProps) {
  const { userId } = useFileContext();
  const swiperRef = useRef<SwiperType | null>(null);
  const centerUniqueId =
    centerUniqueIdProp?.trim() ||
    initialActiveId?.trim() ||
    initialItems[0]?.unique_id ||
    '';

  /**
   * Local state so we can append pages as the user scrolls. Keyed by `unique_id ?? id` so a
   * newly fetched center slide can't re-enter the list.
   */
  const [items, setItems] = useState<FileType[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<{ cursor_pos: number } | null>(
    initialNextCursor,
  );
  const [userActions, setUserActions] = useState<PipReelUserActions | undefined>(
    initialUserActions,
  );
  const [exhausted, setExhausted] = useState(false);
  const loadingRef = useRef(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  /**
   * If the loader reruns with a brand new starting file (navigation to a different `/pip/:id`),
   * reset the feed state. Otherwise preserve appended pages across Swiper reorders.
   */
  const initialFirstId = initialItems[0] ? String(initialItems[0].id) : '';
  useEffect(() => {
    setItems(initialItems);
    setNextCursor(initialNextCursor);
    setUserActions(initialUserActions);
    setExhausted(false);
    loadingRef.current = false;
    // Only resync when the loader's starting file id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFirstId]);

  const initialSlide = useMemo(() => {
    if (!initialActiveId || items.length === 0) return 0;
    const i = items.findIndex(
      (x) => x.unique_id === initialActiveId || String(x.id) === String(initialActiveId),
    );
    return i >= 0 ? i : 0;
  }, [initialActiveId, items]);

  const [activeIdx, setActiveIdx] = useState(initialSlide);

  useEffect(() => {
    setActiveIdx(initialSlide);
  }, [initialSlide]);

  useEffect(() => {
    const s = swiperRef.current;
    if (!s || !initialActiveId) return;
    const i = items.findIndex(
      (x) => x.unique_id === initialActiveId || String(x.id) === String(initialActiveId),
    );
    if (i >= 0 && i !== s.activeIndex) s.slideTo(i, 0);
  }, [initialActiveId, items]);

  /**
   * Pull another page from `/api/pip-feed`, dedupe, append. Guarded by a ref so rapid swipes
   * near the end only trigger one in-flight fetch.
   */
  const loadMore = useCallback(async () => {
    if (!userId) return;
    if (loadingRef.current || exhausted || !seed || !nextCursor) return;
    if (!centerUniqueId) return;

    loadingRef.current = true;
    setIsFetchingMore(true);
    try {
      const excludeIds = items.map((f) => String(f.id));
      const page = await fetchMorePipFeed({
        uniqueId: centerUniqueId,
        seed,
        cursorPos: nextCursor.cursor_pos,
        excludeIds,
      });
      if (!page) {
        return;
      }

      const existing = new Set(items.map((f) => String(f.id)));
      const fresh = page.data.filter((f) => !existing.has(String(f.id)));

      if (fresh.length === 0 || !page.nextCursor) {
        // Nothing new or server says we're done — stop polling so we don't spam.
        setExhausted(true);
      }

      if (fresh.length > 0) {
        setItems((prev) => [...prev, ...fresh]);
      }
      setNextCursor(page.nextCursor);

      // Merge userActions so new slides render their correct liked/disliked state.
      if (page.userActions) {
        setUserActions((prev) => {
          const base = prev ?? { likedFileIds: [], dislikedFileIds: [] };
          const liked = new Set([...base.likedFileIds, ...page.userActions!.likedFileIds]);
          const disliked = new Set([
            ...base.dislikedFileIds,
            ...page.userActions!.dislikedFileIds,
          ]);
          return {
            likedFileIds: Array.from(liked),
            dislikedFileIds: Array.from(disliked),
          };
        });
      }
    } finally {
      loadingRef.current = false;
      setIsFetchingMore(false);
    }
  }, [centerUniqueId, exhausted, items, nextCursor, seed, userId]);

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  /** Fire while the user is moving — `activeIndex` may still be the previous slide; prefetch uses realIndex when present. */
  const handleSlideChangeTransitionStart = useCallback(
    (swiper: SwiperType) => {
      const idx =
        typeof (swiper as SwiperType & { realIndex?: number }).realIndex === 'number'
          ? (swiper as SwiperType & { realIndex: number }).realIndex
          : swiper.activeIndex;
      if (shouldPrefetchNextPage(idx, items.length)) void loadMore();
    },
    [items.length, loadMore],
  );

  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      if (shouldPrefetchNextPage(swiper.activeIndex, items.length)) void loadMore();
    },
    [items.length, loadMore],
  );

  /**
   * Short first pages: if we're already within the prefetch window, load without waiting for a swipe.
   */
  useEffect(() => {
    if (!userId || !seed || !nextCursor || exhausted || items.length === 0) return;
    const s = swiperRef.current;
    const idx = s?.activeIndex ?? 0;
    if (shouldPrefetchNextPage(idx, items.length)) void loadMoreRef.current();
  }, [userId, items.length, seed, nextCursor, exhausted]);

  /** After appending slides, let Swiper / Virtual recalc dimensions so scrolling stays smooth. */
  useEffect(() => {
    const s = swiperRef.current;
    if (!s) return;
    const id = requestAnimationFrame(() => {
      s.update();
      const virtual = (s as unknown as { virtual?: { update?: (force?: boolean) => void } }).virtual;
      virtual?.update?.(true);
    });
    return () => cancelAnimationFrame(id);
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-background text-sm text-muted-foreground">
        No videos
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden bg-background',
        className,
        'h-[100dvh] max-h-[100dvh] min-h-0',
      )}
    >
      <Swiper
        onSwiper={(s) => {
          swiperRef.current = s;
          setActiveIdx(swiperRealIndex(s));
        }}
        onSlideChangeTransitionStart={(s) => {
          setActiveIdx(swiperRealIndex(s));
          handleSlideChangeTransitionStart(s);
        }}
        onSlideChange={(s) => {
          setActiveIdx(swiperRealIndex(s));
          handleSlideChange(s);
        }}
        onReachEnd={() => void loadMore()}
        modules={[Virtual, Mousewheel, Keyboard]}
        direction="vertical"
        slidesPerView={1}
        initialSlide={initialSlide}
        speed={280}
        longSwipesMs={180}
        threshold={6}
        resistanceRatio={0.35}
        mousewheel={{ forceToAxis: true, thresholdDelta: 20, sensitivity: 1 }}
        keyboard={{ enabled: true, onlyInViewport: true }}
        virtual={{ enabled: true, addSlidesBefore: 1, addSlidesAfter: 3 }}
        className="h-full w-full"
        role="listbox"
        aria-label="PiP reel"
      >
        {items.map((file, index) => (
          <SwiperSlide
            key={String(file.id)}
            virtualIndex={index}
            className="!h-full !w-full"
          >
            {({ isActive }) => (
              <div
                className="h-full w-full min-h-0"
                role="option"
                aria-selected={isActive}
              >
                <PipReelItem
                  file={file}
                  isActive={isActive}
                  showChrome={isActive}
                  userActions={userActions}
                  loadHlsPlayer={reelShouldPreloadHls(
                    index,
                    activeIdx,
                    items.length,
                    false,
                  )}
                />
              </div>
            )}
          </SwiperSlide>
        ))}
      </Swiper>

      {isFetchingMore && (
        <div
          className="pointer-events-none absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur-sm sm:bottom-28"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span>Loading more…</span>
        </div>
      )}
    </div>
  );
}
