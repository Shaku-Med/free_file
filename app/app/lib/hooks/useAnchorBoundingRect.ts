import { useLayoutEffect, useState } from "react";

export type AnchorBoundingRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function rectClose(a: AnchorBoundingRect, b: AnchorBoundingRect, eps = 0.25) {
  return (
    Math.abs(a.top - b.top) < eps &&
    Math.abs(a.left - b.left) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}

export type UseAnchorBoundingRectOptions = {
  /**
   * When true, sample every animation frame (needed when the anchor moves via
   * CSS `left`/`top` on an ancestor — e.g. dragging the mini player).
   */
  syncPositionEachFrame?: boolean;
};

/**
 * Tracks an element's viewport box for `position: fixed` overlays (scroll, nested scroll, resize).
 */
export function useAnchorBoundingRect(
  anchorEl: HTMLElement | null,
  options?: UseAnchorBoundingRectOptions,
): AnchorBoundingRect | null {
  const syncPositionEachFrame = Boolean(options?.syncPositionEachFrame);
  const [rect, setRect] = useState<AnchorBoundingRect | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl || typeof window === "undefined") {
      setRect(null);
      return;
    }

    let prev: AnchorBoundingRect | null = null;
    const read = () => {
      const r = anchorEl.getBoundingClientRect();
      const next: AnchorBoundingRect = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      };
      const unchanged = prev !== null && rectClose(prev, next);
      prev = next;
      if (unchanged) return;
      setRect(next);
    };

    read();

    const ro = new ResizeObserver(read);
    ro.observe(anchorEl);
    window.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", read);
    vv?.addEventListener("scroll", read);

    let rafId = 0;
    const rafLoop = () => {
      read();
      rafId = window.requestAnimationFrame(rafLoop);
    };
    if (syncPositionEachFrame) {
      rafId = window.requestAnimationFrame(rafLoop);
    } else {
      rafId = window.requestAnimationFrame(read);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
      vv?.removeEventListener("resize", read);
      vv?.removeEventListener("scroll", read);
    };
  }, [anchorEl, syncPositionEachFrame]);

  return rect;
}
