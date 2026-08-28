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
 * True when the event came from something rendered in a portal rather than
 * from a slide.
 *
 * Slides here hold VideoCards, whose comments drawer / share sheet / playlist
 * modal portal their DOM under <body>. React still bubbles those events up
 * through this component tree, so dragging inside an open sheet would page the
 * carousel behind it. A real slide is always a DOM descendant of the viewport;
 * portal content never is.
 */
function fromPortalledOverlay(e: {
  currentTarget: Element;
  target: EventTarget | null;
}): boolean {
  return e.target instanceof Node && !e.currentTarget.contains(e.target);
}

/**
 * In-house carousel. Transform driven, so there is no native scrollbar and no
 * CSS snap. The track follows the pointer 1:1 (mouse, pen or touch), keeps its
 * velocity on release and glides out with friction. Arrows and arrow keys page
 * by most of a viewport.
 *
 * Sizing is container based, like the player: the root is a CSS container and
 * card widths come from itemWidth capped in container query units, so they are
 * right from the first server paint with no JS involved. Controls only render
 * while there is somewhere to scroll to.
 */

const DRAG_SLOP = 6;
const GLIDE_MS = 380;
const FRICTION_TAU = 320;
const MIN_VELOCITY = 0.02;
const VELOCITY_SAMPLE_MS = 80;

type CarouselProps = {
  children: ReactNode;
  /** Names the region for assistive tech. */
  label: string;
  /**
   * Card width in px. Capped at 85% of the carousel's own width so a card
   * never overflows a small slot. Omit it and the items size themselves
   * through their own classes.
   */
  itemWidth?: number;
  className?: string;
  gapClassName?: string;
  /** Vertical room so a card that grows on hover is not cut off. */
  bleedClassName?: string;
};

