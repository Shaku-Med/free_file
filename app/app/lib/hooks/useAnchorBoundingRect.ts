import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
   * When true, sample every animation frame (needed when the anchor moves
   * via CSS `left`/`top` on an ancestor — e.g. dragging the mini player).
   */
  syncPositionEachFrame?: boolean;
  /**
   * Optional imperative update path. When provided, position updates after
   * the initial mount route through this callback INSTEAD of React state.
   * The caller is expected to mutate the portal element's style directly
   * — this avoids re-rendering the entire player subtree on every scroll
   * frame. State is still set on the first valid rect so the portal can
   * render at all; subsequent updates go imperative.
   *
   * Pass null/undefined to keep legacy state-based behavior.
   */
  onUpdate?: ((rect: AnchorBoundingRect) => void) | null;
};

/**
 * Tracks an element's viewport box for `position: fixed` overlays
 * (scroll, nested scroll, resize, drag).
 *
 * If you pass `onUpdate`, you opt into the imperative path: React state
 * fires only for the first valid rect, and every subsequent change is
 * delivered through the callback so you can mutate the overlay's style
 * directly without dragging React's reconciler through the player tree.
 * This is the difference between buttery scroll and noticeable jank.
 */
export function useAnchorBoundingRect(
  anchorEl: HTMLElement | null,
  options?: UseAnchorBoundingRectOptions,
): AnchorBoundingRect | null {
  const syncPositionEachFrame = Boolean(options?.syncPositionEachFrame);
  const onUpdate = options?.onUpdate ?? null;
  const [rect, setRect] = useState<AnchorBoundingRect | null>(null);

  // Keep the onUpdate ref stable across renders so the effect below doesn't
  // tear down its observers / rAF loop just because a parent re-rendered.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useLayoutEffect(() => {
    if (!anchorEl || typeof window === "undefined") {
      setRect(null);
      return;
    }

    // Once we've committed an initial rect to state we stop calling
    // setState; future updates go through the imperative callback (if
    // any) or stay state-driven (legacy behavior).
    let didInitialCommit = false;
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

      const cb = onUpdateRef.current;
      if (cb && didInitialCommit) {
        // Imperative path — caller mutates DOM directly, no React render.
        cb(next);
        return;
      }
      // First update goes through state so the portal element gets a
      // starting position. From there imperative updates take over.
      didInitialCommit = true;
      setRect(next);
      if (cb) cb(next);
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
