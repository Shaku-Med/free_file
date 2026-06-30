import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCw,
  X,
  Maximize2,
  Download,
  Focus,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { motion } from "motion/react";
import CanvasGradient from "~/components/accessories/CanvasGradient/CanvasGradient";
import { useStandalone } from "~/lib/hooks/useStandalone";
import { useAdaptiveTone, type Tone } from "~/lib/useAdaptiveTone";
import { cn } from "~/lib/utils";

// Lets nested controls sample the image without prop drilling. Provided once
// near the modal root with the live `<img>` ref + a trigger string that flips
// whenever the visible pixels change (current image, zoom, pan, rotation).
const AdaptiveCtx = createContext<{
  imageRef: RefObject<HTMLImageElement | null>;
  trigger: string;
} | null>(null);

const NULL_IMG_REF: RefObject<HTMLImageElement | null> = { current: null };

function useControlTone(targetRef: RefObject<HTMLElement | null>): Tone {
  const ctx = useContext(AdaptiveCtx);
  return useAdaptiveTone({
    imageRef: ctx?.imageRef ?? NULL_IMG_REF,
    targetRef,
    trigger: ctx?.trigger,
    defaultTone: "light",
  });
}

interface ImgPreviewProps {
  images: string[];
  index: number;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  colors?: string[];
}

