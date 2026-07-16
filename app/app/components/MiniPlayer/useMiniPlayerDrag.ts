import { useCallback, useRef, useState, useLayoutEffect, useEffect } from "react";
import { isMiniPlayerDragLocked, registerMiniPlayerDragHandler } from "./miniPlayerDragBridge";
import { useSnapFloatsToCorners } from "~/lib/uiFloatPrefs";

const PADDING = 16;

/** Space the mobile bottom nav reserves at the viewport bottom, if present. */
function bottomReservedPx(): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--app-bottom-nav-h");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}
const DRAG_THRESHOLD_PX = 4;
/** Smooth corner-settle morph (keep in sync with MiniPlayer CSS). */
export const SNAP_TRANSITION_MS = 420;
export const SNAP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const STORAGE_KEY = "mini-player-width-v1";
const MIN_W = 260;
/** Hard cap  never wider than this */
const ABSOLUTE_MAX_W = 400;
/** Preferred default when the viewport has room */
const PREFERRED_DEFAULT_W = 340;
/** Chrome + title block + 16:9 video (approx)  used until DOM measures. */
function estimateShellHeight(width: number) {
  return 56 + (width * 9) / 16;
}

/** Visible strip when tucked to screen edge (Apple PiP–style). */
const PEEK_PX = 30;
const EDGE_TUCK_PX = 28;
/** Extra threshold when the player was just un-tucked  prevents accidental re-tuck. */
const UNTUCK_RE_TUCK_PX = 80;

/** Fraction of mini-player area allowed inside the padded viewport without forcing a corner/edge settle. ≤0.5 means “halfway off bound” → snap. */
const OFFSCREEN_RATIO_SNAP = 0.5;

/** How much area of the rectangle lies inside `[PADDING, innerWidth−PADDING] × …` vertically clamped viewport band. */
function visibleAreaFraction(
  x: number,
  y: number,
  elWidth: number,
  elHeight: number,
): number {
  if (typeof window === "undefined") return 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ix0 = Math.max(x, PADDING);
  const iy0 = Math.max(y, PADDING);
  const ix1 = Math.min(x + elWidth, vw - PADDING);
  const iy1 = Math.min(y + elHeight, vh - PADDING);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const vis = iw * ih;
  const total = elWidth * elHeight;
  return total > 0 ? vis / total : 0;
}

/** Usable top-left range so the shell never leaves the padded viewport. */
function viewportPoseBounds(elWidth: number, elHeight: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const maxX = Math.max(PADDING, w - elWidth - PADDING);
  const maxY = Math.max(PADDING, h - elHeight - PADDING - bottomReservedPx());
  return { minX: PADDING, minY: PADDING, maxX, maxY };
}

function getCornerPositions(elWidth: number, elHeight: number) {
  const { minX, minY, maxX, maxY } = viewportPoseBounds(elWidth, elHeight);
  return {
    br: { x: maxX, y: maxY },
    bl: { x: minX, y: maxY },
    tr: { x: maxX, y: minY },
    tl: { x: minX, y: minY },
  };
}

/** Nearest corner by element center — always returns an on-screen pose. */
function nearestCornerPose(x: number, y: number, elWidth: number, elHeight: number) {
  const corners = Object.values(getCornerPositions(elWidth, elHeight));
  const cx = x + elWidth / 2;
  const cy = y + elHeight / 2;
  let nearest = corners[0]!;
  let nearestDist = Infinity;
  for (const c of corners) {
    const d = Math.hypot(cx - (c.x + elWidth / 2), cy - (c.y + elHeight / 2));
    if (d < nearestDist) {
      nearestDist = d;
      nearest = c;
    }
  }
  return { x: nearest.x, y: nearest.y };
}

