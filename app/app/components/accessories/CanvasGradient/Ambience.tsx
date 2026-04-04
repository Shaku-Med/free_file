import { useEffect, useRef } from "react";

/**
 * YouTube-style ambient glow (approximation):
 * - Production YouTube uses pre-rendered mosaic WebPs + crossfade (see e.g. adamrashid.dev / Smashing Magazine).
 * - Here: two tiny canvases, sparse `drawImage` samples (dominant colors), CSS blur on the page wrapper,
 *   and opacity crossfade between layers — no getImageData / per-pixel JS (keeps GIF decode smooth).
 */
const CANVAS_W = 10;
const CANVAS_H = 6;
/** Sparse updates only (~3 Hz) — production YouTube uses pre-baked mosaics; we mimic that cadence on the client. */
const SAMPLE_INTERVAL_MS = 320;
const CROSSFADE_MS = 520;

type AmbienceProps = {
  colors: string[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoReady?: boolean;
};

const Ambience = ({ videoRef, videoReady }: AmbienceProps) => {
  const c0 = useRef<HTMLCanvasElement>(null);
  const c1 = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<0 | 1>(0);
  const intervalRef = useRef<number | null>(null);

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

    const stopInterval = () => {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const stopPlaybackLoop = () => {
      stopInterval();
    };

    const sample = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || document.hidden) return;

      const prevFront = frontRef.current;
      const nextFront: 0 | 1 = prevFront === 0 ? 1 : 0;
      const nextCtx = nextFront === 0 ? ctx0 : ctx1;
      const nextEl = nextFront === 0 ? el0 : el1;
      const prevEl = prevFront === 0 ? el0 : el1;

      try {
        nextCtx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H);
      } catch {
        return;
      }

      nextEl.style.zIndex = "2";
      prevEl.style.zIndex = "1";
      nextEl.style.opacity = "1";
      prevEl.style.opacity = "0";
      frontRef.current = nextFront;
    };

    const startPlaybackLoop = () => {
      sample();
      stopInterval();
      intervalRef.current = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    };

    const onLoadedOrSeek = () => {
      sample();
    };

    const syncVisibility = () => {
      if (document.hidden) {
        stopPlaybackLoop();
      } else if (!video.paused && !video.ended) {
        startPlaybackLoop();
      }
    };

    document.addEventListener("visibilitychange", syncVisibility);

    video.addEventListener("loadeddata", onLoadedOrSeek);
    video.addEventListener("seeked", onLoadedOrSeek);
    video.addEventListener("play", startPlaybackLoop);
    video.addEventListener("pause", stopPlaybackLoop);
    video.addEventListener("ended", stopPlaybackLoop);

    el0.style.transition = `opacity ${CROSSFADE_MS}ms ease-in-out`;
    el1.style.transition = `opacity ${CROSSFADE_MS}ms ease-in-out`;
    el0.style.willChange = "opacity";
    el1.style.willChange = "opacity";
    el0.style.opacity = "1";
    el1.style.opacity = "0";
    el0.style.zIndex = "2";
    el1.style.zIndex = "1";
    frontRef.current = 0;

    try {
      if (video.readyState >= 2) {
        ctx0.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
      }
    } catch {
      /* CORS / not ready */
    }

    if (!video.paused && !video.ended) {
      startPlaybackLoop();
    }

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      stopPlaybackLoop();
      video.removeEventListener("loadeddata", onLoadedOrSeek);
      video.removeEventListener("seeked", onLoadedOrSeek);
      video.removeEventListener("play", startPlaybackLoop);
      video.removeEventListener("pause", stopPlaybackLoop);
      video.removeEventListener("ended", stopPlaybackLoop);
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
