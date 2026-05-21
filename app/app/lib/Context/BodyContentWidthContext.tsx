import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

export type BodyVideoGridColumns = 1 | 2 | 3;

const W_MIN_2_COL = 520;
const W_MIN_3_COL = 960;

/** Main column wide enough for centered navbar search (sidebar inset, not viewport). */
export const NAV_INLINE_SEARCH_MIN_PX = 640;

export function bodyVideoGridColumnsFromWidth(widthPx: number): BodyVideoGridColumns {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 1;
  if (widthPx < W_MIN_2_COL) return 1;
  if (widthPx < W_MIN_3_COL) return 2;
  return 3;
}

type BodyContentWidthContextValue = {
  bodyContentWidthPx: number;
  bodyVideoGridColumns: BodyVideoGridColumns;
};

const BodyContentWidthContext = createContext<BodyContentWidthContextValue | null>(
  null
);

export function useBodyContentWidth(): BodyContentWidthContextValue {
  const ctx = useContext(BodyContentWidthContext);
  if (ctx) return ctx;
  if (typeof window === "undefined") {
    return { bodyContentWidthPx: 0, bodyVideoGridColumns: 1 };
  }
  const w = window.innerWidth;
  return {
    bodyContentWidthPx: w,
    bodyVideoGridColumns: bodyVideoGridColumnsFromWidth(w),
  };
}

/** Tailwind-safe class string for a video grid tied to measured main column width. */
export function useBodyVideoGridClassName(): string {
  const { bodyVideoGridColumns } = useBodyContentWidth();
  return cn(
    "grid min-w-0 gap-3 md:gap-4",
    bodyVideoGridColumns === 1 && "grid-cols-1",
    bodyVideoGridColumns === 2 && "grid-cols-2",
    bodyVideoGridColumns === 3 && "grid-cols-3"
  );
}

/** True when the measured main column fits inline (center) navbar search. */
export function useNavInlineSearch(): boolean {
  const { bodyContentWidthPx } = useBodyContentWidth();
  if (bodyContentWidthPx <= 0) return false;
  return bodyContentWidthPx >= NAV_INLINE_SEARCH_MIN_PX;
}

/**
 * Observes this element’s content width (the main Body column) so grids can reflow
 * with sidebar / theater / padding changes instead of viewport breakpoints.
 */
export function BodyContentWidthBridge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);
  const { state: sidebarState, isMobile: sidebarIsMobile, openMobile } = useSidebar();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = el.getBoundingClientRect().width;
        setWidthPx((prev) => (prev === next ? prev : next));
      });
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();

    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [sidebarState, sidebarIsMobile, openMobile]);

  const value = useMemo(
    () => ({
      bodyContentWidthPx: widthPx,
      bodyVideoGridColumns: bodyVideoGridColumnsFromWidth(widthPx),
    }),
    [widthPx]
  );

  return (
    <BodyContentWidthContext.Provider value={value}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </BodyContentWidthContext.Provider>
  );
}
