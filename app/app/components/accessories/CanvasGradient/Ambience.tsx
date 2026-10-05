import { useEffect, useRef } from "react";

const CANVAS_W = 10;
const CANVAS_H = 6;
/** Unsynced mode: how often the glow takes a new frame from the video. */
const AMBIENT_SAMPLE_INTERVAL_MS = 1000;
/**
 * How long each new frame takes to fade in. Longer than the interval, so a
 * new frame always arrives mid fade and carries on from what is on screen:
 * the glow keeps drifting a couple of seconds behind the picture and never
 * sits still and then jumps.
 */
const AMBIENT_FADE_MS = 2000;
/** A fade this slow looks the same at 30fps and costs half the repaints. */
const AMBIENT_FADE_FRAME_MS = 1000 / 30;
/** The glow fades in when it first appears instead of popping on. */
const AMBIENT_REVEAL_MS = 1000;

type AmbienceProps = {
  colors: string[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoReady?: boolean;
  /** Live mode: repaint every frame (no resample gap / crossfade). Default = sampled. */
  sync?: boolean;
};

const Ambience = ({ videoRef, videoReady, sync = false }: AmbienceProps) => {
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

    const reveal = () => {
      canvas.style.opacity = "1";
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
        reveal();
      } catch {}
    };

    const fadeToVideo = () => {
      if (cancelled || document.hidden) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      if (!hasDisplayState) {
        snapVideoToDisplay();
        return;
      }
      try {
        captureVideoToRaw();
        // Starts from what is on screen, even halfway through the last fade,
        // so one fade hands on to the next without a jump.
        fromCtx.drawImage(canvas, 0, 0, CANVAS_W, CANVAS_H);
      } catch {
        return;
      }

      cancelTransition();
      const t0 = performance.now();
      let lastDraw = -Infinity;

      const step = (now: number) => {
        if (cancelled || document.hidden) {
          transRaf = 0;
          return;
        }
        const u = Math.min(1, Math.max(0, (now - t0) / AMBIENT_FADE_MS));
        if (u < 1 && now - lastDraw < AMBIENT_FADE_FRAME_MS) {
          transRaf = requestAnimationFrame(step);
          return;
        }
        lastDraw = now;
        blendCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        blendCtx.globalAlpha = 1 - u;
        blendCtx.drawImage(fromBuf, 0, 0);
        blendCtx.globalAlpha = u;
        blendCtx.drawImage(rawBuf, 0, 0);
        blendCtx.globalAlpha = 1;
        try {
          ctx.drawImage(blendBuf, 0, 0);
        } catch {
          transRaf = 0;
          return;
        }
        transRaf = u < 1 ? requestAnimationFrame(step) : 0;
      };

      transRaf = requestAnimationFrame(step);
    };

    /** Synced mode follows the picture live, so it never fades. */
    const refresh = sync ? snapVideoToDisplay : fadeToVideo;

    /** Sync mode: paint every frame  the glow flows with the video, no gap. */
    let syncRaf = 0;
    const stopSyncLoop = () => {
      if (syncRaf !== 0) {
        cancelAnimationFrame(syncRaf);
        syncRaf = 0;
      }
    };
    const syncStep = () => {
      if (cancelled || document.hidden) {
        syncRaf = 0;
        return;
      }
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !v.paused && !v.ended) {
        try {
          captureVideoToRaw();
          ctx.drawImage(rawBuf, 0, 0);
          hasDisplayState = true;
          reveal();
        } catch {}
      }
      syncRaf = requestAnimationFrame(syncStep);
    };

    const startSampleInterval = () => {
      clearSampleInterval();
      stopSyncLoop();
      if (cancelled || !video || video.paused || video.ended || document.hidden) return;
      if (sync) {
        syncRaf = requestAnimationFrame(syncStep);
        return;
      }
      intervalId = window.setInterval(() => {
        if (cancelled || !video || video.paused || video.ended || document.hidden) {
          clearSampleInterval();
          return;
        }
        fadeToVideo();
      }, AMBIENT_SAMPLE_INTERVAL_MS);
    };

    const onPlay = () => {
      refresh();
      startSampleInterval();
    };
    const onPause = () => {
      clearSampleInterval();
      stopSyncLoop();
      refresh();
    };
    const onSeeked = () => refresh();
    const onLoaded = () => {
      refresh();
      if (!video.paused && !video.ended) startSampleInterval();
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearSampleInterval();
        stopSyncLoop();
        cancelTransition();
      } else if (!video.paused && !video.ended) {
        refresh();
        startSampleInterval();
      }
    };

    const onEnded = () => {
      clearSampleInterval();
      stopSyncLoop();
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
      stopSyncLoop();
      cancelTransition();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [videoRef, videoReady, sync]);

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
        opacity: 0,
        transition: `opacity ${AMBIENT_REVEAL_MS}ms ease-out`,
      }}
    />
  );
};

export default Ambience;
