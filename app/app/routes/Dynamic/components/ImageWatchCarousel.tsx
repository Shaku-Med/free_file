import { useCallback, useEffect, useRef, useState } from "react";
import { useFileContext } from "~/lib/Context/Context";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Keyboard, Navigation } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "swiper/css";
import "swiper/css/navigation";
import ImageLoad from "../../Home/components/ImageLoad/ImageLoad";
import { getThumbnailUrl } from "~/lib/utils";

/** Minimal shape so the watch page can pass `file_data` straight through. */
type CarouselImage = {
  id?: string | number | null;
  unique_id?: string | null;
  endpoint?: string | null;
  file_type?: string | null;
  default_thumbnail?: string | null;
  thumbnails?: string[] | null;
  created_at?: string;
  filename?: string | null;
  is_adult?: boolean | null;
} & Record<string, unknown>;

type ColorsEvent = { src: string; colors: string[] };

const PREFETCH_REMAINING = 3;
/** Bound the persisted strip so a long session doesn't grow memory without limit. */
const MAX_ITEMS = 120;

/** Canonical id for URL + dedup — the watch route + loader both key on unique_id. */
const idOf = (img: CarouselImage): string => String(img.unique_id ?? img.id ?? "");

/**
 * Image watch carousel: starts on the current image and swipes through related
 * images (recommendation engine, mode-locked to images via ?kind=image). On each
 * slide it rewrites the URL with history.replaceState (cheap, no router loader
 * re-run) and hands the active image to the page via onActiveChange; the page
 * then swaps its title / likes / comments from a per-image cache or a light GET,
 * reel-style, so swiping stays instant. `replaceState` (not pushState) keeps the
 * browser back button a one-press exit instead of walking back through every
 * image swiped. The ACTIVE image's palette is bubbled up via onColors so the
 * ambient color background follows.
 */