export default function ImgPreview({
  images,
  index: initialIndex,
  isOpen,
  setIsOpen,
  colors = [],
}: ImgPreviewProps) {
  const isStandalone = useStandalone();

  const [current, setCurrent] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [focusMode, setFocusMode] = useState(false);

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

  zoomRef.current = zoom;
  panRef.current = pan;

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
    if (!isOpen) setFocusMode(false);
  }, [isOpen]);

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
          setIsOpen(false);
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
  }, [isOpen, go, setIsOpen, resetHideTimer]);

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
    if (e.changedTouches.length !== 1 || pinching.current || gestureWasMultiTouch.current) return;

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
    handleTouchEnd(e);
    handleTouchEndTap(e);
  };

  const controlsClass = `transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`;

  // Re-sample tone whenever the visible pixels change. The hook also listens
  // for img.load and resize, but explicit triggers cover zoom/pan/rotation.
  const adaptTrigger = useMemo(
    () => `${current}|${zoom}|${rotation}|${pan.x}|${pan.y}`,
    [current, zoom, rotation, pan.x, pan.y],
  );
  const adaptCtxValue = useMemo(
    () => ({ imageRef: imgRef, trigger: adaptTrigger }),
    [adaptTrigger],
  );

  if (images.length < 1) return null;

  const imageSrc = images[current];
  if (!imageSrc) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/88 backdrop-blur-[3px] data-[state=open]:duration-300 data-[state=closed]:duration-200"
        className="fixed inset-0 flex min-h-full min-w-full max-w-none translate-x-0 translate-y-0 border-0 bg-transparent p-0 shadow-none data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-bottom-0 data-[state=closed]:slide-out-to-bottom-0 [&>button]:hidden"
        style={{ borderRadius: 0, top: 0, left: 0, transform: "none" }}
        onPointerMove={resetHideTimer}
      >
        <AdaptiveCtx.Provider value={adaptCtxValue}>
        <DialogTitle className="sr-only">
          Image preview{images.length > 1 ? `, ${current + 1} of ${images.length}` : ""}
        </DialogTitle>
        {/* ── Image ── */}
        <motion.div
          ref={containerRef}
          className="absolute inset-0 flex items-center justify-center overflow-hidden bg-zinc-950"
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
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              transition:
                dragging || pinching.current
                  ? "none"
                  : "transform 150ms ease-out",
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
            />
          </div>
          {!focusMode && <CanvasGradient colors={colors} />}
        </motion.div>

        {/* ── Floating top bar ── */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-[1000000] px-4 pb-6 ${
            isStandalone
              ? "pt-[max(1rem,env(safe-area-inset-top,0px))]"
              : "pt-4"
          }`}
        >
          <div className={`pointer-events-auto flex items-center justify-between gap-3 ${controlsClass}`}>
            <span className="text-sm font-medium tabular-nums text-white/90">
              {current + 1} / {images.length}
            </span>

            <div className="hidden items-center gap-1 sm:flex">
              <ToolButton
                onClick={zoomOut}
                label="Zoom out"
                disabled={zoom <= 1}
              >
                <Minus className="h-4 w-4" />
              </ToolButton>
              <ToneText
                className="min-w-[3rem] text-center text-xs"
                light="text-white/60"
                dark="text-black/60"
              >
                {Math.round(zoom * 100)}%
              </ToneText>
              <ToolButton
                onClick={zoomIn}
                label="Zoom in"
                disabled={zoom >= 5}
              >
                <Plus className="h-4 w-4" />
              </ToolButton>
              <Divider />
              <ToolButton onClick={rotate} label="Rotate">
                <RotateCw className="h-4 w-4" />
              </ToolButton>
              <ToolButton onClick={resetView} label="Reset view">
                <Maximize2 className="h-4 w-4" />
              </ToolButton>
              <ToolButton onClick={handleDownload} label="Download">
                <Download className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                onClick={() => setFocusMode((prev) => !prev)}
                label={focusMode ? "Exit focus mode" : "Enter focus mode"}
              >
                <Focus className="h-4 w-4" />
              </ToolButton>
              <Divider />
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
              }}
              aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/12 text-white shadow-sm ring-1 ring-white/10 transition-colors hover:bg-white/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Mobile bottom bar ── */}
        <div
          className={`absolute inset-x-0 bottom-0 z-[1000000] border-t border-white/10 bg-gradient-to-t from-black/45 to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur-md sm:hidden ${controlsClass}`}
        >
          <div className="flex items-center justify-center gap-3 px-4 pb-2 pt-6">
            <ToolButton onClick={zoomOut} label="Zoom out" disabled={zoom <= 1}>
              <Minus className="h-4 w-4" />
            </ToolButton>
            <ToolButton onClick={zoomIn} label="Zoom in" disabled={zoom >= 5}>
              <Plus className="h-4 w-4" />
            </ToolButton>
            <ToolButton onClick={rotate} label="Rotate">
              <RotateCw className="h-4 w-4" />
            </ToolButton>
            <ToolButton onClick={resetView} label="Reset">
              <Maximize2 className="h-4 w-4" />
            </ToolButton>
            <ToolButton onClick={handleDownload} label="Download">
              <Download className="h-4 w-4" />
            </ToolButton>
            <ToolButton
              onClick={() => setFocusMode((prev) => !prev)}
              label={focusMode ? "Exit focus mode" : "Enter focus mode"}
            >
              <Focus className="h-4 w-4" />
            </ToolButton>
          </div>

          {images.length > 1 && (
            <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4 scrollbar-none">
              {images.map((img, i) => (
                <button
                  key={`${img}-${i}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrent(i);
                  }}
                  className={`h-10 w-10 shrink-0 overflow-hidden rounded-md transition-all ${
                    i === current
                      ? "ring-2 ring-white ring-offset-1 ring-offset-black"
                      : "opacity-40"
                  }`}
                >
                  <img
                    src={img}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Desktop thumbnails ── */}
        {images.length > 1 && (
          <div
            className={`absolute inset-x-0 bottom-0 z-[1000000] hidden border-t border-white/5 bg-gradient-to-t from-black/40 to-transparent backdrop-blur-md sm:block ${controlsClass}`}
          >
            <div className="flex justify-center gap-2 overflow-x-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-6 scrollbar-none">
              {images.map((img, i) => (
                <button
                  key={`${img}-${i}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrent(i);
                  }}
                  className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg transition-all ${
                    i === current
                      ? "ring-2 ring-white ring-offset-2 ring-offset-black"
                      : "opacity-40 hover:opacity-70"
                  }`}
                >
                  <img
                    src={img}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Prev / Next ── */}
        {images.length > 1 && (
          <div className={controlsClass}>
            <NavArrow direction="prev" onClick={() => go(-1)} />
            <NavArrow direction="next" onClick={() => go(1)} />
          </div>
        )}
        </AdaptiveCtx.Provider>
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
  const ref = useRef<HTMLButtonElement>(null);
  const tone = useControlTone(ref);
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full ring-1 transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2",
        tone === "light"
          ? "bg-white/10 text-white/85 ring-white/10 hover:bg-white/22 hover:text-white focus-visible:ring-white/35"
          : "bg-black/15 text-black/85 ring-black/10 hover:bg-black/25 hover:text-black focus-visible:ring-black/35",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-white/20" />;
}

// Small text that flips color based on what's behind it. Used for "1 / N" and
// the zoom-percent label.
function ToneText({
  children,
  className,
  light = "text-white/90",
  dark = "text-black/90",
}: {
  children: React.ReactNode;
  className?: string;
  light?: string;
  dark?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tone = useControlTone(ref);
  return (
    <span ref={ref} className={cn(tone === "light" ? light : dark, className)}>
      {children}
    </span>
  );
}

function NavArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const tone = useControlTone(ref);
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      aria-label={direction === "prev" ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-1/2 z-[1000000] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full shadow-md ring-1 backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 sm:h-12 sm:w-12",
        direction === "prev" ? "left-3 sm:left-5" : "right-3 sm:right-5",
        tone === "light"
          ? "bg-black/40 text-white ring-white/10 hover:bg-black/55 focus-visible:ring-white/35"
          : "bg-white/60 text-black ring-black/10 hover:bg-white/75 focus-visible:ring-black/35",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}