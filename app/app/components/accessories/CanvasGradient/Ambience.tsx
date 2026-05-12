import { useEffect, useRef } from "react";

const CANVAS_W = 10;
const CANVAS_H = 6;

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

    const draw = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || document.hidden) return;
      try { ctx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H); } catch {}
    };

    const loop = () => {
      if (cancelled) return;
      draw();
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
    const onPause = () => { cancelScheduled(); draw(); };
    const onSeeked = () => draw();
    const onLoaded = () => { draw(); if (!video.paused && !video.ended) { cancelScheduled(); loop(); } };
    const onVisibility = () => {
      if (document.hidden) cancelScheduled();
      else if (!video.paused && !video.ended) { cancelScheduled(); loop(); }
    };

    draw();
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
