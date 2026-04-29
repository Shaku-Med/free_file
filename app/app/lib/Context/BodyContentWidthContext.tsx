import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "~/lib/utils";

export type BodyVideoGridColumns = 1 | 2 | 3;

const W_MIN_2_COL = 520;
const W_MIN_3_COL = 960;

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidthPx(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    setWidthPx(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

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