function clampFreeInViewport(x: number, y: number, elWidth: number, elHeight: number) {
  const { minX, minY, maxX, maxY } = viewportPoseBounds(elWidth, elHeight);
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/**
 * Corner settling once ≥half the shell is outside the padded viewport.
 * When `forceCorners` is on (user setting), always snap to one of the four corners only.
 */
function settlePositionAfterGesture(
  x: number,
  y: number,
  elWidth: number,
  elHeight: number,
  forceCorners = false,
): { x: number; y: number } {
  if (typeof window === "undefined") return clampFreeInViewport(x, y, elWidth, elHeight);
  if (forceCorners) return nearestCornerPose(x, y, elWidth, elHeight);
  const ratio = visibleAreaFraction(x, y, elWidth, elHeight);
  if (ratio > OFFSCREEN_RATIO_SNAP) return clampFreeInViewport(x, y, elWidth, elHeight);
  return nearestCornerPose(x, y, elWidth, elHeight);
}

/** Match `MiniPlayer` max-w-[calc(100vw-1.5rem)] */
function viewportSideMarginPx(): number {
  if (typeof window === "undefined") return 24;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return rem * 1.5;
}

/** Max width for current screen: at most 400px, and never wider than the padded viewport. */
export function getViewportMaxMiniPlayerWidth(): number {
  if (typeof window === "undefined") return ABSOLUTE_MAX_W;
  const byViewport = Math.floor(window.innerWidth - viewportSideMarginPx());
  return Math.min(ABSOLUTE_MAX_W, Math.max(MIN_W, byViewport));
}

/** Wider shell when the up-next queue is open — full width on phones, adaptive on desktop. */
export function getExpandedMiniPlayerWidth(viewportW: number): number {
  if (typeof window === "undefined") return PREFERRED_DEFAULT_W;
  const side = viewportSideMarginPx();
  const padded = Math.max(MIN_W, Math.floor(viewportW - side));
  if (viewportW < 640) return padded;
  const target = Math.floor(viewportW * 0.36);
  return Math.min(520, Math.max(360, target));
}

function loadStoredWidth(): number {
  if (typeof window === "undefined") return PREFERRED_DEFAULT_W;
  const cap = getViewportMaxMiniPlayerWidth();
  const raw = sessionStorage.getItem(STORAGE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return Math.min(PREFERRED_DEFAULT_W, cap);
  return Math.min(cap, Math.max(MIN_W, n));
}

function initialBottomRightPosition(width: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  const h = estimateShellHeight(width);
  return clampFreeInViewport(
    window.innerWidth - width - PADDING,
    window.innerHeight - h - PADDING - bottomReservedPx(),
    width,
    h,
  );
}

type TuckEdge = "none" | "left" | "right";

/**
 * @param sessionKey e.g. mini `unique_id`  resets corner + tuck whenever mini session changes.
 */
export function useMiniPlayerDrag(sessionKey: string, enabled = true) {
  const snapFloatsToCorners = useSnapFloatsToCorners();
  const snapCornersRef = useRef(snapFloatsToCorners);
  snapCornersRef.current = snapFloatsToCorners;
  const [frameWidthMax, setFrameWidthMax] = useState(() =>
    typeof window === "undefined" ? ABSOLUTE_MAX_W : getViewportMaxMiniPlayerWidth(),
  );
  const [frameWidth, setFrameWidth] = useState(() => loadStoredWidth());
  const [position, setPosition] = useState(() =>
    initialBottomRightPosition(typeof window === "undefined" ? PREFERRED_DEFAULT_W : loadStoredWidth()),
  );
  const [isSnapping, setIsSnapping] = useState(false);
  const [mounted] = useState(true);
  const [tuck, setTuck] = useState<TuckEdge>("none");
  /** State (not ref) so consumers can disable CSS transition during drag. */
  const [isDraggingState, setIsDraggingState] = useState(false);

  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const didDragRef = useRef(false);
  /** True during a drag that started from a tucked state  uses wider re-tuck threshold. */
  const wasTuckedRef = useRef(false);
  const removeDragWindowListenersRef = useRef<(() => void) | null>(null);
  const startRef = useRef({ pointerX: 0, pointerY: 0, elX: 0, elY: 0, w: PREFERRED_DEFAULT_W });
  const positionRef = useRef(position);
  positionRef.current = position;
  const tuckRef = useRef<TuckEdge>("none");
  tuckRef.current = tuck;
  const vpRef = useRef({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  });
  const elSizeRef = useRef({
    width: typeof window === "undefined" ? PREFERRED_DEFAULT_W : loadStoredWidth(),
    height: estimateShellHeight(typeof window === "undefined" ? PREFERRED_DEFAULT_W : loadStoredWidth()),
  });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const frameWidthRef = useRef(frameWidth);
  frameWidthRef.current = frameWidth;
  /** When true, height growth must not push the shell upward (queue open/close). */
  const lockTopAnchorRef = useRef(false);

  useEffect(() => {
    const syncCap = () => {
      const cap = getViewportMaxMiniPlayerWidth();
      setFrameWidthMax(cap);
      setFrameWidth((w) => Math.min(cap, Math.max(MIN_W, w)));
    };
    syncCap();
    window.addEventListener("resize", syncCap);
    return () => window.removeEventListener("resize", syncCap);
  }, []);
  /** Live drag delta, written direct to DOM via transform  bypasses React for smoothness. */
  const dragDeltaRef = useRef({ dx: 0, dy: 0 });

  const measureAndCacheSize = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;
    // offset* ignores drag transforms and overflowing ambient glow.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width > 0 && height > 0) {
      elSizeRef.current = { width, height };
    }
  }, []);

  const visPosition = useCallback(
    (freeX: number, freeY: number, width: number, height: number, t: TuckEdge) => {
      const { minY, maxY } = viewportPoseBounds(width, height);
      const y = Math.min(maxY, Math.max(minY, freeY));
      if (t === "right") {
        return { x: window.innerWidth - PEEK_PX, y };
      }
      if (t === "left") {
        return { x: PEEK_PX - width, y };
      }
      return clampFreeInViewport(freeX, freeY, width, height);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!enabled) return;
    setTuck("none");
    const w = frameWidthRef.current;
    const est = initialBottomRightPosition(w);
    setPosition(est);
    elSizeRef.current = { width: w, height: estimateShellHeight(w) };

    measureAndCacheSize();
    const el = elementRef.current;
    if (el) {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width > 0 && height > 0) {
        setPosition(getCornerPositions(width, height).br);
        elSizeRef.current = { width, height };
      }
    }
  }, [sessionKey, enabled, measureAndCacheSize]);

  useEffect(() => {
    if (!enabled || !mounted) return;
    measureAndCacheSize();
    const { width, height } = elSizeRef.current;
    setPosition((p) => visPosition(p.x, p.y, width, height, tuck));
  }, [frameWidth, mounted, enabled, measureAndCacheSize, tuck, visPosition]);

  // The shell height can change AFTER placement (aspect-ratio arrives from
  // video metadata, title wraps, ...). Re-clamp whenever the element's real
  // size changes so a grown mini never hangs past the viewport edge.
  useEffect(() => {
    if (!enabled) return;
    const el = elementRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const prev = elSizeRef.current;
      measureAndCacheSize();
      const { width, height } = elSizeRef.current;
      if (Math.abs(width - prev.width) < 1 && Math.abs(height - prev.height) < 1) return;
      setPosition((p) => {
        if (lockTopAnchorRef.current) {
          const maxX = window.innerWidth - width - PADDING;
          const x = Math.max(PADDING, Math.min(maxX, p.x));
          return x === p.x ? p : { x, y: p.y };
        }
        const next = visPosition(p.x, p.y, width, height, tuckRef.current);
        return next.x === p.x && next.y === p.y ? p : next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, measureAndCacheSize, visPosition]);

  useEffect(() => {
    if (!enabled) return;
    const onResize = () => {
      if (isDragging.current || isResizing.current) return;
      measureAndCacheSize();
      const { width, height } = elSizeRef.current;
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      const old = vpRef.current;
      vpRef.current = { w: nw, h: nh };
      setIsSnapping(true);
      if (tuckRef.current !== "none" && !snapCornersRef.current) {
        setPosition(visPosition(0, positionRef.current.y, width, height, tuckRef.current));
      } else {
        // Remap by viewport ratio so shrink→expand doesn’t leave the mini
        // stranded at the old small-screen coordinates.
        const bottomOld = PADDING + bottomReservedPx();
        const maxOldX = Math.max(1, old.w - width - PADDING);
        const maxOldY = Math.max(1, old.h - height - bottomOld);
        const rx = (positionRef.current.x - PADDING) / maxOldX;
        const ry = (positionRef.current.y - PADDING) / maxOldY;
        const maxNewX = Math.max(PADDING, nw - width - PADDING);
        const maxNewY = Math.max(PADDING, nh - height - PADDING - bottomReservedPx());
        const mapped = {
          x: PADDING + Math.min(1, Math.max(0, rx)) * (maxNewX - PADDING),
          y: PADDING + Math.min(1, Math.max(0, ry)) * (maxNewY - PADDING),
        };
        const snap = settlePositionAfterGesture(
          mapped.x,
          mapped.y,
          width,
          height,
          snapCornersRef.current && !lockTopAnchorRef.current,
        );
        setTuck("none");
        setPosition(snap);
      }
      window.setTimeout(() => setIsSnapping(false), SNAP_TRANSITION_MS);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled, measureAndCacheSize, visPosition]);

  // When corner-snap turns on, settle once after layout (avoid fighting mount/resize).
  const prevSnapCornersRef = useRef(snapFloatsToCorners);
  useEffect(() => {
    const wasOn = prevSnapCornersRef.current;
    prevSnapCornersRef.current = snapFloatsToCorners;
    if (!enabled || !snapFloatsToCorners || wasOn) return;
    if (isDragging.current || isResizing.current || lockTopAnchorRef.current) return;
    const id = window.requestAnimationFrame(() => {
      measureAndCacheSize();
      const { width, height } = elSizeRef.current;
      if (width < 8 || height < 8) return;
      setTuck("none");
      setIsSnapping(true);
      setPosition((p) => nearestCornerPose(p.x, p.y, width, height));
      window.setTimeout(() => setIsSnapping(false), SNAP_TRANSITION_MS);
    });
    return () => window.cancelAnimationFrame(id);
  }, [enabled, snapFloatsToCorners, measureAndCacheSize]);

  /**
   * Force the mini back inside the viewport using its CURRENT measured size.
   * Called when the queue expands/loads (which grows the shell downward) so a
   * mini dragged near the bottom can never end up stranded off-screen.
   */
  const clampIntoView = useCallback(() => {
    if (isDragging.current || isResizing.current) return;
    measureAndCacheSize();
    const { width, height } = elSizeRef.current;
    setPosition((p) => {
      const next = visPosition(p.x, p.y, width, height, tuckRef.current);
      return next.x === p.x && next.y === p.y ? p : next;
    });
  }, [measureAndCacheSize, visPosition]);

  const endDragGesture = useCallback(
    (captureEl: HTMLElement | null, pointerId: number) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsDraggingState(false);
      removeDragWindowListenersRef.current?.();
      removeDragWindowListenersRef.current = null;
      if (captureEl) {
        try {
          captureEl.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
      }
      measureAndCacheSize();
      const { width, height } = elSizeRef.current;
      // Final drag position = start position + accumulated delta written to transform.
      const { dx, dy } = dragDeltaRef.current;
      const x = startRef.current.elX + dx;
      const y = startRef.current.elY + dy;
      dragDeltaRef.current = { dx: 0, dy: 0 };

      const forceCorners = snapCornersRef.current && !lockTopAnchorRef.current;
      let nextTuck: TuckEdge = "none";
      let snap: { x: number; y: number };

      if (forceCorners) {
        // Setting on: only the four screen corners — never edge tuck / mid-edge.
        snap = nearestCornerPose(x, y, width, height);
      } else {
        const rightEdge = x + width;
        const distRight = window.innerWidth - rightEdge;
        const distLeft = x;
        const edgeThreshold = wasTuckedRef.current ? UNTUCK_RE_TUCK_PX : EDGE_TUCK_PX;
        const offscreenEnough =
          visibleAreaFraction(x, y, width, height) <= OFFSCREEN_RATIO_SNAP;

        if (didDragRef.current && offscreenEnough && distRight <= edgeThreshold) {
          nextTuck = "right";
          snap = visPosition(x, y, width, height, "right");
        } else if (didDragRef.current && offscreenEnough && distLeft <= edgeThreshold) {
          nextTuck = "left";
          snap = visPosition(x, y, width, height, "left");
        } else {
          snap = settlePositionAfterGesture(x, y, width, height, false);
        }
      }

      wasTuckedRef.current = false;

      // Hand-off from transform → left/top at the release point, reflow to
      // commit that FROM pose, then write the snap target + easing in the same
      // task. The DOM write must NOT be left to React: when the shell settles
      // back into the corner it started from, `position` state is unchanged and
      // React skips the style write entirely — the shell would freeze at the
      // release point. State follows with identical values, so whether React
      // writes or skips, the DOM already agrees. One writer, one animation.
      const el = elementRef.current;
      if (el) {
        el.style.transition = "none";
        el.style.transform = "";
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        void el.offsetWidth;
        el.style.transition = `left ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}, top ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}`;
        el.style.left = `${snap.x}px`;
        el.style.top = `${snap.y}px`;
      }

      positionRef.current = snap;
      setTuck(nextTuck);
      setIsSnapping(true);
      setPosition(snap);
      window.setTimeout(() => setIsSnapping(false), SNAP_TRANSITION_MS);
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    },
    [measureAndCacheSize, visPosition],
  );

  const beginDrag = useCallback(
    (e: { button: number; clientX: number; clientY: number; pointerId: number }, captureEl: HTMLElement) => {
      if (e.button !== 0) return;
      if (isDragging.current) return;

      removeDragWindowListenersRef.current?.();
      removeDragWindowListenersRef.current = null;

      setIsSnapping(false);
      isDragging.current = true;
      setIsDraggingState(true);
      didDragRef.current = false;
      dragDeltaRef.current = { dx: 0, dy: 0 };
      measureAndCacheSize();
      const { width } = elSizeRef.current;
      let elX = positionRef.current.x;
      let elY = positionRef.current.y;
      if (tuckRef.current !== "none") {
        wasTuckedRef.current = true;
        setTuck("none");
      }
      startRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        elX,
        elY,
        w: width,
      };

      const pointerId = e.pointerId;
      let captured = false;

      let onWindowMove: (ev: PointerEvent) => void;
      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onWindowMove);
        window.removeEventListener("pointerup", onWindowUp);
        window.removeEventListener("pointercancel", onWindowUp);
        removeDragWindowListenersRef.current = null;
        endDragGesture(captureEl, pointerId);
      };
      onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (!isDragging.current) return;
        if ((ev.buttons & 1) === 0) {
          onWindowUp(ev);
          return;
        }
        const { pointerX, pointerY } = startRef.current;
        const dx = ev.clientX - pointerX;
        const dy = ev.clientY - pointerY;
        if (!didDragRef.current && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
          return;
        }
        if (!didDragRef.current) {
          didDragRef.current = true;
          if (!captured) {
            captured = true;
            try {
              captureEl.setPointerCapture(pointerId);
            } catch {
              /* ignore */
            }
          }
        }
        const el = elementRef.current;
        if (el) {
          el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        }
        dragDeltaRef.current = { dx, dy };
      };

      window.addEventListener("pointermove", onWindowMove);
      window.addEventListener("pointerup", onWindowUp);
      window.addEventListener("pointercancel", onWindowUp);
      removeDragWindowListenersRef.current = () => {
        window.removeEventListener("pointermove", onWindowMove);
        window.removeEventListener("pointerup", onWindowUp);
        window.removeEventListener("pointercancel", onWindowUp);
      };
    },
    [measureAndCacheSize, endDragGesture],
  );

  // Native DOM listener so the title/footer chrome can drag. The docked video
  // lives in a higher-z GlobalAnchored portal — that surface calls
  // dispatchMiniPlayerDrag via the bridge below.
  // `enabled` must be a dep: mobile bar ↔ desktop swap remounts the shell, and
  // without it listeners never reattach after a viewport resize past 700px.
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = elementRef.current;
    if (!root) return;
    const onPointerDown = (e: PointerEvent) => {
      if (isMiniPlayerDragLocked()) return;
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-mini-no-drag]")) return;
      if (target.closest("[data-mini-resize]")) return;
      beginDrag(e, root);
    };
    root.addEventListener("pointerdown", onPointerDown);
    return () => root.removeEventListener("pointerdown", onPointerDown);
  }, [beginDrag, sessionKey, enabled]);

  useLayoutEffect(() => {
    if (!enabled) {
      registerMiniPlayerDragHandler(null);
      return;
    }
    const root = elementRef.current;
    if (!root) {
      registerMiniPlayerDragHandler(null);
      return;
    }
    registerMiniPlayerDragHandler((e) => {
      if (isMiniPlayerDragLocked()) return;
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-mini-no-drag]")) return;
      if (target.closest("[data-mini-resize]")) return;
      beginDrag(e, root);
    });
    return () => registerMiniPlayerDragHandler(null);
  }, [beginDrag, sessionKey, enabled]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || isMiniPlayerDragLocked()) return;
      e.stopPropagation();
      beginDrag(e, (e.currentTarget as HTMLElement) || elementRef.current!);
    },
    [beginDrag, enabled],
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      measureAndCacheSize();
      isResizing.current = true;
      startRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        elX: positionRef.current.x,
        elY: positionRef.current.y,
        w: frameWidth,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [frameWidth, measureAndCacheSize],
  );

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing.current) return;
    const dx = e.clientX - startRef.current.pointerX;
    const next = Math.min(frameWidthMax, Math.max(MIN_W, startRef.current.w + dx));
    setFrameWidth(next);
  }, [frameWidthMax]);

  const handleResizePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing.current) return;
      isResizing.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      measureAndCacheSize();
      const { width, height } = elSizeRef.current;
      try {
        sessionStorage.setItem(STORAGE_KEY, String(Math.round(width)));
      } catch {
        /* ignore */
      }
      setIsSnapping(true);
      if (tuckRef.current !== "none" && !snapCornersRef.current) {
        setPosition(visPosition(0, positionRef.current.y, width, height, tuckRef.current));
      } else {
        setTuck("none");
        setPosition(
          settlePositionAfterGesture(
            positionRef.current.x,
            positionRef.current.y,
            width,
            height,
            snapCornersRef.current && !lockTopAnchorRef.current,
          ),
        );
      }
      window.setTimeout(() => setIsSnapping(false), SNAP_TRANSITION_MS);
    },
    [measureAndCacheSize, visPosition],
  );

  /** Keep top-left fixed while the queue panel opens/closes (height is pre-fit). */
  const setLockTopAnchor = useCallback((locked: boolean) => {
    lockTopAnchorRef.current = locked;
  }, []);

  return {
    elementRef,
    position,
    frameWidth,
    frameWidthMax,
    tuck,
    isSnapping,
    isDragging: isDraggingState,
    mounted,
    handlePointerDown,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerUp,
    clampIntoView,
    setLockTopAnchor,
  };
}
