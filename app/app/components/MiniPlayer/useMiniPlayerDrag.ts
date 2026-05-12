import { useCallback, useRef, useState, useLayoutEffect, useEffect } from "react";

const PADDING = 12;
const DRAG_THRESHOLD_PX = 4;
const SPRING_MS = 380;
const STORAGE_KEY = "mini-player-width-v1";
const MIN_W = 260;
/** Hard cap — never wider than this */
const ABSOLUTE_MAX_W = 400;
/** Preferred default when the viewport has room */
const PREFERRED_DEFAULT_W = 340;
/** Chrome + title block + 16:9 video (approx) — used until DOM measures. */
function estimateShellHeight(width: number) {
  return 36 + 52 + (width * 9) / 16;
}

/** Visible strip when tucked to screen edge (Apple PiP–style). */
const PEEK_PX = 30;
const EDGE_TUCK_PX = 28;
/** Extra threshold when the player was just un-tucked — prevents accidental re-tuck. */
const UNTUCK_RE_TUCK_PX = 80;

/** Max distance from a corner snap pose (element top-left) to actually snap; otherwise stay free-dragged inside the viewport (mobile was effectively “all corners”). */
function cornerSnapProximityPx(): number {
  if (typeof window === "undefined") return 88;
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  if (window.innerWidth <= 767) return Math.round(Math.min(72, Math.max(40, shortEdge * 0.104)));
  return Math.round(Math.min(130, Math.max(88, shortEdge * 0.148)));
}

type TuckEdge = "none" | "left" | "right";

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
  return {
    x: window.innerWidth - width - PADDING,
    y: window.innerHeight - h - PADDING,
  };
}

function getCornerPositions(elWidth: number, elHeight: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    br: { x: w - elWidth - PADDING, y: h - elHeight - PADDING },
    bl: { x: PADDING, y: h - elHeight - PADDING },
    tr: { x: w - elWidth - PADDING, y: PADDING },
    tl: { x: PADDING, y: PADDING },
  };
}

function snapCornerIfCloseElseClampFree(
  x: number,
  y: number,
  elWidth: number,
  elHeight: number,
  proximityPx: number,
): { x: number; y: number } {
  const corners = Object.values(getCornerPositions(elWidth, elHeight));
  let nearest = corners[0];
  let nearestDist = Infinity;
  for (const c of corners) {
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = c;
    }
  }
  if (nearestDist <= proximityPx) {
    return { x: nearest.x, y: clampY(nearest.y, elHeight) };
  }
  const maxX = window.innerWidth - elWidth - PADDING;
  return {
    x: Math.max(PADDING, Math.min(maxX, x)),
    y: clampY(y, elHeight),
  };
}

/**
 * @param sessionKey e.g. mini `unique_id` — resets corner + tuck whenever mini session changes.
 */
