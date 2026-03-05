import { useCallback, useEffect, useRef, useState } from "react";
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
import { Dialog, DialogContent } from "~/components/ui/dialog";
import ImgLoader from "../../ImageLoad/ImageLoad";  
import { motion } from "motion/react";
import CanvasGradient from "~/components/accessories/CanvasGradient/CanvasGradient";
import ImageLoad from "../../ImageLoad/ImageLoad";
import { useStandalone } from "~/lib/hooks/useStandalone";

interface ImgPreviewProps {
  images: string[];
  index: number;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  colors: string[];
}

export default function ImgPreview({
  images,
  index: initialIndex,
  isOpen,
  setIsOpen,
  colors,
}: ImgPreviewProps) {
  if (images.length < 1) return null;

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
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  // Pinch
  const lastPinchDist = useRef(0);
  const lastPinchMid = useRef({ x: 0, y: 0 });
  const pinching = useRef(false);

  // Swipe
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);

  zoomRef.current = zoom;
  panRef.current = pan;

  useEffect(() => {
    setCurrent(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, [current]);

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

  // ── Ctrl/Cmd + wheel → block browser zoom + zoom toward cursor ──

  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      resetHideTimer();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      zoomToward(e.clientX, e.clientY, zoomRef.current + delta);
    };

    document.addEventListener("wheel", handler, { passive: false });
    return () => document.removeEventListener("wheel", handler);
  }, [isOpen, zoomToward, resetHideTimer]);

  // ── Pointer: only for mouse drag pan when zoomed ──

  const handlePointerDown = (e: React.PointerEvent) => {
    resetHideTimer();
    // Only capture mouse, not touch — touch needs to flow to touch handlers for swipe
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
      swipeStart.current = null;
      const info = getPinchInfo(e.touches);
      lastPinchDist.current = info.dist;
      lastPinchMid.current = { x: info.midX, y: info.midY };
    } else if (e.touches.length === 1) {
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
      // Let swipe detection happen on touchEnd — don't cancel swipeStart here
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

  // ── Tap handling (mouse only — touch uses swipe) ──

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
    // Only count single-finger taps that didn't swipe
    if (e.changedTouches.length !== 1 || pinching.current) return;

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

  const imageSrc = images[current];
  const controlsClass = `transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`;

  const imageId = `img-loader-${imageSrc}`;
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        className="fixed inset-0 flex min-h-full min-w-full max-w-none translate-x-0 translate-y-0 border-0 bg-black p-0 shadow-none data-[state=open]:slide-in-from-bottom-0 [&>button]:hidden"
        style={{ borderRadius: 0, top: 0, left: 0, transform: "none" }}
        onPointerMove={resetHideTimer}
      >
        {/* ── Image ── */}
        <motion.div
          ref={containerRef}
          className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black"
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
                src={imageSrc}
                alt="Image"
                className="w-full h-full object-contain"
                loading="eager"
                fetchPriority="high"
                draggable={false}
            />
          </div>
          {!focusMode && <CanvasGradient colors={colors} />}
        </motion.div>

        {/* ── Floating top bar ── */}
        <div
          className={`absolute z-[1000000] inset-x-0 top-0 z-30 bg-gradient-to-b from-black/60 to-transparent px-4 pb-8 pt-4 ${
            isStandalone ? "pt-env(safe-area-inset-top)" : ""
          } ${controlsClass}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white/80">
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
              <span className="min-w-[3rem] text-center text-xs text-white/60">
                {Math.round(zoom * 100)}%
              </span>
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
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
              }}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Mobile bottom bar ── */}
        <div
          className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/60 to-transparent sm:hidden ${controlsClass}`}
        >
          <div className="flex items-center justify-center gap-3 px-4 pb-3 pt-8">
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
            className={`absolute inset-x-0 bottom-0 z-30 hidden bg-gradient-to-t from-black/60 to-transparent sm:block ${controlsClass}`}
          >
            <div className="flex justify-center gap-2 overflow-x-auto px-5 pb-5 pt-8 scrollbar-none">
              {images.map((img, i) => (
                <button
                  key={`${img}-${i}`}
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute left-3 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50 sm:left-5 sm:h-11 sm:w-11"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute right-3 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50 sm:right-5 sm:h-11 sm:w-11"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
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
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-white/20" />;
}