export default function ImageWatchCarousel({
  seed,
  onColors,
  onActiveChange,
}: {
  seed: CarouselImage;
  onColors?: (e: ColorsEvent) => void;
  onActiveChange?: (img: CarouselImage) => void;
}) {
  const { getImageCarouselCache, setImageCarouselCache } = useFileContext();

  const [items, setItems] = useState<CarouselImage[]>([seed]);
  // Mirror of `items` for closures (loadMore / persist) that need the latest list.
  const itemsRef = useRef<CarouselImage[]>([seed]);
  const cursorRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  // Stable id that seeds the related-images pagination for the whole session, so
  // the strip stays one coherent ordered set as you navigate image to image.
  const anchorIdRef = useRef<string>(String(seed.id ?? ""));
  const swiperRef = useRef<SwiperType | null>(null);

  // Per-slide palette, so swiping emits the ACTIVE image's colors to the ambient.
  const colorsRef = useRef<Record<number, ColorsEvent>>({});
  const activeIndexRef = useRef(0);

  // App-styled nav arrows (custom elements wired into Swiper's navigation).
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const seedKey = idOf(seed);

  const applyItems = useCallback((list: CarouselImage[]) => {
    itemsRef.current = list;
    setItems(list);
  }, []);

  /** Snapshot the strip into the root context so it survives remounts + refresh. */
  const persist = useCallback(() => {
    setImageCarouselCache({
      items: itemsRef.current as Array<Record<string, unknown>>,
      cursor: cursorRef.current,
      hasMore: hasMoreRef.current,
      seen: Array.from(seenRef.current),
    });
  }, [setImageCarouselCache]);

  const emitActiveColors = useCallback(() => {
    const e = colorsRef.current[activeIndexRef.current];
    if (e) onColors?.(e);
  }, [onColors]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    if (itemsRef.current.length >= MAX_ITEMS) {
      hasMoreRef.current = false;
      return;
    }
    const anchorId = anchorIdRef.current;
    if (!anchorId) {
      hasMoreRef.current = false;
      return;
    }
    loadingRef.current = true;
    try {
      const params = new URLSearchParams({
        fileId: anchorId,
        kind: "image",
        cursor_pos: String(cursorRef.current),
      });
      const res = await fetch(`/api/related-videos?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        hasMoreRef.current = false;
        return;
      }
      const json = (await res.json()) as {
        data?: CarouselImage[];
        nextCursor?: { cursor_pos?: number } | null;
      };
      const fresh = Array.isArray(json.data) ? json.data : [];
      const add = fresh.filter((f) => {
        const id = idOf(f);
        if (!id || seenRef.current.has(id)) return false;
        seenRef.current.add(id);
        return true;
      });
      if (add.length > 0) applyItems([...itemsRef.current, ...add]);
      const next = json.nextCursor?.cursor_pos;
      if (typeof next === "number" && fresh.length > 0) cursorRef.current = next;
      else hasMoreRef.current = false;
      persist();
    } catch {
      hasMoreRef.current = false;
    } finally {
      loadingRef.current = false;
    }
  }, [applyItems, persist]);

  // Decide what to show whenever the seed changes (mount, self-navigation, or an
  // external link to another image). The persistent cache is the source of truth
  // so swiping + the router refresh never lose the images already loaded.
  useEffect(() => {
    // Self-navigation: the seed is an image already in our strip → just reposition.
    if (seenRef.current.has(seedKey)) {
      const idx = itemsRef.current.findIndex((it) => idOf(it) === seedKey);
      if (idx >= 0) {
        activeIndexRef.current = idx;
        if (swiperRef.current && swiperRef.current.activeIndex !== idx) {
          swiperRef.current.slideTo(idx, 0);
        }
      }
      return;
    }
    const cache = getImageCarouselCache();
    // Returning to an image we swiped through earlier → restore the whole strip.
    if (cache && cache.seen.includes(seedKey) && cache.items.length > 0) {
      const hydrated = cache.items as CarouselImage[];
      const idx = Math.max(0, hydrated.findIndex((it) => idOf(it) === seedKey));
      seenRef.current = new Set(cache.seen);
      cursorRef.current = cache.cursor;
      hasMoreRef.current = cache.hasMore;
      loadingRef.current = false;
      anchorIdRef.current = String(hydrated[0]?.id ?? seed.id ?? "");
      activeIndexRef.current = idx;
      applyItems(hydrated);
      requestAnimationFrame(() => swiperRef.current?.slideTo(idx, 0));
      return;
    }
    // Brand-new entry image → fresh strip + fresh cache.
    seenRef.current = new Set([seedKey]);
    cursorRef.current = 0;
    hasMoreRef.current = true;
    loadingRef.current = false;
    colorsRef.current = {};
    activeIndexRef.current = 0;
    anchorIdRef.current = String(seed.id ?? "");
    applyItems([seed]);
    persist();
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const handleSlideChange = useCallback(
    (sw: SwiperType) => {
      const idx = sw.activeIndex;
      activeIndexRef.current = idx;
      const list = itemsRef.current;
      const img = list[idx];
      if (!img) return;
      // All instant: ambient palette, URL (replaceState = cheap, no loader),
      // and hand the image to the page so it swaps title/likes/comments from
      // its cache or a light GET. No full navigation, so swiping never stalls.
      emitActiveColors();
      const uid = idOf(img);
      if (uid) {
        try {
          window.history.replaceState(
            window.history.state,
            "",
            `/${encodeURIComponent(uid)}`,
          );
        } catch {
          /* history unavailable  ignore */
        }
      }
      onActiveChange?.(img);
      if (idx >= list.length - PREFETCH_REMAINING) void loadMore();
    },
    [loadMore, onActiveChange, emitActiveColors],
  );

  const handleImageLoaded = useCallback(
    (index: number, e: ColorsEvent) => {
      colorsRef.current[index] = e;
      if (index === activeIndexRef.current) emitActiveColors();
    },
    [emitActiveColors],
  );

  const showArrows = items.length > 1;
  const arrowBase =
    "absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:flex opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [&.swiper-button-disabled]:pointer-events-none [&.swiper-button-disabled]:!opacity-0";

  return (
    <div className="group relative aspect-video w-full">
      <Swiper
        modules={[Navigation, A11y, Keyboard]}
        keyboard={{ enabled: true }}
        onSwiper={(sw) => {
          swiperRef.current = sw;
          // Restored a strip that opens mid-way (returned to a swiped image)?
          // Jump to that image without animation now the slides exist.
          if (activeIndexRef.current > 0 && sw.activeIndex !== activeIndexRef.current) {
            sw.slideTo(activeIndexRef.current, 0);
          }
        }}
        navigation={showArrows ? { prevEl: prevRef.current, nextEl: nextRef.current } : false}
        onBeforeInit={(swiper) => {
          const nav = swiper.params.navigation;
          if (showArrows && nav && typeof nav !== "boolean") {
            nav.prevEl = prevRef.current;
            nav.nextEl = nextRef.current;
          }
        }}
        slidesPerView={1}
        spaceBetween={0}
        className="h-full w-full"
        onSlideChange={handleSlideChange}
      >
        {items.map((img, i) => (
          <SwiperSlide key={String(img.id ?? img.unique_id ?? i)}>
            <div className="relative aspect-video w-full">
              <ImageLoad
                link={getThumbnailUrl({
                  default_thumbnail: img.default_thumbnail,
                  thumbnails: img.thumbnails,
                  file_type: img.file_type ?? undefined,
                  endpoint: img.endpoint ?? undefined,
                  created_at: img.created_at ?? "",
                  unique_id: String(img.unique_id ?? ""),
                  filename: img.filename ?? "",
                })}
                className="h-full w-full object-contain"
                imageID={String(img.unique_id ?? "")}
                index={i}
                retry={() => {}}
                hasAdultTag={Boolean(img.is_adult)}
                shouldShowPreview
                eagerLoad
                callBack={(e) => handleImageLoaded(i, { src: e.src, colors: e.colors })}
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      {showArrows && (
        <>
          <button ref={prevRef} type="button" aria-label="Previous image" className={`${arrowBase} left-3`}>
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button ref={nextRef} type="button" aria-label="Next image" className={`${arrowBase} right-3`}>
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