export function Carousel({
  children,
  label,
  itemWidth,
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
  const [animate, setAnimate] = useState(false);

  const offsetRef = useRef(0);
  offsetRef.current = offset;
  /**
   * The live drag bound. Deliberately NOT re-synced from maxOffset on every
   * render: onPointerDown re-measures into this ref precisely because the
   * state can be stale, and the first pointer move calls setOffset, which
   * re-renders. Assigning here would have overwritten that fresh measurement
   * one move into the drag and handed the rest of the gesture back to the
   * stale number, which is how the row could be dragged past its content and
   * emptied out. measure() and onPointerDown are the only writers.
   */
  const maxRef = useRef(0);

  const drag = useRef({
    active: false,
    startX: 0,
    startOffset: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    moved: false,
  });
  const suppressClick = useRef(false);
  const momentumRaf = useRef<number | null>(null);

  const stopMomentum = useCallback(() => {
    if (momentumRaf.current !== null) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = null;
    }
  }, []);

  useEffect(() => stopMomentum, [stopMomentum]);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    const tr = trackRef.current;
    if (!vp || !tr) return;
    const max = Math.max(0, tr.scrollWidth - vp.clientWidth);
    maxRef.current = max;
    setMaxOffset(max);
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

  const startMomentum = useCallback((initialVelocity: number) => {
    stopMomentum();
    let v = initialVelocity;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const max = maxRef.current;
      const next = clamp(offsetRef.current + v * dt, -max, 0);
      setAnimate(false);
      setOffset(next);
      v *= Math.exp(-dt / FRICTION_TAU);
      const hitEdge = next === 0 || next === -max;
      if (Math.abs(v) < MIN_VELOCITY || hitEdge) {
        momentumRaf.current = null;
        return;
      }
      momentumRaf.current = requestAnimationFrame(step);
    };
    momentumRaf.current = requestAnimationFrame(step);
  }, [stopMomentum]);

  const glideTo = useCallback((target: number) => {
    stopMomentum();
    setAnimate(true);
    setOffset(clamp(target, -maxRef.current, 0));
  }, [stopMomentum]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (fromPortalledOverlay(e)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Measure first. maxOffset is what bounds the drag, and if it is stale
    // (cards still loading, sidebar just toggled, list just grew) the track can
    // be pulled far past where the content actually ends and the row empties
    // out. Cheap: two reads on press, not per move.
    const vp0 = viewportRef.current;
    const tr0 = trackRef.current;
    if (vp0 && tr0) {
      maxRef.current = Math.max(0, tr0.scrollWidth - vp0.clientWidth);
    }
    if (maxRef.current <= 0) return;
    stopMomentum();
    const d = drag.current;
    d.active = true;
    d.moved = false;
    d.startX = e.clientX;
    d.startOffset = offsetRef.current;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    d.velocity = 0;
    setAnimate(false);
  }, [stopMomentum]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
    if (!d.moved) {
      // Capture only once a real drag starts. Capturing on the initial press
      // makes the browser retarget the click to the viewport, which broke
      // every link and button inside the cards.
      d.moved = true;
      setDragging(true);
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
    }

    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;

    // Past either end the track follows at a third of the distance, so the
    // boundary is felt instead of hit like a wall. Capped as well: a long flick
    // at the edge would otherwise ease its way to an offset that pushes every
    // card off screen and leaves a blank row.
    const raw = d.startOffset + dx;
    const max = maxRef.current;
    const limit = Math.max(48, (viewportRef.current?.clientWidth ?? 0) * 0.15);
    const eased =
      raw > 0
        ? Math.min(raw / 3, limit)
        : raw < -max
          ? -max - Math.min((-max - raw) / 3, limit)
          : raw;
    setOffset(eased);
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not fatal */ }
    if (!d.moved) return;
    suppressClick.current = true;

    const max = maxRef.current;
    const current = offsetRef.current;
    if (current > 0 || current < -max) {
      glideTo(current);
      return;
    }
    const fresh = e.timeStamp - d.lastT <= VELOCITY_SAMPLE_MS;
    if (fresh && Math.abs(d.velocity) >= MIN_VELOCITY) {
      startMomentum(d.velocity);
    }
  }, [glideTo, startMomentum]);

  /** A drag should never turn into a click on whatever card it ended over. */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (fromPortalledOverlay(e)) return;
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const page = useCallback((dir: -1 | 1) => {
    const vp = viewportRef.current;
    if (!vp) return;
    glideTo(offsetRef.current - dir * vp.clientWidth * 0.8);
  }, [glideTo]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (fromPortalledOverlay(e)) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      page(e.key === "ArrowRight" ? 1 : -1);
    },
    [page],
  );

  // Horizontal trackpad and tilt wheel input. Native listener because React's
  // delegated wheel handlers are passive and preventDefault would be ignored.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (maxRef.current <= 0) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      stopMomentum();
      setAnimate(false);
      setOffset(clamp(offsetRef.current - e.deltaX, -maxRef.current, 0));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [stopMomentum]);

  const atStart = offset >= -1;
  const atEnd = maxOffset <= 0 || offset <= -maxOffset + 1;
  const scrollable = maxOffset > 0;

  return (
    <div className={cn("group/carousel @container relative isolate min-w-0", className)}>
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
          "relative z-0 w-full min-w-0 overflow-x-clip overflow-y-visible",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          scrollable && "touch-pan-y",
          scrollable && (dragging ? "cursor-grabbing" : "cursor-grab"),
          bleedClassName,
        )}
      >
        <div
          ref={trackRef}
          // Images and links start a native HTML drag on mouse down, which
          // kills the pointer stream and with it the drag. Blocked here once
          // instead of on every card.
          onDragStart={(e) => e.preventDefault()}
          className={cn(
            "flex w-max min-w-full will-change-transform select-none",
            gapClassName,
          )}
          style={{
            transform: `translate3d(${offset}px,0,0)`,
            transition: animate ? `transform ${GLIDE_MS}ms cubic-bezier(0.22,0.61,0.36,1)` : "none",
            // Plain CSS so the server renders correct card widths too. cqw is
            // relative to the carousel's own box, never the window.
            ...(itemWidth && itemWidth > 0
              ? ({ "--carousel-item": `min(${itemWidth}px, 85cqw)` } as React.CSSProperties)
              : {}),
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
        // z-10 over the z-0 viewport inside an isolated root, so cards can
        // never paint over the controls.
        "absolute top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center",
        "size-10 rounded-full text-foreground/90",
        "border border-border/50 bg-background/85 shadow-lg shadow-black/10 backdrop-blur-md",
        "ring-1 ring-black/5 dark:ring-white/10",
        "transition-[opacity,transform,background-color] duration-200 ease-out",
        // Pointer devices only. On touch the drag is the control.
        "[@media(pointer:fine)]:flex",
        side === "left" ? "left-2" : "right-2",
        "opacity-90 hover:scale-105 hover:bg-background hover:opacity-100 hover:text-foreground",
        "active:scale-95",
        "disabled:pointer-events-none disabled:scale-90 disabled:opacity-0",
      )}
    >
      <Icon
        className={cn("size-5", side === "left" ? "-translate-x-px" : "translate-x-px")}
        strokeWidth={2.5}
        aria-hidden
      />
    </button>
  );
}

/**
 * One slide. Sized by the carousel when it was given an itemWidth, otherwise
 * by whatever width classes the caller puts on it.
 */
export function CarouselItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("min-w-0 shrink-0 grow-0", className)}
      style={{ flexBasis: "var(--carousel-item, auto)" }}
    >
      {children}
    </div>
  );
}
