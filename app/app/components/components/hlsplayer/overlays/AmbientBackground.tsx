import { useRef, useEffect, useMemo } from 'react';
import { usePlayerContext } from '../PlayerContext';

function ensureHex(color: string): string {
  if (/^#([0-9A-Fa-f]{3}){1,2}$/.test(color)) return color;
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) {
    const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return color;
}

const FALLBACK_COLORS = ['#1e3a5f', '#0f172a', '#020617'];

const SOFT_MASK =
  'radial-gradient(ellipse 80% 80% at 50% 50%, black 15%, rgba(0,0,0,0.4) 55%, transparent 90%)';

/**
 * drawImage(video, 0, 0, 8, 8) = 64 pixels, GPU-accelerated, virtually free.
 * CSS upscale from 8px → ~1000px+ display = natural Gaussian-like blur.
 */
const SAMPLE_SIZE = 8;

/** Fallback gradient rendered until the first video frame is available. */
const GRADIENT_SIZE = 32;

export default function AmbientBackground() {
  const { file, ambientMode, ambientColors, videoRef } = usePlayerContext();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fileColors = useMemo(() => {
    const c = (file as any)?.colors;
    if (Array.isArray(c)) return c.filter((x): x is string => typeof x === 'string');
    return [];
  }, [(file as any)?.colors]);

  const colors = ambientColors.length > 0 ? ambientColors : fileColors;
  const hexColors = useMemo(
    () => (colors.length > 0 ? colors.slice(0, 5).map(ensureHex) : FALLBACK_COLORS),
    [colors],
  );
  const colorKey = hexColors.join(',');

  useEffect(() => {
    if (!ambientMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const video = videoRef.current;
    let ctx: CanvasRenderingContext2D | null = null;
    let cancelled = false;
    let rafId: number | null = null;
    let rvfcId: number | null = null;
    let trackingVideo = false;

    const paintGradient = () => {
      if (trackingVideo) return;
      canvas.width = GRADIENT_SIZE;
      canvas.height = GRADIENT_SIZE;
      ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      const cx = GRADIENT_SIZE / 2;
      const cy = GRADIENT_SIZE / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, GRADIENT_SIZE * 0.7);
      hexColors.forEach((c, i, arr) => {
        grad.addColorStop(i / (arr.length - 1 || 1), c);
      });
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE);
    };

    const drawFrame = () => {
      if (cancelled || !video) return;

      if (video.readyState < 2 || video.videoWidth === 0) {
        paintGradient();
        rafId = requestAnimationFrame(drawFrame);
        return;
      }

      if (!trackingVideo) {
        trackingVideo = true;
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        ctx = canvas.getContext('2d', { alpha: false });
      }

      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        } catch {
          trackingVideo = false;
          paintGradient();
          return;
        }
      }

      if (!video.paused && !video.ended) {
        if ('requestVideoFrameCallback' in video) {
          rvfcId = (video as any).requestVideoFrameCallback(() => drawFrame());
        } else {
          rafId = requestAnimationFrame(drawFrame);
        }
      }
    };

    paintGradient();

    if (!video) return;

    const onPlay = () => { if (!cancelled) drawFrame(); };
    const onSeeked = () => { if (!cancelled) drawFrame(); };
    const onLoadedData = () => { if (!cancelled) drawFrame(); };

    if (!video.paused && !video.ended) {
      drawFrame();
    } else if (video.readyState >= 2) {
      drawFrame();
    }

    video.addEventListener('play', onPlay);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoadedData);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (rvfcId !== null && 'cancelVideoFrameCallback' in video) {
        (video as any).cancelVideoFrameCallback(rvfcId);
      }
      video.removeEventListener('play', onPlay);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoadedData);
    };
  }, [ambientMode, videoRef, colorKey]);

  if (!ambientMode) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-0" aria-hidden>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: '-20%',
          width: '140%',
          height: '140%',
          opacity: 0.72,
          filter: 'saturate(1.3)',
          maskImage: SOFT_MASK,
          WebkitMaskImage: SOFT_MASK,
        }}
      />
    </div>
  );
}
