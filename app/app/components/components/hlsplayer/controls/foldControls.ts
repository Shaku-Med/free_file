/**
 * Deciding which controls a player has room for.
 *
 * Pure on purpose: the arithmetic that decides what folds away is the part that
 * gets subtly wrong (a forgotten gap is enough to overrun a row the numbers said
 * would fit), so it lives away from the rendering and can be checked directly.
 */

export type FoldItemSpec = {
  key: string;
  /** Folds away first at the lowest number. */
  priority: number;
  /** Never folded, whatever the width. */
  essential?: boolean;
  /** Used until the item has been on screen once and measured for real. */
  estimate?: number;
};

export type FoldGroupSpec = {
  id: string;
  items: FoldItemSpec[];
  /** Gap between this group's items, so the budget counts the space they sit in. */
  itemGapPx?: number;
  /** Fixed cost of the group's own frame, e.g. a pill's horizontal padding. */
  chromePx?: number;
};

/** Arrow button, plus the gap in front of it. */
export const ARROW_PX = 48;
export const DEFAULT_ITEM_PX = 40;
export const DEFAULT_ITEM_GAP_PX = 8;

export type MeasuredWidths = Record<string, number>;

export function groupWidth(
  group: FoldGroupSpec,
  shown: FoldItemSpec[],
  widths: MeasuredWidths,
): number {
  if (shown.length === 0) return 0;
  const widthOf = (item: FoldItemSpec) => widths[item.key] ?? item.estimate ?? DEFAULT_ITEM_PX;
  let sum = shown.reduce((n, item) => n + widthOf(item), 0);
  sum += (shown.length - 1) * (group.itemGapPx ?? DEFAULT_ITEM_GAP_PX);
  sum += group.chromePx ?? 0;
  return sum;
}

/**
 * Which items each group can show in `budget` pixels.
 *
 * Groups compete for one budget, so a wide group takes room from its neighbours
 * and the fold lands wherever it costs least. An expanded group is served first
 * and the others fall back to their essentials, because the room it needs is
 * exactly the room they have to give up.
 */
export function fitGroups(
  groups: FoldGroupSpec[],
  widths: MeasuredWidths,
  budget: number,
  expandedId: string | null,
): Record<string, string[]> {
  const shown = new Map<string, FoldItemSpec[]>();
  for (const g of groups) shown.set(g.id, [...g.items]);

  if (expandedId) {
    for (const g of groups) {
      if (g.id === expandedId) continue;
      shown.set(
        g.id,
        g.items.filter((i) => i.essential),
      );
    }
  }

  const total = () => {
    let sum = 0;
    for (const g of groups) {
      const list = shown.get(g.id) ?? [];
      sum += groupWidth(g, list, widths);
      if (list.length < g.items.length) sum += ARROW_PX;
    }
    return sum;
  };

  const candidates = groups
    .flatMap((g) => g.items.map((item) => ({ groupId: g.id, item })))
    .filter(({ item }) => !item.essential)
    .sort((a, b) => a.item.priority - b.item.priority);

  const drop = ({ groupId, item }: { groupId: string; item: FoldItemSpec }) => {
    const list = shown.get(groupId);
    if (!list) return;
    shown.set(
      groupId,
      list.filter((i) => i.key !== item.key),
    );
  };

  // Everything except the expanded group gives way first.
  for (const c of candidates) {
    if (total() <= budget) break;
    if (expandedId === c.groupId) continue;
    drop(c);
  }
  // Still over: even an expanded group only gets what the player can show.
  for (const c of candidates) {
    if (total() <= budget) break;
    if (expandedId !== c.groupId) continue;
    drop(c);
  }

  const out: Record<string, string[]> = {};
  for (const g of groups) out[g.id] = (shown.get(g.id) ?? []).map((i) => i.key);
  return out;
}
