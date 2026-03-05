import { useEffect, useRef } from "react";

const CANVAS_WIDTH = 10;
const CANVAS_HEIGHT = 6;
const LERP_ALPHA = 0.18;
const SATURATION_BOOST = 1.6;
const FRAME_INTERVAL = 66;

type AmbienceProps = {
  colors: string[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoReady?: boolean;
};

function boostSaturation(r: number, g: number, b: number, factor: number) {
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    Math.min(255, Math.max(0, gray + factor * (r - gray))),
    Math.min(255, Math.max(0, gray + factor * (g - gray))),
    Math.min(255, Math.max(0, gray + factor * (b - gray))),
  ];
}

const Ambience = ({ videoRef, videoReady }: AmbienceProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const smoothRef = useRef<Float32Array | null>(null); // raw lerp values, never saturated
  const lastDrawTime = useRef(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !videoReady) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    if (!bufferRef.current) {
      bufferRef.current = document.createElement("canvas");
      bufferRef.current.width = CANVAS_WIDTH;
      bufferRef.current.height = CANVAS_HEIGHT;
    }

    const bufferCanvas = bufferRef.current;
    const bufferCtx = bufferCanvas.getContext("2d", { willReadFrequently: true });
    if (!bufferCtx) return;

    // Reset on each effect run
    smoothRef.current = null;

    const draw = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState < 2) return;

      const cctx = c.getContext("2d", { willReadFrequently: true });
      if (!cctx) return;

      try {
        bufferCtx.drawImage(v, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        const current = bufferCtx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        const curData = current.data;
        const len = curData.length;

        // Initialize smooth buffer from first frame
        if (!smoothRef.current) {
          smoothRef.current = new Float32Array(len);
          for (let i = 0; i < len; i++) {
            smoothRef.current[i] = curData[i];
          }
        }

        const smooth = smoothRef.current;

        // Lerp raw values (no saturation applied here)
        for (let i = 0; i < len; i += 4) {
          smooth[i]     += LERP_ALPHA * (curData[i]     - smooth[i]);
          smooth[i + 1] += LERP_ALPHA * (curData[i + 1] - smooth[i + 1]);
          smooth[i + 2] += LERP_ALPHA * (curData[i + 2] - smooth[i + 2]);
          smooth[i + 3] = 255;
        }

        // Build output with saturation — written to a separate ImageData, not back into smooth
        const output = cctx.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
        const outData = output.data;

        for (let i = 0; i < len; i += 4) {
          const [r, g, b] = boostSaturation(
            smooth[i], smooth[i + 1], smooth[i + 2], SATURATION_BOOST
          );
          outData[i]     = r;
          outData[i + 1] = g;
          outData[i + 2] = b;
          outData[i + 3] = 255;
        }

        cctx.putImageData(output, 0, 0);
      } catch {
        // tainted canvas or video not ready
      }
    };

    const drawLoop = (timestamp: number) => {
      if (timestamp - lastDrawTime.current >= FRAME_INTERVAL) {
        lastDrawTime.current = timestamp;
        draw();
      }
      rafRef.current = window.requestAnimationFrame(drawLoop);
    };

    const startLoop = () => {
      stopLoop();
      rafRef.current = window.requestAnimationFrame(drawLoop);
    };

    const stopLoop = () => {
      if (rafRef.current !== undefined) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
    };

    video.addEventListener("loadeddata", draw);
    video.addEventListener("seeked", draw);
    video.addEventListener("play", startLoop);
    video.addEventListener("pause", stopLoop);
    video.addEventListener("ended", stopLoop);

    if (!video.paused && !video.ended) {
      startLoop();
    } else if (video.readyState >= 2) {
      draw();
    }

    return () => {
      stopLoop();
      video.removeEventListener("loadeddata", draw);
      video.removeEventListener("seeked", draw);
      video.removeEventListener("play", startLoop);
      video.removeEventListener("pause", stopLoop);
      video.removeEventListener("ended", stopLoop);
    };
  }, [videoRef, videoReady]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      aria-hidden
      className="ambience-canvas absolute inset-0 block h-full w-full object-cover opacity-50"
    />
  );
};

export default Ambience;