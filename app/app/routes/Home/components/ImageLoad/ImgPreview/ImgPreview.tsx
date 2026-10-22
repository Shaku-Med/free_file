import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, Download, RotateCw, Scan, X, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { cn } from "~/lib/utils";

/** Past this, letting go of a drag closes the preview, as in the app. */
const DISMISS_DISTANCE = 110;
/** px per ms; a quick flick closes from a shorter drag. */
const DISMISS_VELOCITY = 0.6;

/** How small the picture gets as it is dragged away. */
const dragShrink = (dist: number) => 1 - Math.min(dist / 400, 1) * 0.28;

/** Screen-space box of the thumbnail we morph out of / back into. */
export type MorphRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  radius?: number;
};

/** object-contain pixel bounds of an image inside its container (not the full box). */
export function measureContainedImageRect(
  container: HTMLElement,
  img: HTMLImageElement | null,
): MorphRect | null {
  const cr = container.getBoundingClientRect();
  if (cr.width <= 0 || cr.height <= 0) return null;
  const radius = parseFloat(getComputedStyle(container).borderTopLeftRadius) || 0;

  if (!img?.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return { top: cr.top, left: cr.left, width: cr.width, height: cr.height, radius };
  }

  const scale = Math.min(cr.width / img.naturalWidth, cr.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  return {
    top: cr.top + (cr.height - h) / 2,
    left: cr.left + (cr.width - w) / 2,
    width: w,
    height: h,
    radius,
  };
}

interface ImgPreviewProps {
  images: string[];
  index: number;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  colors?: string[];
  /** Thumbnail rect captured at open time, so the preview grows from source. */
  originRect?: MorphRect | null;
  /** Live re-measure of that thumbnail, used on close in case it moved. */
  getOriginRect?: () => MorphRect | null;
  /** The exact pixels already on screen in the thumbnail (blob/url) for a seamless morph. */
  originSrc?: string;
}

export default function ImgPreview({
  images,
  index: initialIndex,
  isOpen,
  setIsOpen,
  originRect = null,
  getOriginRect,
  originSrc,
}: ImgPreviewProps) {
  const reduceMotion = useReducedMotion();

  const [current, setCurrent] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [showControls, setShowControls] = useState(true);
  // Where a one-finger drag at normal zoom has pulled the picture; letting go far enough closes.
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dismissing = useRef(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  // Pinch
  const lastPinchDist = useRef(0);
  const lastPinchMid = useRef({ x: 0, y: 0 });
  const pinching = useRef(false);
  // True for the whole gesture once a second finger touches down. Releasing a
  // pinch fires two touchends <300ms apart, which the double-tap detector would
  // otherwise read as a double-tap (and reset the zoom). This flag suppresses
  // tap handling for any gesture that involved two fingers.
  const gestureWasMultiTouch = useRef(false);

  // Swipe
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);

  // ── Morph from source ──
  // An overlay <img> that springs from the thumbnail's on-screen box to the
  // preview's contained box (and back on close). It rides on top of the real
  // interactive image, which stays hidden until the morph settles, so the
  // zoom/pan machinery below never has to know this exists.
  const canMorph = Boolean(originRect) && !reduceMotion;
  const morphControls = useAnimationControls();
  const [morphPhase, setMorphPhase] = useState<"in" | "idle" | "out">(
    canMorph ? "in" : "idle",
  );
  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null);
  const closingRef = useRef(false);
  const morphSrc = originSrc || images[initialIndex] || images[current] || "";

  zoomRef.current = zoom;
  panRef.current = pan;

  const resolveOrigin = useCallback((): MorphRect | null => {
    const live = getOriginRect?.();
    if (live && live.width > 0 && live.height > 0) return live;
    if (originRect && originRect.width > 0 && originRect.height > 0) return originRect;
    return null;
  }, [getOriginRect, originRect]);

  // Where the image sits at rest: object-contain box centered in the viewport.
  const getContainRect = useCallback((): MorphRect | null => {
    if (!natSize || typeof window === "undefined") return null;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const s = Math.min(vpW / natSize.w, vpH / natSize.h);
    const w = natSize.w * s;
    const h = natSize.h * s;
    return { left: (vpW - w) / 2, top: (vpH - h) / 2, width: w, height: h, radius: 0 };
  }, [natSize]);

  // Play the open morph once we know the natural size (needed for the target box).
  useEffect(() => {
    if (!isOpen || morphPhase !== "in") return;
    const origin = resolveOrigin();
    const target = getContainRect();
    if (!origin || !target) return; // wait for onLoad → natSize
    let cancelled = false;
    morphControls.set({
      top: origin.top,
      left: origin.left,
      width: origin.width,
      height: origin.height,
      borderRadius: origin.radius ?? 0,
      opacity: 1,
    });
    morphControls
      .start({
        top: target.top,
        left: target.left,
        width: target.width,
        height: target.height,
        borderRadius: 0,
        transition: { type: "spring", stiffness: 300, damping: 32, mass: 0.9 },
      })
      .then(() => {
        if (cancelled) return;
        // Hand the frame back to the real interactive image and park the
        // overlay (still at the rest box) invisibly for a later close morph.
        morphControls.set({ opacity: 0 });
        setMorphPhase("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, morphPhase, natSize, resolveOrigin, getContainRect, morphControls]);

  // Safety net: never strand the real image behind the overlay if the morph
  // can't be computed (image failed to load, no natural size, etc.).
  useEffect(() => {
    if (morphPhase !== "in") return;
    const t = setTimeout(() => {
      morphControls.set({ opacity: 0 });
      setMorphPhase("idle");
    }, 450);
    return () => clearTimeout(t);
  }, [morphPhase, morphControls]);

  // Arm the open morph on every open. Needed for callers that keep ImgPreview
  // permanently mounted (so the initial `morphPhase` was decided before the
  // originRect existed) as well as for reopens.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpen.current && canMorph) setMorphPhase("in");
    prevOpen.current = isOpen;
  }, [isOpen, canMorph]);

  // Reverse the morph, then actually close. Falls back to an instant close when
  // there's nothing to morph to (reduced motion, thumbnail gone, mid-open).
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    const origin = canMorph ? resolveOrigin() : null;
    const rest = getContainRect();
    const { x: dx, y: dy } = dragRef.current;
    const k = dragShrink(Math.hypot(dx, dy));
    const from = rest && {
      left: rest.left + dx + (rest.width * (1 - k)) / 2,
      top: rest.top + dy + (rest.height * (1 - k)) / 2,
      width: rest.width * k,
      height: rest.height * k,
    };
    if (!origin || !from || morphPhase !== "idle") {
      setIsOpen(false);
      return;
    }
    closingRef.current = true;
    setMorphPhase("out");
    morphControls.set({
      top: from.top,
      left: from.left,
      width: from.width,
      height: from.height,
      borderRadius: 0,
      opacity: 1,
    });
    morphControls
      .start({
        top: origin.top,
        left: origin.left,
        width: origin.width,
        height: origin.height,
        borderRadius: origin.radius ?? 0,
        opacity: 0,
        transition: { type: "spring", stiffness: 340, damping: 36, mass: 0.85 },
      })
      .then(() => {
        closingRef.current = false;
        setIsOpen(false);
      });
  }, [canMorph, resolveOrigin, getContainRect, morphPhase, morphControls, setIsOpen]);

  useEffect(() => {
    setCurrent(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    setCurrent((c) =>
      images.length < 1 ? 0 : Math.min(c, images.length - 1)
    );
  }, [images.length]);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, [current]);

  useEffect(() => {
    if (!isOpen) {
      setDrag({ x: 0, y: 0 });
      dismissing.current = false;
      closingRef.current = false;
      setMorphPhase(canMorph ? "in" : "idle");
      setNatSize(null);
    }
  }, [isOpen, canMorph]);

  // ── Helpers ──

  const clampZoom = (z: number) => Math.min(Math.max(z, 1), 5);

  const getContainerCenter = () => {
    if (!containerRef.current) return { cx: 0, cy: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  };

  const clampPan = useCallback(
    (p: { x: number; y: number }, z: number) => {
      if (!containerRef.current) return p;
      const rect = containerRef.current.getBoundingClientRect();
      const overflowX = Math.max(0, (rect.width * (z - 1)) / 2);
      const overflowY = Math.max(0, (rect.height * (z - 1)) / 2);
      return {
        x: Math.min(overflowX, Math.max(-overflowX, p.x)),
        y: Math.min(overflowY, Math.max(-overflowY, p.y)),
      };
    },
    []
  );

  const zoomToward = useCallback(
    (clientX: number, clientY: number, newZoom: number) => {
      const oldZoom = zoomRef.current;
      const clamped = clampZoom(newZoom);
      if (clamped === oldZoom) return;

      const { cx, cy } = getContainerCenter();
      const px = clientX - cx - panRef.current.x;
      const py = clientY - cy - panRef.current.y;

      const scale = 1 - clamped / oldZoom;
      const nextPan = {
        x: panRef.current.x + px * scale,
        y: panRef.current.y + py * scale,
      };

      const clampedPan =
        clamped <= 1 ? { x: 0, y: 0 } : clampPan(nextPan, clamped);
      setZoom(clamped);
      setPan(clampedPan);
    },
    [clampPan]
  );

  // ── Auto-hide controls ──

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimer.current || 0);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    if (isOpen) resetHideTimer();
    return () => clearTimeout(hideTimer.current || 0);
  }, [isOpen, resetHideTimer]);

  // ── Navigation ──

  const go = useCallback(
    (dir: -1 | 1) => {
      setCurrent((prev) => (prev + dir + images.length) % images.length);
    },
    [images.length]
  );

  const zoomIn = () => {
    const { cx, cy } = getContainerCenter();
    zoomToward(cx, cy, zoomRef.current + 0.5);
  };
  const zoomOut = () => {
    const { cx, cy } = getContainerCenter();
    zoomToward(cx, cy, zoomRef.current - 0.5);
  };
  const rotate = () => setRotation((r) => (r + 90) % 360);
  const resetView = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleDownload = () => {
    const src = images[current];
    const a = document.createElement("a");
    a.href = src;
    a.download = `image-${current + 1}`;
    a.click();
  };

  // ── Block browser Ctrl/Cmd+key zoom globally while dialog is open ──

  useEffect(() => {
    if (!isOpen) return;
    const blockBrowserKeyZoom = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "0")
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", blockBrowserKeyZoom);
    return () => document.removeEventListener("keydown", blockBrowserKeyZoom);
  }, [isOpen]);

  // ── Keyboard ──

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      resetHideTimer();
      switch (e.key) {
        case "ArrowLeft":
          go(-1);
          break;
        case "ArrowRight":
          go(1);
          break;
        case "Escape":
          requestClose();
          break;
        case "+":
        case "=":
          if (e.ctrlKey || e.metaKey) zoomIn();
          break;
        case "-":
          if (e.ctrlKey || e.metaKey) zoomOut();
          break;
        case "0":
          if (e.ctrlKey || e.metaKey) resetView();
          break;
        case "r":
          rotate();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, go, requestClose, resetHideTimer]);

  // ── Wheel zoom: Ctrl/Cmd+wheel anywhere while open, or scroll over the image without modifier ──

  useEffect(() => {
    if (!isOpen) return;

    const onWheel = (e: WheelEvent) => {
      const el = containerRef.current;
      const over =
        !!el &&
        (e.target === el ||
          (e.target instanceof Node && el.contains(e.target)));
      const withModifier = e.ctrlKey || e.metaKey;
      if (!withModifier && !over) return;

      e.preventDefault();
      e.stopPropagation();
      resetHideTimer();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      zoomToward(e.clientX, e.clientY, zoomRef.current + delta);
    };

    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, [isOpen, zoomToward, resetHideTimer]);

  // ── Pointer: only for mouse drag pan when zoomed ──

  const handlePointerDown = (e: React.PointerEvent) => {
    resetHideTimer();
    // Only capture mouse, not touch  touch needs to flow to touch handlers for swipe
    if (e.pointerType !== "mouse") return;
    if (pinching.current) return;
    if (zoomRef.current <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...panRef.current };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (!dragging || pinching.current) return;
    const nextPan = {
      x: panStart.current.x + (e.clientX - dragStart.current.x),
      y: panStart.current.y + (e.clientY - dragStart.current.y),
    };
    setPan(clampPan(nextPan, zoomRef.current));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    setDragging(false);
  };

  // ── Touch: pinch zoom, swipe nav, single-finger pan when zoomed ──

  const getPinchInfo = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return {
      dist: Math.hypot(dx, dy),
      midX: (touches[0].clientX + touches[1].clientX) / 2,
      midY: (touches[0].clientY + touches[1].clientY) / 2,
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    resetHideTimer();

    if (e.touches.length === 2) {
      pinching.current = true;
      gestureWasMultiTouch.current = true;
      swipeStart.current = null;
      const info = getPinchInfo(e.touches);
      lastPinchDist.current = info.dist;
      lastPinchMid.current = { x: info.midX, y: info.midY };
    } else if (e.touches.length === 1) {
      // Fresh single-finger gesture  clear the multi-touch flag so genuine
      // double-taps still work.
      gestureWasMultiTouch.current = false;
      swipeStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        t: Date.now(),
      };

      // If zoomed, start pan tracking
      if (zoomRef.current > 1) {
        setDragging(true);
        dragStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
        panStart.current = { ...panRef.current };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinching.current) {
      e.preventDefault();
      const info = getPinchInfo(e.touches);
      const scaleFactor = info.dist / lastPinchDist.current;
      const newZoom = zoomRef.current * scaleFactor;
      lastPinchDist.current = info.dist;
      zoomToward(info.midX, info.midY, newZoom);
      lastPinchMid.current = { x: info.midX, y: info.midY };
      swipeStart.current = null;
    } else if (e.touches.length === 1 && !pinching.current) {
      const start = swipeStart.current;
      if (zoomRef.current <= 1 && start) {
        const dx = e.touches[0].clientX - start.x;
        const dy = e.touches[0].clientY - start.y;
        // With several pictures a sideways swipe still changes picture; anything else drags it away.
        const sideways = images.length > 1 && Math.abs(dx) > Math.abs(dy) * 1.3;
        if (dismissing.current || (!sideways && Math.hypot(dx, dy) > 8)) {
          dismissing.current = true;
          setDrag({ x: dx, y: dy });
        }
        return;
      }
      if (zoomRef.current > 1 && dragging) {
        // Pan when zoomed
        const nextPan = {
          x: panStart.current.x + (e.touches[0].clientX - dragStart.current.x),
          y: panStart.current.y + (e.touches[0].clientY - dragStart.current.y),
        };
        setPan(clampPan(nextPan, zoomRef.current));
      }
      // Let swipe detection happen on touchEnd  don't cancel swipeStart here
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinching.current = false;
    }

    setDragging(false);

    if (dismissing.current) {
      dismissing.current = false;
      const start = swipeStart.current;
      swipeStart.current = null;
      const { x, y } = dragRef.current;
      const dist = Math.hypot(x, y);
      const speed = start ? dist / Math.max(1, Date.now() - start.t) : 0;
      if (dist > DISMISS_DISTANCE || speed > DISMISS_VELOCITY) requestClose();
      else setDrag({ x: 0, y: 0 });
      lastTouch.current = 0;
      return;
    }

    // Swipe detection (only at 1x zoom)
    if (
      swipeStart.current &&
      e.changedTouches.length === 1 &&
      zoomRef.current <= 1
    ) {
      const end = e.changedTouches[0];
      const dx = end.clientX - swipeStart.current.x;
      const dy = end.clientY - swipeStart.current.y;
      const dt = Date.now() - swipeStart.current.t;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx > 50 && absDx > absDy * 1.3 && dt < 500) {
        go(dx < 0 ? 1 : -1);
        swipeStart.current = null;
        return;
      }
    }

    swipeStart.current = null;
  };

  // ── Tap handling (mouse only  touch uses swipe) ──

  const lastTap = useRef(0);
  const handleClick = (e: React.MouseEvent) => {
    // Ignore if this came from a touch (swipe handles that)
    if ((e as unknown as PointerEvent).pointerType === "touch") return;

    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (zoomRef.current > 1) {
        resetView();
      } else {
        zoomToward(e.clientX, e.clientY, 2);
      }
      lastTap.current = 0;
    } else {
      lastTap.current = now;
      setTimeout(() => {
        if (lastTap.current === now) {
          setShowControls((s) => !s);
          if (!showControls) resetHideTimer();
        }
      }, 300);
    }
  };

  // Double-tap for touch
  const lastTouch = useRef(0);
  const handleTouchEndTap = (e: React.TouchEvent) => {
    // Only count single-finger taps that didn't swipe and weren't part of a pinch
    // (releasing a pinch must never register as a double-tap that resets zoom).
    if (e.changedTouches.length !== 1 || pinching.current || gestureWasMultiTouch.current || dismissing.current) return;

    const now = Date.now();
    const touch = e.changedTouches[0];

    if (now - lastTouch.current < 300) {
      if (zoomRef.current > 1) {
        resetView();
      } else {
        zoomToward(touch.clientX, touch.clientY, 2);
      }
      lastTouch.current = 0;
    } else {
      lastTouch.current = now;
    }
  };

  // Merge touchEnd handlers
  const onTouchEnd = (e: React.TouchEvent) => {
    const wasDrag = dismissing.current;
    handleTouchEnd(e);
    if (!wasDrag) handleTouchEndTap(e);
  };

  const controlsClass = `transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`;

  if (images.length < 1) return null;

  const imageSrc = images[current];
  if (!imageSrc) return null;

  const dragDist = Math.hypot(drag.x, drag.y);
  const following = dismissing.current;
  const backdrop = Math.max(0.25, 1 - dragDist / 300);

  return (
    <Dialog
      presentation="fullscreen"
      open={isOpen}
      onOpenChange={(open) => {
        if (open) setIsOpen(true);
        else requestClose();
      }}
    >
      <DialogContent
        edgeToEdge
        showCloseButton={false}
        overlayClassName="bg-transparent data-[state=open]:duration-300 data-[state=closed]:duration-200"
        className="fixed inset-0 flex min-h-full min-w-full max-h-none max-w-none translate-x-0 translate-y-0 border-0 bg-transparent p-0 shadow-none data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-bottom-0 data-[state=closed]:slide-out-to-bottom-0 [&>button]:hidden"
        style={{ borderRadius: 0, top: 0, left: 0, transform: "none" }}
        onPointerMove={resetHideTimer}
      >
        {/* Black like the app's viewer, fading as the picture is dragged away. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-black"
          style={{ opacity: morphPhase === "out" ? 0 : backdrop, transition: following ? "none" : "opacity 220ms ease-out" }}
        />
        <DialogTitle className="sr-only">
          Image preview{images.length > 1 ? `, ${current + 1} of ${images.length}` : ""}
        </DialogTitle>
        {/* ── Image ── */}
        <motion.div
          ref={containerRef}
          className="absolute inset-0 flex items-center justify-center overflow-hidden"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={handleClick}
          style={{
            cursor:
              zoom > 1 ? (dragging ? "grabbing" : "grab") : "default",
            touchAction: "none",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            style={{
              transform: `translate(${pan.x + drag.x}px, ${pan.y + drag.y}px) scale(${zoom * dragShrink(dragDist)}) rotate(${rotation}deg)`,
              transition:
                dragging || pinching.current || following
                  ? "none"
                  : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }}
            className="w-full h-full z-[10000]"
          >
            <img
                ref={imgRef}
                src={imageSrc}
                alt=""
                className="h-full w-full max-h-[100dvh] object-contain select-none"
                loading="eager"
                fetchPriority="high"
                draggable={false}
                style={{ opacity: morphPhase === "idle" ? 1 : 0 }}
            />
          </div>
        </motion.div>

        {/* Morph overlay only during open/close — never left on screen idle. */}
        {canMorph && morphSrc && morphPhase !== "idle" && (
          <motion.img
            src={morphSrc}
            alt=""
            aria-hidden
            draggable={false}
            animate={morphControls}
            initial={
              originRect
                ? {
                    top: originRect.top,
                    left: originRect.left,
                    width: originRect.width,
                    height: originRect.height,
                    borderRadius: originRect.radius ?? 0,
                    opacity: 1,
                  }
                : { opacity: 0 }
            }
            onLoad={(e) => {
              const t = e.currentTarget;
              if (t.naturalWidth > 0) {
                setNatSize({ w: t.naturalWidth, h: t.naturalHeight });
              }
            }}
            onError={() => {
              morphControls.set({ opacity: 0 });
              setMorphPhase("idle");
            }}
            className="pointer-events-none fixed z-[100000] select-none object-contain"
            style={{
              overflow: "hidden",
              willChange: "top, left, width, height, border-radius, opacity",
            }}
          />
        )}

        {/* ── Top: picture count and close, as in the app ── */}
        <div
          className={cn(
            // The viewer runs under the status bar, so its controls clear it.
            "pointer-events-none absolute inset-x-0 top-0 z-[1000000] flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]",
            controlsClass,
          )}
          style={{ opacity: showControls ? Math.max(0, 1 - dragDist / 60) : 0 }}
        >
          <span className="pl-1 text-sm font-medium tabular-nums text-white/80">
            {images.length > 1 ? `${current + 1} / ${images.length}` : ""}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              requestClose();
            }}
            aria-label="Close"
            className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X className="size-[18px]" />
          </button>
        </div>

        {/* ── Bottom: the app's floating tool pill, with thumbnails above it when there are several ── */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 z-[1000000] flex flex-col items-center gap-3 px-3 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]",
            controlsClass,
          )}
          style={{ opacity: showControls ? Math.max(0, 1 - dragDist / 60) : 0 }}
        >
          {images.length > 1 && (
            <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto px-1 scrollbar-none">
              {images.map((img, i) => (
                <button
                  key={`${img}-${i}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrent(i);
                  }}
                  aria-label={`Picture ${i + 1}`}
                  aria-current={i === current}
                  className={cn(
                    "size-11 shrink-0 overflow-hidden rounded-lg transition-opacity",
                    i === current ? "ring-2 ring-white" : "opacity-45 hover:opacity-75",
                  )}
                >
                  <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/15 p-1 backdrop-blur-md">
            <ToolButton onClick={zoomOut} label="Zoom out" disabled={zoom <= 1}>
              <ZoomOut className="size-5" />
            </ToolButton>
            <ToolButton onClick={zoomIn} label="Zoom in" disabled={zoom >= 5}>
              <ZoomIn className="size-5" />
            </ToolButton>
            <ToolButton onClick={rotate} label="Rotate">
              <RotateCw className="size-5" />
            </ToolButton>
            <ToolButton onClick={resetView} label="Reset view">
              <Scan className="size-5" />
            </ToolButton>
            <ToolButton onClick={handleDownload} label="Download">
              <Download className="size-5" />
            </ToolButton>
          </div>
        </div>

        {/* ── Prev / Next ── */}
        {images.length > 1 && (
          <div className={cn("hidden sm:block", controlsClass)}>
            <NavArrow direction="prev" onClick={() => go(-1)} />
            <NavArrow direction="next" onClick={() => go(1)} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ToolButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 active:bg-white/25 disabled:opacity-35 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      {children}
    </button>
  );
}

function NavArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: (e: React.MouseEvent) => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      aria-label={direction === "prev" ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-1/2 z-[1000000] flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        direction === "prev" ? "left-5" : "right-5",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}