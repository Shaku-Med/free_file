/**
 * Walks a flat list of episodes (each with optional `parent_episode_id`) into a
 * preorder DFS list with depth + breadcrumb path. Used by the series selectors
 * in `MediaSelectionModal` and the inline `VideoCard` edit so users can see the
 * exact place in the hierarchy they're picking — siblings sharing a name no
 * longer collapse into ambiguous duplicates.
 */

export type EpisodeRow = {
  id: string;
  episode_name: string | null | undefined;
  parent_episode_id: string | null | undefined;
};

export type EpisodeNode = {
  id: string;
  /** Display name for this episode alone (no path). */
  name: string;
  /** Depth in the tree; `0` = top level. */
  depth: number;
  /** Full breadcrumb path joined with " › ", e.g. "Season 1 › Chapter 2 › Episode A". */
  pathLabel: string;
  /** A select-friendly label that indents by depth so the hierarchy is visible inline. */
  indentedLabel: string;
};

const INDENT = "  "; // non-breaking spaces — `<select>` collapses regular spaces.
const TWIG = "└ ";

function fallbackName(id: string): string {
  return id.slice(0, 8);
}

/**
 * Returns episodes in DFS preorder with depth + breadcrumb info. Orphans (parent
 * id present but unknown — e.g. parent was deleted) surface at depth 0 so they
 * don't disappear from the picker.
 */
export function buildEpisodeTree(rows: readonly EpisodeRow[]): EpisodeNode[] {
  if (rows.length === 0) return [];

  const idSet = new Set(rows.map((r) => r.id));
  const childrenOf = new Map<string | null, EpisodeRow[]>();
  for (const row of rows) {
    const parentId =
      row.parent_episode_id && idSet.has(row.parent_episode_id) ? row.parent_episode_id : null;
    const list = childrenOf.get(parentId);
    if (list) list.push(row);
    else childrenOf.set(parentId, [row]);
  }
  for (const [, kids] of childrenOf) {
    kids.sort((a, b) =>
      (a.episode_name ?? "").localeCompare(b.episode_name ?? "", undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }

  const out: EpisodeNode[] = [];

  function visit(parentId: string | null, depth: number, breadcrumb: string[]) {
    const kids = childrenOf.get(parentId) ?? [];
    for (const row of kids) {
      const name = row.episode_name?.trim() || fallbackName(row.id);
      const newBreadcrumb = [...breadcrumb, name];
      out.push({
        id: row.id,
        name,
        depth,
        pathLabel: newBreadcrumb.join(" › "),
        indentedLabel: depth === 0 ? name : `${INDENT.repeat(depth)}${TWIG}${name}`,
      });
      visit(row.id, depth + 1, newBreadcrumb);
    }
  }

  visit(null, 0, []);
  return out;
}
