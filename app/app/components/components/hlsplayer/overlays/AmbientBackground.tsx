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

const SAMPLE_SIZE = 8;
const GRADIENT_SIZE = 32;
/** Blend weight for new frame (0–1). Lower = smoother, slower to follow cuts. */
const AMBIENT_FRAME_BLEND = 0.22;

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
    let trackingVideo = false;
    let rafId: number | undefined;
    let rawBuf: HTMLCanvasElement | null = null;
    let rawCtx: CanvasRenderingContext2D | null = null;
    let smoothBuf: HTMLCanvasElement | null = null;
    let smoothCtx: CanvasRenderingContext2D | null = null;
    let tempBuf: HTMLCanvasElement | null = null;
    let tempCtx: CanvasRenderingContext2D | null = null;
    let hasSmoothedFrame = false;

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

    const ensureVideoBuffers = () => {
      if (!trackingVideo) {
        trackingVideo = true;
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        ctx = canvas.getContext('2d', { alpha: false });
        rawBuf = document.createElement('canvas');
        rawBuf.width = SAMPLE_SIZE;
        rawBuf.height = SAMPLE_SIZE;
        rawCtx = rawBuf.getContext('2d', { alpha: false });
        smoothBuf = document.createElement('canvas');
        smoothBuf.width = SAMPLE_SIZE;
        smoothBuf.height = SAMPLE_SIZE;
        smoothCtx = smoothBuf.getContext('2d', { alpha: false });
        tempBuf = document.createElement('canvas');
        tempBuf.width = SAMPLE_SIZE;
        tempBuf.height = SAMPLE_SIZE;
        tempCtx = tempBuf.getContext('2d', { alpha: false });
        hasSmoothedFrame = false;
      }
    };

    /** Snap smoothing to current video (seek / pause / first paint). */
    const drawImmediate = () => {
      if (cancelled || !video || video.readyState < 2 || video.videoWidth === 0) return;
      ensureVideoBuffers();
      if (!ctx || !rawCtx || !smoothCtx) return;
      try {
        rawCtx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        smoothCtx.globalAlpha = 1;
        smoothCtx.globalCompositeOperation = 'source-over';
        smoothCtx.drawImage(rawBuf!, 0, 0);
        hasSmoothedFrame = true;
        ctx.drawImage(smoothBuf!, 0, 0);
        smoothCtx.globalAlpha = 1;
      } catch {}
    };

    const drawSmoothed = () => {
      if (cancelled || !video || video.readyState < 2 || video.videoWidth === 0) return;
      ensureVideoBuffers();
      if (!ctx || !rawCtx || !smoothCtx || !tempBuf || !tempCtx) return;
      const k = AMBIENT_FRAME_BLEND;
      try {
        rawCtx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        if (!hasSmoothedFrame) {
          smoothCtx.globalAlpha = 1;
          smoothCtx.globalCompositeOperation = 'source-over';
          smoothCtx.drawImage(rawBuf!, 0, 0);
          hasSmoothedFrame = true;
        } else {
          tempCtx.globalAlpha = 1;
          tempCtx.globalCompositeOperation = 'source-over';
          tempCtx.drawImage(smoothBuf!, 0, 0);
          smoothCtx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
          smoothCtx.globalCompositeOperation = 'source-over';
          smoothCtx.globalAlpha = 1 - k;
          smoothCtx.drawImage(tempBuf, 0, 0);
          smoothCtx.globalAlpha = k;
          smoothCtx.drawImage(rawBuf!, 0, 0);
          smoothCtx.globalAlpha = 1;
        }
        ctx.drawImage(smoothBuf!, 0, 0);
      } catch {}
    };

    const loop = () => {
      if (cancelled) return;
      drawSmoothed();
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled || !video || video.paused || video.ended) return;
      // rAF only: samples once per display paint. requestVideoFrameCallback follows every
      // decoded frame and often beats the screen refresh, which makes the upscale flicker.
      rafId = requestAnimationFrame(loop);
    };

    const cancelScheduled = () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
    };

    const onPlay = () => { if (cancelled) return; cancelScheduled(); loop(); };
    const onPause = () => { cancelScheduled(); drawImmediate(); };
    const onSeeked = () => { if (!cancelled) drawImmediate(); };
    const onLoaded = () => {
      if (cancelled) return;
      drawImmediate();
      if (video && !video.paused) { cancelScheduled(); loop(); }
    };

    paintGradient();
    if (!video) return;

    if (!video.paused && !video.ended) loop();
    else if (video.readyState >= 2) drawImmediate();

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoaded);

    return () => {
      cancelled = true;
      cancelScheduled();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoaded);
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
          willChange: 'transform',
          maskImage: SOFT_MASK,
          WebkitMaskImage: SOFT_MASK,
        }}
      />
    </div>
  );
}
