import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Drag carousel. Transform driven, no scrollbar, no native scrolling.
 *
 * Three things it has to get right that a plain overflow container does not:
 *
 *  - The track moves under the pointer and keeps its velocity on release, then
 *    settles on the nearest item.
 *  - A drag must not open the card underneath it. Past a small threshold the
 *    next click is swallowed, so a flick across a card never navigates.
 *  - Cards scale on hover, so the viewport clips on X only (`overflow-x: clip`
 *    with `overflow-y: visible`, which `hidden` cannot express) and the hover
 *    tint keeps its room instead of being cut off. That clipping is what was
 *    swallowing the reels before.
 */

const DRAG_SLOP = 6;
const SNAP_MS = 380;
const FLICK_MULTIPLIER = 140;

type CarouselProps = {
  children: ReactNode;
  /** Names the region for assistive tech. */
  label: string;
  className?: string;
  /** Tailwind gap class applied to the track. */
  gapClassName?: string;
  /** Vertical room so a hovered card that scales up is not cut off. */
  bleedClassName?: string;
};

export function Carousel({
  children,
  label,
  className,
  gapClassName = "gap-2",
  bleedClassName = "py-3 -my-3",
}: CarouselProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const regionId = useId();

  const [offset, setOffset] = useState(0);
  const [maxOffset, setMaxOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [animate, setAnimate] = useState(true);

  const offsetRef = useRef(0);
  offsetRef.current = offset;
  const maxRef = useRef(0);
  maxRef.current = maxOffset;

  /** Live drag bookkeeping; refs so pointermove never re-renders through state. */
  const drag = useRef({
    active: false,
    startX: 0,
    startOffset: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    moved: false,
  });
  /** Set on a real drag so the click it turns into is swallowed once. */
  const suppressClick = useRef(false);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    const tr = trackRef.current;
    if (!vp || !tr) return;
    const max = Math.max(0, tr.scrollWidth - vp.clientWidth);
    setMaxOffset(max);
    // Content shrank (resize, a filtered list): never leave the track parked
    // past its own end.
    setOffset((o) => clamp(o, -max, 0));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, children]);

  useEffect(() => {
    const vp = viewportRef.current;
    const tr = trackRef.current;
    if (!vp || !tr) return;
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(tr);
    for (const child of Array.from(tr.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [measure, children]);

  /**
   * Left edge of every item measured from the track's own start.
   *
   * No offset correction: the track and its children carry the SAME transform,
   * so it cancels in the subtraction. Subtracting it again put the first edge at
   * -offset instead of 0, which poisoned every snap target and left paging and
   * release both landing back where they started.
   */
  const itemEdges = useCallback((): number[] => {
    const tr = trackRef.current;
    if (!tr) return [0];
    const base = tr.getBoundingClientRect().left;
    return Array.from(tr.children).map(
      (c) => (c as HTMLElement).getBoundingClientRect().left - base,
    );
  }, []);

  const settleTo = useCallback((target: number) => {
    const max = maxRef.current;
    const edges = itemEdges();
    const wanted = clamp(target, -max, 0);
    // Snap to whichever item edge is closest to where the flick was heading.
    let best = wanted;
    let bestDist = Infinity;
    for (const e of edges) {
      const candidate = clamp(-e, -max, 0);
      const d = Math.abs(candidate - wanted);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
    setAnimate(true);
    setOffset(best);
  }, [itemEdges]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Mouse: left button only. Pen and touch always engage.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (maxRef.current <= 0) return;
    const d = drag.current;
    d.active = true;
    d.moved = false;
    d.startX = e.clientX;
    d.startOffset = offsetRef.current;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    d.velocity = 0;
    setAnimate(false);
    setDragging(true);
    // Capture can be refused (pointer already gone, synthetic event). It must
    // never abort the drag, and release must never abort the settle.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
    d.moved = true;

    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;

    const raw = d.startOffset + dx;
    // Past either end the track still follows, at a third of the distance, so
    // the boundary is felt rather than hit like a wall.
    const max = maxRef.current;
    const eased = raw > 0 ? raw / 3 : raw < -max ? -max + (raw + max) / 3 : raw;
    setOffset(eased);
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* see above */ }
    if (!d.moved) return;
    suppressClick.current = true;
    settleTo(offsetRef.current + d.velocity * FLICK_MULTIPLIER);
  }, [settleTo]);

  /** Capture phase: kill the click a drag produced before the card sees it. */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const page = useCallback((dir: -1 | 1) => {
    const vp = viewportRef.current;
    if (!vp) return;
    settleTo(offsetRef.current - dir * vp.clientWidth * 0.8);
  }, [settleTo]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      page(e.key === "ArrowRight" ? 1 : -1);
    },
    [page],
  );

  const atStart = offset >= -1;
  const atEnd = maxOffset <= 0 || offset <= -maxOffset + 1;
  const scrollable = maxOffset > 0;

  return (
    <div className={cn("group/carousel relative min-w-0", className)}>
      <div
        ref={viewportRef}
        id={regionId}
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClickCapture={onClickCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          // clip on X only. `hidden` would clip Y too and cut the hover tint.
          "relative w-full min-w-0 overflow-x-clip overflow-y-visible",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          // Vertical page scrolling stays the browser's; horizontal is ours.
          scrollable && "touch-pan-y",
          scrollable && (dragging ? "cursor-grabbing" : "cursor-grab"),
          bleedClassName,
        )}
      >
        <div
          ref={trackRef}
          className={cn("flex w-max min-w-full will-change-transform", gapClassName)}
          style={{
            transform: `translate3d(${offset}px,0,0)`,
            transition: animate ? `transform ${SNAP_MS}ms cubic-bezier(0.22,0.61,0.36,1)` : "none",
          }}
        >
          {children}
        </div>
      </div>

      {scrollable ? (
        <>
          <CarouselArrow side="left" disabled={atStart} onClick={() => page(-1)} controls={regionId} />
          <CarouselArrow side="right" disabled={atEnd} onClick={() => page(1)} controls={regionId} />
        </>
      ) : null}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function CarouselArrow({
  side,
  disabled,
  onClick,
  controls,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
  controls: string;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-controls={controls}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={cn(
        // Cards inside raise themselves to a very high z on hover, so the
        // controls have to sit above that or they disappear under the row.
        "absolute top-1/2 z-[1000001] hidden -translate-y-1/2 items-center justify-center",
        "size-9 rounded-full border border-border/60 bg-background/90 text-foreground shadow-md backdrop-blur",
        "transition-opacity duration-200",
        // Pointer devices only: on touch the drag is the control.
        "[@media(pointer:fine)]:flex",
        side === "left" ? "left-1" : "right-1",
        "opacity-0 group-hover/carousel:opacity-100 group-focus-within/carousel:opacity-100",
        "hover:bg-background disabled:pointer-events-none disabled:opacity-0",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

/** One slide. Keep `basis` fractional so the next item peeks. */
export function CarouselItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 shrink-0", className)}>{children}</div>
  );
}
