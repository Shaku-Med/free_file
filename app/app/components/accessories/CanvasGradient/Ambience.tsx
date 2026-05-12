import { useEffect, useRef } from "react";

const CANVAS_W = 10;
const CANVAS_H = 6;
/** How often to resample video for ambient (ms). avoids per-frame work. */
const AMBIENT_SAMPLE_INTERVAL_MS = 1000;

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

    const clearSampleInterval = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const sampleVideo = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || document.hidden) return;
      try {
        ctx.drawImage(v, 0, 0, CANVAS_W, CANVAS_H);
      } catch {}
    };

    const startSampleInterval = () => {
      clearSampleInterval();
      if (cancelled || !video || video.paused || video.ended || document.hidden) return;
      intervalId = window.setInterval(() => {
        if (cancelled || !video || video.paused || video.ended || document.hidden) {
          clearSampleInterval();
          return;
        }
        sampleVideo();
      }, AMBIENT_SAMPLE_INTERVAL_MS);
    };

    const onPlay = () => {
      clearSampleInterval();
      sampleVideo();
      startSampleInterval();
    };
    const onPause = () => {
      clearSampleInterval();
      sampleVideo();
    };
    const onSeeked = () => sampleVideo();
    const onLoaded = () => {
      sampleVideo();
      if (!video.paused && !video.ended) startSampleInterval();
    };
    const onVisibility = () => {
      if (document.hidden) clearSampleInterval();
      else if (!video.paused && !video.ended) {
        clearSampleInterval();
        sampleVideo();
        startSampleInterval();
      }
    };

    sampleVideo();
    if (!video.paused && !video.ended) startSampleInterval();

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("ended", clearSampleInterval);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearSampleInterval();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("ended", clearSampleInterval);
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
