import { useEffect, useRef } from "react";

const CANVAS_W = 10;
const CANVAS_H = 6;
/** Blend weight for new frame (0–1). Lower = smoother, slower to follow cuts. */
const AMBIENT_FRAME_BLEND = 0.22;

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
    let rafId: number | undefined;
    let hasSmoothedFrame = false;

    const rawBuf = document.createElement("canvas");
    rawBuf.width = CANVAS_W;
    rawBuf.height = CANVAS_H;
    const rawCtx = rawBuf.getContext("2d", { alpha: false });
    const smoothBuf = document.createElement("canvas");
    smoothBuf.width = CANVAS_W;
    smoothBuf.height = CANVAS_H;
    const smoothCtx = smoothBuf.getContext("2d", { alpha: false });
    const tempBuf = document.createElement("canvas");
    tempBuf.width = CANVAS_W;
    tempBuf.height = CANVAS_H;
    const tempCtx = tempBuf.getContext("2d", { alpha: false });
    if (!rawCtx || !smoothCtx || !tempCtx) return;

    const drawImmediate = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || document.hidden) return;
      try {
        rawCtx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H);
        smoothCtx.globalAlpha = 1;
        smoothCtx.globalCompositeOperation = "source-over";
        smoothCtx.drawImage(rawBuf, 0, 0);
        hasSmoothedFrame = true;
        ctx.drawImage(smoothBuf, 0, 0);
        smoothCtx.globalAlpha = 1;
      } catch {}
    };

    const drawSmoothed = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || document.hidden) return;
      const k = AMBIENT_FRAME_BLEND;
      try {
        rawCtx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H);
        if (!hasSmoothedFrame) {
          smoothCtx.globalAlpha = 1;
          smoothCtx.globalCompositeOperation = "source-over";
          smoothCtx.drawImage(rawBuf, 0, 0);
          hasSmoothedFrame = true;
        } else {
          tempCtx.globalAlpha = 1;
          tempCtx.globalCompositeOperation = "source-over";
          tempCtx.drawImage(smoothBuf, 0, 0);
          smoothCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
          smoothCtx.globalCompositeOperation = "source-over";
          smoothCtx.globalAlpha = 1 - k;
          smoothCtx.drawImage(tempBuf, 0, 0);
          smoothCtx.globalAlpha = k;
          smoothCtx.drawImage(rawBuf, 0, 0);
          smoothCtx.globalAlpha = 1;
        }
        ctx.drawImage(smoothBuf, 0, 0);
      } catch {}
    };

    const loop = () => {
      if (cancelled) return;
      drawSmoothed();
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled || !video || video.paused || video.ended) return;
      // Match display refresh only — avoids flicker from requestVideoFrameCallback vs upscale.
      rafId = requestAnimationFrame(loop);
    };

    const cancelScheduled = () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
    };

    const onPlay = () => { cancelScheduled(); loop(); };
    const onPause = () => { cancelScheduled(); drawImmediate(); };
    const onSeeked = () => drawImmediate();
    const onLoaded = () => {
      drawImmediate();
      if (!video.paused && !video.ended) { cancelScheduled(); loop(); }
    };
    const onVisibility = () => {
      if (document.hidden) cancelScheduled();
      else if (!video.paused && !video.ended) { cancelScheduled(); loop(); }
    };

    drawImmediate();
    if (!video.paused && !video.ended) loop();

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("ended", cancelScheduled);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      cancelScheduled();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("ended", cancelScheduled);
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
