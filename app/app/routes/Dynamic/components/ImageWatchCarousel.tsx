import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFileContext } from "~/lib/Context/Context";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
const SLIDE_MS = 320;
const DRAG_SLOP = 8;
/**
 * True when the event came from something rendered in a portal rather than
 * from a slide.
 *
 * The image preview opens in a Radix dialog, which portals its DOM under
 * <body> — but React still bubbles that dialog's events up through this
 * component tree, because the preview is a React child of a slide. So swiping
 * or arrowing inside the open preview also paged the carousel behind it.
 *
 * A real slide is always a DOM descendant of the viewport; portal content
 * never is, and that is what separates the two.
 */
function fromPortalledOverlay(e: {
  currentTarget: Element;
  target: EventTarget | null;
}): boolean {
  return e.target instanceof Node && !e.currentTarget.contains(e.target);
}

/** How far a drag must go, as a share of the width, before it changes slide. */
const ADVANCE_RATIO = 0.22;
/** A quick flick advances even on a short drag (px per ms). */
const FLICK_VELOCITY = 0.45;

/** Canonical id for URL + dedup. The watch route and loader both key on unique_id. */
const idOf = (img: CarouselImage): string => String(img.unique_id ?? img.id ?? "");

/**
 * Image watch pager, one image per view. Starts on the current image and pages
 * through related images. Each settled slide rewrites the URL with
 * replaceState (cheap, no loader re-run) and hands the active image to the
 * page via onActiveChange so title, likes and comments swap instantly. The
 * active image's palette goes up through onColors for the ambient background.
 *
 * The paging itself is ours: pointer drag with a snap to the nearest slide,
 * a flick gesture, keyboard arrows and app styled arrow buttons.
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
  const itemsRef = useRef<CarouselImage[]>([seed]);
  const cursorRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  // Seeds the related-images pagination for the whole session so the strip
  // stays one coherent ordered set while navigating image to image.
  const anchorIdRef = useRef<string>(String(seed.id ?? ""));

  const [activeIdx, setActiveIdx] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [vpWidth, setVpWidth] = useState(0);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeIdxRef = useRef(0);
  const vpWidthRef = useRef(0);
  vpWidthRef.current = vpWidth;

  const drag = useRef({ active: false, moved: false, startX: 0, lastX: 0, lastT: 0, velocity: 0 });
  const suppressClick = useRef(false);

  const colorsRef = useRef<Record<number, ColorsEvent>>({});

  const seedKey = idOf(seed);

  const applyItems = useCallback((list: CarouselImage[]) => {
    itemsRef.current = list;
    setItems(list);
  }, []);

  /** Snapshot the strip into the root context so it survives remounts and refresh. */
  const persist = useCallback(() => {
    setImageCarouselCache({
      items: itemsRef.current as Array<Record<string, unknown>>,
      cursor: cursorRef.current,
      hasMore: hasMoreRef.current,
      seen: Array.from(seenRef.current),
    });
  }, [setImageCarouselCache]);

  const emitActiveColors = useCallback(() => {
    const e = colorsRef.current[activeIdxRef.current];
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

  /** Runs once a slide settles: ambient palette, URL and page data swap. */
  const afterSlideChange = useCallback(
    (idx: number) => {
      const img = itemsRef.current[idx];
      if (!img) return;
      emitActiveColors();
      const uid = idOf(img);
      if (uid) {
        try {
          window.history.replaceState(window.history.state, "", `/${encodeURIComponent(uid)}`);
        } catch {
          /* history unavailable */
        }
      }
      onActiveChange?.(img);
      if (idx >= itemsRef.current.length - PREFETCH_REMAINING) void loadMore();
    },
    [loadMore, onActiveChange, emitActiveColors],
  );

  const goTo = useCallback(
    (idx: number, opts?: { instant?: boolean; silent?: boolean }) => {
      const clamped = Math.min(Math.max(idx, 0), itemsRef.current.length - 1);
      setAnimate(!opts?.instant);
      setDragPx(0);
      setActiveIdx(clamped);
      const changed = activeIdxRef.current !== clamped;
      activeIdxRef.current = clamped;
      if (changed && !opts?.silent) afterSlideChange(clamped);
    },
    [afterSlideChange],
  );

  // Decide what to show whenever the seed changes: mount, self navigation, or
  // an external link to another image. The persistent cache is the source of
  // truth so the images already loaded are never lost.
  useEffect(() => {
    // The seed is an image already in our strip, so just reposition.
    if (seenRef.current.has(seedKey)) {
      const idx = itemsRef.current.findIndex((it) => idOf(it) === seedKey);
      if (idx >= 0) goTo(idx, { instant: true, silent: true });
      return;
    }
    const cache = getImageCarouselCache();
    // Returning to an image swiped through earlier: restore the whole strip.
    if (cache && cache.seen.includes(seedKey) && cache.items.length > 0) {
      const hydrated = cache.items as CarouselImage[];
      const idx = Math.max(0, hydrated.findIndex((it) => idOf(it) === seedKey));
      seenRef.current = new Set(cache.seen);
      cursorRef.current = cache.cursor;
      hasMoreRef.current = cache.hasMore;
      loadingRef.current = false;
      anchorIdRef.current = String(hydrated[0]?.id ?? seed.id ?? "");
      applyItems(hydrated);
      goTo(idx, { instant: true, silent: true });
      return;
    }
    // Brand new entry image: fresh strip and fresh cache.
    seenRef.current = new Set([seedKey]);
    cursorRef.current = 0;
    hasMoreRef.current = true;
    loadingRef.current = false;
    colorsRef.current = {};
    anchorIdRef.current = String(seed.id ?? "");
    applyItems([seed]);
    goTo(0, { instant: true, silent: true });
    persist();
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const sync = () => setVpWidth(vp.clientWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (fromPortalledOverlay(e)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (itemsRef.current.length <= 1) return;
    const d = drag.current;
    d.active = true;
    d.moved = false;
    d.startX = e.clientX;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    d.velocity = 0;
    setAnimate(false);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
    if (!d.moved) {
      // Capture only once a real drag starts, otherwise the browser
      // retargets the click and controls inside the slide stop working.
      d.moved = true;
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
    }

    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;

    // First and last slide resist instead of pulling into empty space.
    const idx = activeIdxRef.current;
    const atFirst = idx === 0 && dx > 0;
    const atLast = idx === itemsRef.current.length - 1 && dx < 0;
    setDragPx(atFirst || atLast ? dx / 3 : dx);
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d.active) return;
      d.active = false;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not fatal */ }
      if (!d.moved) return;
      suppressClick.current = true;

      const dx = e.clientX - d.startX;
      const w = vpWidthRef.current || 1;
      const flick = Math.abs(d.velocity) >= FLICK_VELOCITY && Math.sign(d.velocity) === Math.sign(dx);
      const advance = Math.abs(dx) >= w * ADVANCE_RATIO || flick;
      const idx = activeIdxRef.current;
      goTo(advance ? idx + (dx < 0 ? 1 : -1) : idx);
    },
    [goTo],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (fromPortalledOverlay(e)) return;
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (fromPortalledOverlay(e)) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      goTo(activeIdxRef.current + (e.key === "ArrowRight" ? 1 : -1));
    },
    [goTo],
  );

  const handleImageLoaded = useCallback(
    (index: number, e: ColorsEvent) => {
      colorsRef.current[index] = e;
      if (index === activeIdxRef.current) emitActiveColors();
    },
    [emitActiveColors],
  );

  const showArrows = items.length > 1;
  const arrowBase =
    "absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:flex opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:!opacity-0";

  return (
    <div className="group relative aspect-video w-full">
      <div
        ref={viewportRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Image viewer"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClickCapture={onClickCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="h-full w-full touch-pan-y select-none overflow-hidden focus-visible:outline-none"
      >
        <div
          onDragStart={(e) => e.preventDefault()}
          className="flex h-full w-full will-change-transform"
          style={{
            // Percent, not measured pixels. Every slide is exactly one track
            // width, and a percentage transform resolves against that same box,
            // so the slide always lands dead centre. Driving it from vpWidth
            // meant any stale or pre-layout measurement (first paint, sidebar
            // toggle, rotation) multiplied by the slide index and left images
            // sitting off to one side. Only the live drag stays in pixels.
            transform: `translate3d(calc(${-activeIdx * 100}% + ${dragPx}px),0,0)`,
            transition: animate && dragPx === 0 ? `transform ${SLIDE_MS}ms cubic-bezier(0.22,0.61,0.36,1)` : "none",
          }}
        >
          {items.map((img, i) => (
            <div
              key={String(img.id ?? img.unique_id ?? i)}
              // basis-full, not min-w-full. min-width is only a floor, and with
              // flex-basis auto the slide still sized itself to the image's
              // natural width, so a 1290px photo made a 1290px slide inside a
              // 558px viewport and the picture centred against the wrong box.
              // Pinning the basis makes every slide exactly one viewport wide,
              // which is also what the percentage transform assumes.
              className="h-full w-full min-w-0 shrink-0 grow-0 basis-full"
            >
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
            </div>
          ))}
        </div>
      </div>

      {showArrows && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            disabled={activeIdx <= 0}
            onClick={() => goTo(activeIdx - 1)}
            className={`${arrowBase} left-3`}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next image"
            disabled={activeIdx >= items.length - 1}
            onClick={() => goTo(activeIdx + 1)}
            className={`${arrowBase} right-3`}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
