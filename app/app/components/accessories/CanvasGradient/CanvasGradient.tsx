import React, { useCallback, useEffect, useRef } from "react";

type CanvasGradientProps = {
  colors: string[];
  className?: string;
  animate?: boolean;
};

const POLL_INTERVAL = 2000;

const BLOB_OFFSETS: [number, number][] = [
  [0.15, 0.25],
  [0.82, 0.72],
  [0.5, 0.45],
  [0.25, 0.78],
  [0.7, 0.2],
  [0.1, 0.55],
  [0.88, 0.4],
  [0.4, 0.12],
  [0.6, 0.85],
  [0.35, 0.6],
];

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

const CanvasGradient = ({ colors, className = "", animate = false }: CanvasGradientProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const draw = useCallback(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas || colors.length === 0) return;

    const rect = wrapper.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    lastSizeRef.current = { w, h };

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const maxR = Math.max(w, h) * 0.85;
    const minR = maxR * 0.4;

    ctx.clearRect(0, 0, w, h);

    colors.forEach((hex, i) => {
      const idx = i * 2;
      const [x1, y1] = BLOB_OFFSETS[idx % BLOB_OFFSETS.length];
      const [x2, y2] = BLOB_OFFSETS[(idx + 1) % BLOB_OFFSETS.length];

      const cx1 = x1 * w;
      const cy1 = y1 * h;
      const cx2 = x2 * w;
      const cy2 = y2 * h;

      const r1 = minR + (maxR - minR) * (0.3 + (i % 3) * 0.2);
      const r2 = minR + (maxR - minR) * (0.4 + (i % 2) * 0.25);

      const g1 = ctx.createRadialGradient(
        cx1, cy1, 0,
        cx1, cy1, r1
      );
      g1.addColorStop(0, hexToRgba(hex, 0.65));
      g1.addColorStop(0.45, hexToRgba(hex, 0.3));
      g1.addColorStop(1, "rgba(255,255,255,0)");

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(cx1, cy1, r1, 0, Math.PI * 2);
      ctx.fill();

      const g2 = ctx.createRadialGradient(
        cx2, cy2, 0,
        cx2, cy2, r2
      );
      g2.addColorStop(0, hexToRgba(hex, 0.45));
      g2.addColorStop(0.55, hexToRgba(hex, 0.18));
      g2.addColorStop(1, "rgba(255,255,255,0)");

      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(cx2, cy2, r2, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [colors]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (animate) return;
    if (colors.length === 0) return;

    const id = setInterval(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w !== lastSizeRef.current.w || h !== lastSizeRef.current.h) {
        draw();
      }
    }, POLL_INTERVAL);

    return () => clearInterval(id);
  }, [animate, colors.length, draw]);

  useEffect(() => {
    if (!animate) return;
    if (colors.length === 0) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(draw);
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [animate, colors.length, draw]);

  useEffect(() => {
    if (!animate) return;
    const onResize = () => requestAnimationFrame(draw);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [animate, draw]);

  if (colors.length === 0) return null;

  return (
    <div
      ref={wrapperRef}
      className={`absolute inset-0 h-full w-full pointer-events-none min-w-full min-h-full ${className}`.trim()}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full min-w-full min-h-full"
        style={{ display: "block" }}
      />
    </div>
  );
};

export default CanvasGradient;