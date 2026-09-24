import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from '~/components/icons';
import { cn } from '~/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { fitGroups, type FoldGroupSpec, type FoldItemSpec } from './foldControls';

/**
 * A control row that folds instead of overflowing.
 *
 * The player is the only thing that decides this: the row measures its own box,
 * not the viewport, so a narrow player inside a wide window folds exactly the
 * same as a narrow window would. When the items want more room than the player
 * gives them, the lowest priority ones are taken out of the layout entirely and
 * their group grows an arrow that puts them back. Nothing scrolls, and nothing
 * is squashed.
 *
 * Any number of groups can share the row. They compete for one budget, so a wide
 * left group takes room from the right one and the fold happens wherever it hurts
 * least. Only one group may be expanded at a time, because the room an expanded
 * group uses is exactly the room the others just gave up.
 */

export type FoldItem = FoldItemSpec & { node: ReactNode };

export type FoldGroup = Omit<FoldGroupSpec, 'items'> & {
  items: FoldItem[];
  /** Renders the group's items, e.g. inside a pill. Defaults to a bare row. */
  wrap?: (children: ReactNode) => ReactNode;
  className?: string;
  /** Tooltip / aria text for this group's arrow. */
  expandLabel?: string;
};

/** Slack required before folding back out, so a 1px wobble can't oscillate. */
const UNFOLD_HYSTERESIS_PX = 12;

type Widths = Record<string, number>;

export function FoldableControlRow({
  groups,
  className,
  gapPx = 12,
}: {
  groups: FoldGroup[];
  className?: string;
  gapPx?: number;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const widthsRef = useRef<Widths>({});
  const [widthsVersion, setWidthsVersion] = useState(0);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const setItemRef = useCallback((key: string) => (el: HTMLElement | null) => {
    if (el) itemRefs.current.set(key, el);
    else itemRefs.current.delete(key);
  }, []);

  // Widths only ever grow: an item measured while the row was mid animation must
  // not teach us a smaller size than its real one.
  useLayoutEffect(() => {
    let changed = false;
    for (const [key, el] of itemRefs.current) {
      const w = el.getBoundingClientRect().width;
      if (w <= 0) continue;
      const rounded = Math.ceil(w);
      if (rounded > (widthsRef.current[key] ?? 0)) {
        widthsRef.current[key] = rounded;
        changed = true;
      }
    }
    if (changed) setWidthsVersion((v) => v + 1);
  });

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const apply = () => {
      const w = row.clientWidth;
      // A zero width means the bar is laid out but not shown yet; folding on
      // that would hide every control for the first frame it appears.
      if (w <= 0) return;
      setRowWidth((prev) => (prev !== null && Math.abs(prev - w) < 1 ? prev : w));
    };
    // Straight away, not via rAF: a deferred first measurement can be cancelled
    // before it ever lands, and then the row never learns how wide it is.
    apply();
    // Straight from the observer. It already runs after layout and is batched,
    // and deferring through rAF meant no measurement at all on a page the
    // browser is not painting.
    const ro = new ResizeObserver(apply);
    ro.observe(row);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(() => {
    if (rowWidth === null) {
      const all: Record<string, string[]> = {};
      for (const g of groups) all[g.id] = g.items.map((i) => i.key);
      return all;
    }
    const budget = Math.max(0, rowWidth - gapPx * Math.max(0, groups.length - 1));
    // Folding back out needs a little more room than folding in did.
    return fitGroups(groups, widthsRef.current, budget - (expandedId ? 0 : UNFOLD_HYSTERESIS_PX), expandedId);
    // widthsVersion is a measurement tick, not an unused dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, rowWidth, gapPx, expandedId, widthsVersion]);

  const anyFolded = groups.some((g) => (visible[g.id]?.length ?? 0) < g.items.length);
  useLayoutEffect(() => {
    // The player grew and everything fits again, so the arrow that opened this
    // group no longer exists; drop the expansion with it.
    if (!anyFolded && expandedId) setExpandedId(null);
  }, [anyFolded, expandedId]);

  return (
    <div
      ref={rowRef}
      className={cn('flex min-w-0 items-center justify-between', className)}
      style={{ gap: gapPx }}
    >
      {groups.map((g) => {
        const shownKeys = visible[g.id] ?? [];
        const shownSet = new Set(shownKeys);
        const hiddenCount = g.items.length - shownKeys.length;
        const isExpanded = expandedId === g.id;
        const body = g.items
          .filter((i) => shownSet.has(i.key))
          .map((i) => (
            <span key={i.key} ref={setItemRef(i.key)} className="inline-flex shrink-0">
              {i.node}
            </span>
          ));

        const arrow =
          hiddenCount > 0 || isExpanded ? (
            <Tooltip delayDuration={350}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedId((cur) => (cur === g.id ? null : g.id));
                  }}
                  aria-expanded={isExpanded}
                  aria-label={
                    isExpanded ? 'Show fewer controls' : g.expandLabel ?? 'Show more controls'
                  }
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/40 text-white shadow-sm transition-colors hover:bg-black/60"
                >
                  {isExpanded ? (
                    <ChevronRight className="h-5 w-5" />
                  ) : (
                    <ChevronLeft className="h-5 w-5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isExpanded ? 'Show fewer controls' : g.expandLabel ?? 'Show more controls'}
              </TooltipContent>
            </Tooltip>
          ) : null;

        return (
          <div key={g.id} className={cn('flex min-w-0 shrink-0 items-center gap-2', g.className)}>
            {g.wrap ? g.wrap(body) : body}
            {arrow}
          </div>
        );
      })}
    </div>
  );
}
