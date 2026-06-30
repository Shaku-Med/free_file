import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Image watch carousel: starts on the current image and swipes through related
 * images (recommendation engine, mode-locked to images via ?kind=image). On each
 * slide it rewrites the URL with history.replaceState  NOT pushState  so the
 * browser back button leaves the carousel in one press instead of walking back
 * through every image the viewer swiped. The ACTIVE image's palette is bubbled up
 * via onColors so the page's ambient color background follows the carousel.
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
  const [items, setItems] = useState<CarouselImage[]>([seed]);
  const cursorRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());

  // Per-slide palette, so swiping emits the ACTIVE image's colors to the ambient.
  const colorsRef = useRef<Record<number, ColorsEvent>>({});
  const activeIndexRef = useRef(0);

  // App-styled nav arrows (custom elements wired into Swiper's navigation).
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const seedKey = String(seed.id ?? seed.unique_id ?? "");

  const emitActiveColors = useCallback(() => {
    const e = colorsRef.current[activeIndexRef.current];
    if (e) onColors?.(e);
  }, [onColors]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    const seedId = String(seed.id ?? "");
    if (!seedId) {
      hasMoreRef.current = false;
      return;
    }
    loadingRef.current = true;
    try {
      const params = new URLSearchParams({
        fileId: seedId,
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
        const id = String(f.id ?? f.unique_id ?? "");
        if (!id || seenRef.current.has(id)) return false;
        seenRef.current.add(id);
        return true;
      });
      if (add.length > 0) setItems((prev) => [...prev, ...add]);
      const next = json.nextCursor?.cursor_pos;
      if (typeof next === "number" && fresh.length > 0) cursorRef.current = next;
      else hasMoreRef.current = false;
    } catch {
      hasMoreRef.current = false;
    } finally {
      loadingRef.current = false;
    }
  }, [seed.id]);

  // (Re)initialize when the watch page navigates to a different seed image.
  useEffect(() => {
    setItems([seed]);
    cursorRef.current = 0;
    hasMoreRef.current = true;
    loadingRef.current = false;
    activeIndexRef.current = 0;
    colorsRef.current = {};
    seenRef.current = new Set([seedKey]);
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const handleSlideChange = useCallback(
    (sw: SwiperType) => {
      const idx = sw.activeIndex;
      activeIndexRef.current = idx;
      const img = items[idx];
      if (!img) return;
      const uid = img.unique_id ?? img.id;
      if (uid) {
        try {
          window.history.replaceState(
            window.history.state,
            "",
            `/${encodeURIComponent(String(uid))}`,
          );
        } catch {
          /* history not available  ignore */
        }
      }
      emitActiveColors();
      onActiveChange?.(img);
      if (idx >= items.length - PREFETCH_REMAINING) void loadMore();
    },
    [items, loadMore, onActiveChange, emitActiveColors],
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