export function useMiniPlayerDrag(sessionKey: string) {
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
  /** True during a drag that started from a tucked state — uses wider re-tuck threshold. */
  const wasTuckedRef = useRef(false);
  const removeDragWindowListenersRef = useRef<(() => void) | null>(null);
  const startRef = useRef({ pointerX: 0, pointerY: 0, elX: 0, elY: 0, w: PREFERRED_DEFAULT_W });
  const positionRef = useRef(position);
  positionRef.current = position;
  const tuckRef = useRef<TuckEdge>("none");
  tuckRef.current = tuck;
  const elSizeRef = useRef({
    width: typeof window === "undefined" ? PREFERRED_DEFAULT_W : loadStoredWidth(),
    height: estimateShellHeight(typeof window === "undefined" ? PREFERRED_DEFAULT_W : loadStoredWidth()),
  });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const frameWidthRef = useRef(frameWidth);
  frameWidthRef.current = frameWidth;

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
  /** Live drag delta, written direct to DOM via transform — bypasses React for smoothness. */
  const dragDeltaRef = useRef({ dx: 0, dy: 0 });

  const measureAndCacheSize = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      elSizeRef.current = { width: rect.width, height: rect.height };
    }
  }, []);

  const visPosition = useCallback(
    (freeX: number, freeY: number, width: number, height: number, t: TuckEdge) => {
      if (t === "right") {
        return { x: window.innerWidth - PEEK_PX, y: clampY(freeY, height) };
      }
      if (t === "left") {
        return { x: PEEK_PX - width, y: clampY(freeY, height) };
      }
      return { x: freeX, y: clampY(freeY, height) };
    },
    [],
  );

  useLayoutEffect(() => {
    setTuck("none");
    const w = frameWidthRef.current;
    const est = initialBottomRightPosition(w);
    setPosition(est);
    elSizeRef.current = { width: w, height: estimateShellHeight(w) };

    measureAndCacheSize();
    const el = elementRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const br = getCornerPositions(rect.width, rect.height).br;
        setPosition({ x: br.x, y: clampY(br.y, rect.height) });
        elSizeRef.current = { width: rect.width, height: rect.height };
      }
    }
  }, [sessionKey, measureAndCacheSize]);

  useEffect(() => {
    if (!mounted) return;
    measureAndCacheSize();
    const { width, height } = elSizeRef.current;
    setPosition((p) => visPosition(p.x, p.y, width, height, tuck));
  }, [frameWidth, mounted, measureAndCacheSize, tuck, visPosition]);

  useEffect(() => {
    const onResize = () => {
      if (isDragging.current || isResizing.current) return;
      measureAndCacheSize();
      const { width, height } = elSizeRef.current;
      setIsSnapping(true);
      if (tuckRef.current !== "none") {
        setPosition(visPosition(0, positionRef.current.y, width, height, tuckRef.current));
      } else {
        const snap = snapCornerIfCloseElseClampFree(
          positionRef.current.x,
          positionRef.current.y,
          width,
          height,
          cornerSnapProximityPx(),
        );
        setTuck("none");
        setPosition(snap);
      }
      window.setTimeout(() => setIsSnapping(false), SPRING_MS);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
      // Clear inline transform; commit final left/top to React state in the same render.
      const el = elementRef.current;
      if (el) {
        el.style.transform = "";
      }
      dragDeltaRef.current = { dx: 0, dy: 0 };
      positionRef.current = { x, y };
      const rightEdge = x + width;
      const distRight = window.innerWidth - rightEdge;
      const distLeft = x;
      const edgeThreshold = wasTuckedRef.current ? UNTUCK_RE_TUCK_PX : EDGE_TUCK_PX;

      let nextTuck: TuckEdge = "none";
      let snap = { x, y: clampY(y, height) };

      if (didDragRef.current && distRight <= edgeThreshold) {
        nextTuck = "right";
        snap = visPosition(x, y, width, height, "right");
      } else if (didDragRef.current && distLeft <= edgeThreshold) {
        nextTuck = "left";
        snap = visPosition(x, y, width, height, "left");
      } else {
        snap = snapCornerIfCloseElseClampFree(x, y, width, height, cornerSnapProximityPx());
      }

      wasTuckedRef.current = false;
      setTuck(nextTuck);
      setIsSnapping(true);
      setPosition(snap);
      window.setTimeout(() => setIsSnapping(false), SPRING_MS);
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    },
    [measureAndCacheSize, visPosition],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (isDragging.current) return;

      removeDragWindowListenersRef.current?.();
      removeDragWindowListenersRef.current = null;

      setIsSnapping(false);
      isDragging.current = true;
      setIsDraggingState(true);
      didDragRef.current = false;
      dragDeltaRef.current = { dx: 0, dy: 0 };
      measureAndCacheSize();
      const { width, height } = elSizeRef.current;
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

      const captureEl = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      try {
        captureEl.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }

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
        didDragRef.current = true;
        // Write transform direct to DOM — no React state, no re-render, no transition fight.
        // GPU-composited; tracks the cursor 1:1.
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
    [measureAndCacheSize, visPosition, endDragGesture],
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
      if (tuckRef.current !== "none") {
        setPosition(visPosition(0, positionRef.current.y, width, height, tuckRef.current));
      } else {
        setPosition(
          snapCornerIfCloseElseClampFree(
            positionRef.current.x,
            positionRef.current.y,
            width,
            height,
            cornerSnapProximityPx(),
          ),
        );
      }
      window.setTimeout(() => setIsSnapping(false), SPRING_MS);
    },
    [measureAndCacheSize, visPosition],
  );

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
  };
}

function clampY(y: number, elHeight: number) {
  const maxY = window.innerHeight - elHeight - PADDING;
  return Math.max(PADDING, Math.min(maxY, y));
}
