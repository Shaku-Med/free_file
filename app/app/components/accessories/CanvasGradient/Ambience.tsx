import { useEffect, useRef } from "react";

const CANVAS_W = 10;
const CANVAS_H = 6;
/** How often to resample video for ambient (ms). avoids per-frame work. */
const AMBIENT_SAMPLE_INTERVAL_MS = 1000;
/** Crossfade duration after each sample (rAF only during this window). */
const AMBIENT_TRANSITION_MS = 480;

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

type AmbienceProps = {
  colors: string[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoReady?: boolean;
};

const Ambience = ({ videoRef, videoReady }: AmbienceProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !videoReady) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let cancelled = false;
    let intervalId: number | undefined;
    let transRaf = 0;
    let hasDisplayState = false;

    const rawBuf = document.createElement("canvas");
    rawBuf.width = CANVAS_W;
    rawBuf.height = CANVAS_H;
    const rawCtx = rawBuf.getContext("2d", { alpha: false });
    const fromBuf = document.createElement("canvas");
    fromBuf.width = CANVAS_W;
    fromBuf.height = CANVAS_H;
    const fromCtx = fromBuf.getContext("2d", { alpha: false });
    const blendBuf = document.createElement("canvas");
    blendBuf.width = CANVAS_W;
    blendBuf.height = CANVAS_H;
    const blendCtx = blendBuf.getContext("2d", { alpha: true });
    if (!rawCtx || !fromCtx || !blendCtx) return;

    const clearSampleInterval = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const cancelTransition = () => {
      if (transRaf !== 0) {
        cancelAnimationFrame(transRaf);
        transRaf = 0;
      }
    };

    const captureVideoToRaw = () => {
      const v = videoRef.current;
      if (!v) return;
      rawCtx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H);
    };

    const snapVideoToDisplay = () => {
      if (cancelled || document.hidden) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      cancelTransition();
      try {
        captureVideoToRaw();
        ctx.drawImage(rawBuf, 0, 0);
        hasDisplayState = true;
      } catch {}
    };

    const sampleVideoCrossfade = () => {
      if (cancelled || document.hidden) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      try {
        captureVideoToRaw();
      } catch {
        return;
      }

      if (!hasDisplayState) {
        cancelTransition();
        try {
          ctx.drawImage(rawBuf, 0, 0);
          hasDisplayState = true;
        } catch {}
        return;
      }

      try {
        fromCtx.drawImage(canvas, 0, 0, CANVAS_W, CANVAS_H);
      } catch {
        return;
      }

      cancelTransition();
      const t0 = performance.now();

      const step = () => {
        if (cancelled || document.hidden) {
          transRaf = 0;
          return;
        }
        const u = Math.min(1, (performance.now() - t0) / AMBIENT_TRANSITION_MS);
        const e = smoothstep01(u);
        blendCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        blendCtx.globalCompositeOperation = "source-over";
        blendCtx.globalAlpha = 1 - e;
        blendCtx.drawImage(fromBuf, 0, 0);
        blendCtx.globalAlpha = e;
        blendCtx.drawImage(rawBuf, 0, 0);
        blendCtx.globalAlpha = 1;
        try {
          ctx.drawImage(blendBuf, 0, 0);
        } catch {
          transRaf = 0;
          return;
        }
        if (u < 1) transRaf = requestAnimationFrame(step);
        else transRaf = 0;
      };

      transRaf = requestAnimationFrame(step);
    };

    const startSampleInterval = () => {
      clearSampleInterval();
      if (cancelled || !video || video.paused || video.ended || document.hidden) return;
      intervalId = window.setInterval(() => {
        if (cancelled || !video || video.paused || video.ended || document.hidden) {
          clearSampleInterval();
          return;
        }
        sampleVideoCrossfade();
      }, AMBIENT_SAMPLE_INTERVAL_MS);
    };

    const onPlay = () => {
      clearSampleInterval();
      cancelTransition();
      snapVideoToDisplay();
      startSampleInterval();
    };
    const onPause = () => {
      clearSampleInterval();
      cancelTransition();
      snapVideoToDisplay();
    };
    const onSeeked = () => snapVideoToDisplay();
    const onLoaded = () => {
      snapVideoToDisplay();
      if (!video.paused && !video.ended) startSampleInterval();
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearSampleInterval();
        cancelTransition();
      } else if (!video.paused && !video.ended) {
        clearSampleInterval();
        snapVideoToDisplay();
        startSampleInterval();
      }
    };

    const onEnded = () => {
      clearSampleInterval();
      cancelTransition();
    };

    snapVideoToDisplay();
    if (!video.paused && !video.ended) startSampleInterval();

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearSampleInterval();
      cancelTransition();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [videoRef, videoReady]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      aria-hidden
      className="absolute inset-0 block h-full w-full object-cover"
      style={{
        filter: "saturate(1.5)",
        willChange: "transform",
        transform: "translateZ(0)",
      }}
    />
  );
};

export default Ambience;
