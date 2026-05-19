import { useEffect, useRef, useState } from 'react';

// Cache fetched waveform JSON across remounts (PlayerContext rebuilds on
// each file change). Keyed by URL — these payloads are immutable per file.
const peaksCache = new Map<string, number[]>();
const inflight = new Map<string, Promise<number[] | null>>();
// Negative-cache for URLs we've already confirmed 404 / unusable. Without
// this we'd refetch the same missing waveform on every file revisit and
// pointlessly flash the waveform UI before falling back.
const missingUrls = new Set<string>();

type WaveformJson = {
  version?: number;
  samples?: number;
  peaks?: number[];
};

async function fetchPeaks(url: string): Promise<number[] | null> {
  if (missingUrls.has(url)) return null;
  const cached = peaksCache.get(url);
  if (cached) return cached;
  const pending = inflight.get(url);
  if (pending) return pending;

  const markMissing = () => {
    missingUrls.add(url);
    return null;
  };

  const promise = (async () => {
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
      if (!res.ok) return markMissing();
      const data = (await res.json()) as WaveformJson;
      if (!Array.isArray(data.peaks) || data.peaks.length === 0) return markMissing();
      // Defensive clamp — anything outside [0, 1] is a backend bug, but a
      // single bad sample shouldn't blow up the renderer.
      const clean = data.peaks.map(p => (typeof p === 'number' && p >= 0 && p <= 1 ? p : 0));
      // Treat all-zero peaks as "no waveform" so the seek bar falls back
      // to the thin rail. has_audio=false from the backend produces this.
      const anySignal = clean.some(v => v > 0.001);
      if (!anySignal) return markMissing();
      peaksCache.set(url, clean);
      return clean;
    } catch {
      return markMissing();
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, promise);
  return promise;
}

interface WaveformCanvasProps {
  url: string;
  height: number;
  /**
   * CSS color string for the bars. Pass `currentColor` and set `color`
   * on a parent to drive this from a shadcn token like `text-primary`
   * — that's the cleanest theme integration.
   */
  color?: string;
  /** Optional fallback if fetch fails — usually the parent will hide on null */
  onError?: () => void;
  className?: string;
}

/**
 * Renders a YouTube-style filled waveform from a peaks JSON file onto a
 * canvas. Lives as an absolutely-positioned layer inside the seek track;
 * the parent overlays the played-progress fill on top.
 *
 * Why canvas + JSON instead of a server PNG:
 *  - 6 KB JSON vs 50+ KB PNG
 *  - Re-themeable client-side (color, bar width, gap) without re-encoding
 *  - Crisp at any device-pixel-ratio without 2x assets
 */
export default function WaveformCanvas({
  url,
  height,
  color = 'currentColor',
  onError,
  className,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let alive = true;
    setPeaks(null);
    fetchPeaks(url).then(p => {
      if (!alive) return;
      if (!p) {
        onError?.();
        return;
      }
      setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [url, onError]);

  useEffect(() => {
    if (!peaks || peaks.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      // Resolve `currentColor` against the canvas itself so the bars pick
      // up whatever `color: ...` the parent set (lets us drive the color
      // from shadcn `text-primary` / `text-secondary-foreground`).
      if (color === 'currentColor') {
        ctx.fillStyle = getComputedStyle(canvas).color || '#ffffff';
      } else {
        ctx.fillStyle = color;
      }

      // Map N peaks across W canvas px, max-pool when peaks > px and
      // linear-interpolate when peaks < px.
      const baseline = h;
      const n = peaks.length;
      if (n >= w) {
        const step = n / w;
        for (let x = 0; x < w; x++) {
          const start = Math.floor(x * step);
          const end = Math.min(n, Math.floor((x + 1) * step));
          let m = 0;
          for (let i = start; i < end; i++) if (peaks[i] > m) m = peaks[i];
          const barH = Math.max(1, Math.round(m * (h - 1)));
          ctx.fillRect(x, baseline - barH, 1, barH);
        }
      } else {
        const step = (n - 1) / Math.max(1, w - 1);
        for (let x = 0; x < w; x++) {
          const f = x * step;
          const lo = Math.floor(f);
          const hi = Math.min(n - 1, lo + 1);
          const t = f - lo;
          const v = peaks[lo] * (1 - t) + peaks[hi] * t;
          const barH = Math.max(1, Math.round(v * (h - 1)));
          ctx.fillRect(x, baseline - barH, 1, barH);
        }
      }
    };

    draw();

    // Re-draw on resize / orientation change so the bars stay sharp.
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [peaks, color]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={
        className ??
        'pointer-events-none absolute inset-0 h-full w-full'
      }
      style={{ height, color }}
    />
  );
}

// Re-export for callers that just want to detect format up-front.
export function isWaveformJson(url: string | undefined | null): boolean {
  if (!url) return false;
  // Strip query string before extension check.
  const path = url.split('?')[0] ?? '';
  return path.toLowerCase().endsWith('.json');
}
