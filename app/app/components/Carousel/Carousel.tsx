import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Horizontal carousel built on native scroll snapping.
 *
 * Replaces Swiper for card rows. Two reasons it is not a drag-physics
 * reimplementation:
 *
 *  1. The browser already does this properly. Native overflow scrolling gives
 *     real touch momentum, trackpad and shift-wheel support, focus scrolling for
 *     keyboard and screen reader users, and RTL, none of which a hand-rolled
 *     pointer handler gets right for free.
 *  2. Swiper's track is `overflow: hidden`, which clipped the cards' hover tint
 *     as it scaled past the slide box. A scroll container clips too, so the
 *     track is padded and pulled back with a negative margin: the scaled card
 *     has room inside the scrollport instead of being cut off at the edge.
 */

type CarouselProps = {
  children: ReactNode;
  /** Names the region for assistive tech. Required: an unlabelled one is noise. */
  label: string;
  className?: string;
  /** Gap between items. Tailwind gap class. */
  gapClassName?: string;
  /**
   * Vertical breathing room so a hovered item that scales up is not clipped by
   * the scrollport. Pulled back with a matching negative margin, so it costs no
   * layout space.
   */
  bleedClassName?: string;
  /** Hide the arrow buttons even on pointer devices. */
  hideArrows?: boolean;
};

export function Carousel({
  children,
  label,
  className,
  gapClassName = "gap-2",
  bleedClassName = "py-3 -my-3",
  hideArrows = false,
}: CarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const regionId = useId();

  /** One pass over the scroll metrics; drives both arrows. */
  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    // A pixel of slack: fractional layout means scrollLeft rarely lands exactly
    // on 0 or on the maximum, and without it an arrow stays enabled forever.
    const slack = 1;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= slack);
    setAtEnd(max <= slack || el.scrollLeft >= max - slack);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();

    el.addEventListener("scroll", measure, { passive: true });
    // Content can arrive after mount (lazy images, a later feed page), and the
    // container itself resizes with the sidebar, so watch both.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);

    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure, children]);

  const page = useCallback((dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    // Leave a sliver of the outgoing item visible so it reads as continuous
    // rather than as a hard page flip.
    const step = Math.max(1, el.clientWidth * 0.85);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * step, behavior: reduced ? "auto" : "smooth" });
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        page(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        page(-1);
      }
    },
    [page],
  );

  const showArrows = !hideArrows && !(atStart && atEnd);

  return (
    <div className={cn("group/carousel relative min-w-0", className)}>
      <div
        ref={trackRef}
        id={regionId}
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain",
          // Native scrollbar is noise on a card row; the arrows and the drag
          // affordance carry it.
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          gapClassName,
          bleedClassName,
        )}
      >
        {children}
      </div>

      {showArrows ? (
        <>
          <CarouselArrow
            side="left"
            disabled={atStart}
            onClick={() => page(-1)}
            controls={regionId}
          />
          <CarouselArrow
            side="right"
            disabled={atEnd}
            onClick={() => page(1)}
            controls={regionId}
          />
        </>
      ) : null}
    </div>
  );
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
        "absolute top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-sm backdrop-blur",
        "size-8 transition-opacity duration-200",
        // Pointer devices only: on touch the gesture is the control and a
        // floating button would just cover a card.
        "[@media(pointer:fine)]:flex",
        side === "left" ? "left-1" : "right-1",
        // Stay out of the way until the row is hovered or focused within.
        "opacity-0 group-hover/carousel:opacity-100 group-focus-within/carousel:opacity-100",
        "hover:bg-background disabled:pointer-events-none disabled:opacity-0",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/**
 * One slide. `basis` controls how many are visible; keep it a fraction so the
 * next item peeks and the row reads as scrollable.
 */
export function CarouselItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 shrink-0 snap-start", className)}>{children}</div>
  );
}
