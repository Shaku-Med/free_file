import { useEffect, useRef } from "react";

/**
 * Sample resolution. Higher than the legacy 10×6 so the CSS scale-up doesn't make the
 * remaining blur do all the smoothing work — that lets us slash the blur radius (the
 * expensive part). The actual cost of drawImage at 64×36 is still trivial.
 */
const CANVAS_W = 64;
const CANVAS_H = 36;
/**
 * Both canvases get this inline so the blur lives on a GPU-cached compositor layer per
 * canvas — when one is fading out and the other is being redrawn, the browser only
 * re-rasterizes the changed layer instead of re-applying a full-screen blur every time
 * a child opacity transitions (which is what killed perf when the filter sat on the
 * wrapping div).
 */
const CANVAS_STYLE: React.CSSProperties = {
  filter: "blur(18px) saturate(1.5)",
  willChange: "opacity",
  transform: "translateZ(0)",
  backfaceVisibility: "hidden",
};
/** Throttled offscreen captures while playing (hidden canvas only — no visible transition). */
const SILENT_CAPTURE_MS = 400;
/** How often we promote the back buffer to the visible layer with one short crossfade. */
const DISPLAY_SWAP_MS = 2800;
const CROSSFADE_MS = 480;

type AmbienceProps = {
  colors: string[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoReady?: boolean;
};

const Ambience = ({ videoRef, videoReady }: AmbienceProps) => {
  const c0 = useRef<HTMLCanvasElement>(null);
  const c1 = useRef<HTMLCanvasElement>(null);
  const visibleRef = useRef<0 | 1>(0);
  const captureIntervalRef = useRef<number | null>(null);
  const swapIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const video = videoRef.current;
    const el0 = c0.current;
    const el1 = c1.current;
    if (!video || !el0 || !el1 || !videoReady) return;

    const ctx0 = el0.getContext("2d", { alpha: false });
    const ctx1 = el1.getContext("2d", { alpha: false });
    if (!ctx0 || !ctx1) return;

    const clearCaptureInterval = () => {
      if (captureIntervalRef.current != null) {
        window.clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    };

    const clearSwapInterval = () => {
      if (swapIntervalRef.current != null) {
        window.clearInterval(swapIntervalRef.current);
        swapIntervalRef.current = null;
      }
    };

    const stopLoops = () => {
      clearCaptureInterval();
      clearSwapInterval();
    };

    /** Draw current video frame into whichever canvas is *not* visible (no opacity / z-index change). */
    const captureToHidden = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || document.hidden) return;
      const vis = visibleRef.current;
      const hidden: 0 | 1 = vis === 0 ? 1 : 0;
      const ctx = hidden === 0 ? ctx0 : ctx1;
      try {
        ctx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H);
      } catch {
        /* CORS / not ready */
      }
    };

    /** One crossfade: show the buffer that has been receiving silent captures. */
    const swapVisibleLayer = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || document.hidden) return;

      captureToHidden();

      const prev = visibleRef.current;
      const next: 0 | 1 = prev === 0 ? 1 : 0;
      const nextEl = next === 0 ? el0 : el1;
      const prevEl = prev === 0 ? el0 : el1;

      nextEl.style.zIndex = "2";
      prevEl.style.zIndex = "1";
      nextEl.style.opacity = "1";
      prevEl.style.opacity = "0";
      visibleRef.current = next;
    };

    const startPlaybackLoops = () => {
      stopLoops();
      captureToHidden();
      captureIntervalRef.current = window.setInterval(captureToHidden, SILENT_CAPTURE_MS);
      swapIntervalRef.current = window.setInterval(swapVisibleLayer, DISPLAY_SWAP_MS);
    };

    const onLoadedOrSeek = () => {
      captureToHidden();
      swapVisibleLayer();
    };

    const syncVisibility = () => {
      if (document.hidden) {
        stopLoops();
      } else if (!video.paused && !video.ended) {
        startPlaybackLoops();
      }
    };

    document.addEventListener("visibilitychange", syncVisibility);

    video.addEventListener("loadeddata", onLoadedOrSeek);
    video.addEventListener("seeked", onLoadedOrSeek);
    video.addEventListener("play", startPlaybackLoops);
    video.addEventListener("pause", stopLoops);
    video.addEventListener("ended", stopLoops);

    const fade = `${CROSSFADE_MS}ms ease-in-out`;
    el0.style.transition = `opacity ${fade}`;
    el1.style.transition = `opacity ${fade}`;
    el0.style.willChange = "opacity";
    el1.style.willChange = "opacity";

    visibleRef.current = 0;
    el0.style.opacity = "1";
    el1.style.opacity = "0";
    el0.style.zIndex = "2";
    el1.style.zIndex = "1";

    try {
      if (video.readyState >= 2) {
        ctx0.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
      }
    } catch {
      /* CORS / not ready */
    }

    captureToHidden();

    if (!video.paused && !video.ended) {
      startPlaybackLoops();
    }

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      stopLoops();
      video.removeEventListener("loadeddata", onLoadedOrSeek);
      video.removeEventListener("seeked", onLoadedOrSeek);
      video.removeEventListener("play", startPlaybackLoops);
      video.removeEventListener("pause", stopLoops);
      video.removeEventListener("ended", stopLoops);
    };
  }, [videoRef, videoReady]);

  return (
    <div className="absolute inset-0 isolate">
      <canvas
        ref={c0}
        width={CANVAS_W}
        height={CANVAS_H}
        aria-hidden
        className="ambience-canvas absolute inset-0 block h-full w-full object-cover"
      />
      <canvas
        ref={c1}
        width={CANVAS_W}
        height={CANVAS_H}
        aria-hidden
        className="ambience-canvas absolute inset-0 block h-full w-full object-cover"
      />
    </div>
  );
};

export default Ambience;
