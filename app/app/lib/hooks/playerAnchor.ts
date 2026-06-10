/** True when an anchor element is in the document and not hidden by an ancestor. */
export function isPlayerAnchorLive(el: HTMLElement | null | undefined): boolean {
  if (!el?.isConnected) return false;

  const r = el.getBoundingClientRect();
  if (r.width >= 1 && r.height >= 1) return true;

  if (typeof document === "undefined") return false;

  let node: HTMLElement | null = el;
  while (node && node !== document.documentElement) {
    const { display, visibility } = getComputedStyle(node);
    if (display === "none" || visibility === "hidden") return false;
    node = node.parentElement;
  }

  // Connected but 0×0 (layout settling) — still treat as live so handoffs don't flash.
  return true;
}

/** Watch surface cleared, mini active, but the mini dock shell is not mounted yet. */
export function isMiniHandoffPending(
  miniPlayer: { imageID?: string; file?: { unique_id?: string } } | null | undefined,
  surfaceHasProps: boolean,
  miniAnchorEl: HTMLElement | null | undefined,
): boolean {
  return Boolean(miniPlayer && !surfaceHasProps && !isPlayerAnchorLive(miniAnchorEl));
}
