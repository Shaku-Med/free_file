import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/** Shape a tile shows before its image has loaded: a portrait 4:5. */
export const DEFAULT_ASPECT = 0.8;
// Tiles stay between a tall 3:5 and a wide 16:9, as photo grids do, so a
// panorama doesn't shrink to a strip and a screenshot doesn't tower.
const MIN_ASPECT = 0.6;
const MAX_ASPECT = 16 / 9;
// The title and creator row under a tile, as a share of its width.
const CAPTION_HEIGHT = 0.3;

export function tileAspect(aspect: number | undefined): number {
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect ?? DEFAULT_ASPECT));
}

function columnsFor(width: number): number {
  if (width < 560) return 2;
  if (width < 900) return 3;
  if (width < 1280) return 4;
  return 5;
}

type Placement = {
  columns: number;
  reset: unknown;
  first: string | null;
  byKey: Map<string, number>;
  height: Map<string, number>;
  totals: number[];
};

/**
 * Columns of tiles, each placed once in the shortest column and never moved.
 * A plain CSS column layout reflows every tile whenever more load, and placing
 * by real heights after the fact makes them jump as images arrive; this way a
 * tile only ever grows in place. Everything is placed again only when the
 * number of columns changes, `resetKey` does (a new filter), or the list starts
 * over with a different first item.
 */
export default function Masonry<T>({
  items,
  keyOf,
  aspectOf,
  renderItem,
  resetKey,
  className,
}: {
  items: T[];
  keyOf: (item: T) => string;
  aspectOf: (key: string) => number | undefined;
  renderItem: (item: T, index: number) => ReactNode;
  resetKey?: unknown;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(2);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setColumns(columnsFor(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const placement = useRef<Placement | null>(null);

  const stacks = useMemo(() => {
    const first = items.length > 0 ? keyOf(items[0]) : null;
    let p = placement.current;
    if (!p || p.columns !== columns || p.reset !== resetKey || p.first !== first) {
      p = { columns, reset: resetKey, first, byKey: new Map(), height: new Map(), totals: Array(columns).fill(0) };
      placement.current = p;
    }
    const out: { item: T; index: number }[][] = Array.from({ length: columns }, () => []);
    items.forEach((item, index) => {
      const key = keyOf(item);
      const h = 1 / tileAspect(aspectOf(key)) + CAPTION_HEIGHT;
      let col = p.byKey.get(key);
      if (col === undefined) {
        col = p.totals.indexOf(Math.min(...p.totals));
        p.byKey.set(key, col);
        p.totals[col] += h;
      } else {
        // The image loaded and showed its real shape: keep the column's total
        // true so later tiles still go to the shortest one.
        p.totals[col] += h - (p.height.get(key) ?? h);
      }
      p.height.set(key, h);
      out[col].push({ item, index });
    });
    return out;
  }, [items, columns, resetKey, keyOf, aspectOf]);

  return (
    <div ref={ref} className={cn("flex w-full min-w-0 items-start gap-2 sm:gap-4", className)}>
      {stacks.map((stack, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-5 sm:gap-6">
          {stack.map(({ item, index }) => renderItem(item, index))}
        </div>
      ))}
    </div>
  );
}
